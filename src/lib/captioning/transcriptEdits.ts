/**
 * Turns word-level caption segments into `TrimRegion`s that remove filler words and dead air.
 *
 * Both the timeline and the exporter already honour `TrimRegion`, so transcript-driven editing
 * is pure analysis: word segments in, trim regions out. Nothing here renders or mutates.
 *
 * Bias: over-removal is far worse than under-removal. A missed "um" is invisible; a clipped
 * consonant ruins the take. Every default below errs toward leaving audio alone.
 */
import type { TrimRegion } from "@/components/video-editor/types";
import type { CaptionSegment } from "./transcribe";

/** Keep a little audio either side of a cut so word onsets/tails are not clipped. */
export const DEFAULT_EDGE_PAD_SEC = 0.05;

/** Gaps shorter than this are natural speech rhythm, not dead air. */
export const DEFAULT_SILENCE_THRESHOLD_SEC = 0.7;

/**
 * How much silence to leave behind when collapsing a gap. Cutting pauses to zero makes
 * speech sound frantic, so a gap is shortened rather than removed.
 */
export const DEFAULT_SILENCE_RESIDUAL_SEC = 0.2;

/** Regions shorter than this aren't worth a timeline entry (and risk sub-frame churn). */
const MIN_REGION_SEC = 0.04;

/**
 * Unambiguous disfluencies, matched as whole tokens. Written as patterns rather than a word
 * list so elongations ("ummm", "uhhh", "errr") are caught without enumerating every variant.
 * Anchored, so they can never match inside a real word.
 */
const CORE_FILLER_PATTERNS: readonly RegExp[] = [
	/^u+m+$/u, // um, umm, ummm
	/^u+h+$/u, // uh, uhh
	/^e+r+m*$/u, // er, err, erm
	/^h+m+$/u, // hm, hmm
	/^m+h+m+$/u, // mhm
	/^a+h+$/u, // ah, ahh
	/^e+h+$/u, // eh
];

/**
 * Language-keyed filler tokens, beyond the patterns above. Keys are the locale prefixes this
 * app ships. Empty arrays are deliberate placeholders — an empty list simply means no
 * language-specific tokens are removed for that locale, which is the safe default.
 */
export const FILLER_TOKENS_BY_LANGUAGE: Readonly<Record<string, readonly string[]>> = {
	en: [],
	es: ["este", "pues", "bueno"],
	fr: ["euh", "ben", "bah"],
	it: ["ehm", "cioe"],
	pt: ["eh", "entao"],
	de: ["äh", "ähm", "öh"],
	ru: ["эээ", "ммм"],
	tr: ["şey", "yani"],
	vi: [],
	ja: ["ええと", "あの", "えっと"],
	ko: ["음", "어"],
	zh: ["那个", "就是"],
	ar: [],
};

/**
 * Discourse markers — "like", "you know", "basically". Common verbal tics, but every one of
 * them is also a legitimate word in ordinary sentences ("things I like", "you know the answer").
 * Opt-in only, never removed by default.
 */
export const DISCOURSE_MARKERS_BY_LANGUAGE: Readonly<Record<string, readonly string[]>> = {
	en: [
		"like",
		"basically",
		"literally",
		"actually",
		"honestly",
		"obviously",
		"you know",
		"i mean",
		"sort of",
		"kind of",
	],
	es: ["o sea", "digamos"],
	fr: ["genre", "du coup"],
	de: ["halt", "eben"],
};

export interface FillerRegionOptions {
	/** Locale (or locale prefix) selecting the language-specific token list. Default "en". */
	language?: string;
	/** Also remove ambiguous discourse markers. Off by default — see the constant's note. */
	includeDiscourseMarkers?: boolean;
	/** Extra tokens/phrases to treat as filler, matched the same way. */
	extraTokens?: readonly string[];
	/** Seconds of audio preserved either side of each cut. */
	edgePadSec?: number;
	/** Prefix for generated region ids. Default "filler". */
	idPrefix?: string;
}

export interface SilenceRegionOptions {
	/** Gaps at or below this are left alone. */
	thresholdSec?: number;
	/** Silence left behind after collapsing a gap. */
	residualSec?: number;
	/** Seconds of audio preserved either side of each cut. */
	edgePadSec?: number;
	/** Total media length; enables trimming trailing dead air after the final word. */
	mediaDurationSec?: number;
	/** Collapse dead air before the first word. Default true. */
	includeLeading?: boolean;
	/** Prefix for generated region ids. Default "silence". */
	idPrefix?: string;
}

/** Strips surrounding punctuation/whitespace and lowercases, preserving letters in any script. */
export function normalizeToken(text: string): string {
	return text
		.normalize("NFC")
		.replace(/^[^\p{L}\p{N}]+/gu, "")
		.replace(/[^\p{L}\p{N}]+$/gu, "")
		.toLowerCase();
}

function languageKey(language: string | undefined): string {
	if (!language) return "en";
	return language.toLowerCase().split(/[-_]/)[0] ?? "en";
}

function isCoreFiller(token: string): boolean {
	return token.length > 0 && CORE_FILLER_PATTERNS.some((pattern) => pattern.test(token));
}

const secToMs = (sec: number) => Math.round(sec * 1000);

/**
 * Merges overlapping and adjacent regions, drops empty/inverted ones, and returns them sorted.
 * Regions that merely touch (`a.endMs === b.startMs`) are combined too — two abutting cuts are
 * one cut.
 */
export function mergeTrimRegions(regions: TrimRegion[], idPrefix = "trim"): TrimRegion[] {
	const valid = regions
		.filter((r) => Number.isFinite(r.startMs) && Number.isFinite(r.endMs) && r.endMs > r.startMs)
		.sort((a, b) => a.startMs - b.startMs);
	if (valid.length === 0) return [];

	const merged: Array<{ startMs: number; endMs: number }> = [];
	for (const region of valid) {
		const last = merged[merged.length - 1];
		if (last && region.startMs <= last.endMs) {
			last.endMs = Math.max(last.endMs, region.endMs);
		} else {
			merged.push({ startMs: region.startMs, endMs: region.endMs });
		}
	}

	return merged.map((r, index) => ({ id: `${idPrefix}-${index}`, ...r }));
}

/**
 * Finds filler words and returns the regions covering them.
 *
 * Matching is whole-token only, so "um" never matches inside "umbrella". Multi-word entries
 * ("you know") are matched across consecutive segments, longest-first, so "you know" wins over
 * a bare "know".
 */
export function findFillerRegions(
	segments: CaptionSegment[],
	options: FillerRegionOptions = {},
): TrimRegion[] {
	const {
		language,
		includeDiscourseMarkers = false,
		extraTokens = [],
		edgePadSec = DEFAULT_EDGE_PAD_SEC,
		idPrefix = "filler",
	} = options;

	if (segments.length === 0) return [];

	const key = languageKey(language);
	const phrases = [
		...(FILLER_TOKENS_BY_LANGUAGE[key] ?? []),
		...(includeDiscourseMarkers ? (DISCOURSE_MARKERS_BY_LANGUAGE[key] ?? []) : []),
		...extraTokens,
	]
		.map((phrase) => phrase.split(/\s+/).map(normalizeToken).filter(Boolean))
		.filter((tokens) => tokens.length > 0)
		// Longest first so multi-word phrases win over their own prefixes.
		.sort((a, b) => b.length - a.length);

	// Sort defensively: Whisper can emit out-of-order segments around chunk boundaries.
	const ordered = [...segments].sort((a, b) => a.startSec - b.startSec);
	const tokens = ordered.map((segment) => normalizeToken(segment.text));

	const matchedIndices = new Set<number>();
	const runs: Array<{ start: number; end: number }> = [];

	for (let i = 0; i < ordered.length; i++) {
		if (matchedIndices.has(i)) continue;

		if (isCoreFiller(tokens[i]!)) {
			matchedIndices.add(i);
			runs.push({ start: i, end: i });
			continue;
		}

		const phrase = phrases.find((candidate) =>
			candidate.every((token, offset) => tokens[i + offset] === token),
		);
		if (phrase) {
			for (let offset = 0; offset < phrase.length; offset++) matchedIndices.add(i + offset);
			runs.push({ start: i, end: i + phrase.length - 1 });
			i += phrase.length - 1;
		}
	}

	// If literally everything is filler, this is far more likely a misdetection (wrong language,
	// music, noise) than a recording of pure "um". Removing the whole clip is never the helpful
	// reading, so bail rather than hand back a total wipe.
	if (matchedIndices.size === ordered.length && ordered.length > 2) return [];

	// Coalesce back-to-back matches ("um uh") into one run before padding. Padding each
	// separately would strand a useless sliver of audio between two adjacent cuts.
	const coalesced: Array<{ start: number; end: number }> = [];
	for (const run of runs.sort((a, b) => a.start - b.start)) {
		const last = coalesced[coalesced.length - 1];
		if (last && run.start === last.end + 1) {
			last.end = run.end;
		} else {
			coalesced.push({ ...run });
		}
	}

	const regions = coalesced.map<TrimRegion>((run, index) => {
		const startSec = ordered[run.start]!.startSec;
		const endSec = ordered[run.end]!.endSec;
		return {
			id: `${idPrefix}-${index}`,
			startMs: secToMs(Math.max(0, startSec + edgePadSec)),
			endMs: secToMs(Math.max(0, endSec - edgePadSec)),
		};
	});

	return mergeTrimRegions(
		regions.filter((r) => r.endMs - r.startMs >= secToMs(MIN_REGION_SEC)),
		idPrefix,
	);
}

/**
 * Finds over-long pauses and returns regions collapsing them to `residualSec`.
 *
 * The emitted region covers only the excess, centred in the gap, so the residual silence is
 * split evenly either side of the cut and neither neighbouring word gets clipped.
 */
export function findSilenceRegions(
	segments: CaptionSegment[],
	options: SilenceRegionOptions = {},
): TrimRegion[] {
	const {
		thresholdSec = DEFAULT_SILENCE_THRESHOLD_SEC,
		residualSec = DEFAULT_SILENCE_RESIDUAL_SEC,
		edgePadSec = DEFAULT_EDGE_PAD_SEC,
		mediaDurationSec,
		includeLeading = true,
		idPrefix = "silence",
	} = options;

	if (segments.length === 0) return [];

	const ordered = [...segments].sort((a, b) => a.startSec - b.startSec);
	// Silence to preserve across a cut; never less than the padding on both edges.
	const keepSec = Math.max(residualSec, edgePadSec * 2);
	const regions: TrimRegion[] = [];

	const pushGap = (gapStartSec: number, gapEndSec: number) => {
		if (!(gapEndSec - gapStartSec > thresholdSec)) return;
		const startSec = gapStartSec + keepSec / 2;
		const endSec = gapEndSec - keepSec / 2;
		if (endSec - startSec < MIN_REGION_SEC) return;
		regions.push({
			id: `${idPrefix}-${regions.length}`,
			startMs: secToMs(Math.max(0, startSec)),
			endMs: secToMs(Math.max(0, endSec)),
		});
	};

	if (includeLeading) {
		// Leading dead air is measured from zero, so the whole run before the first word counts.
		pushGap(0, ordered[0]!.startSec);
	}

	for (let i = 0; i < ordered.length - 1; i++) {
		// Guard against overlapping segments: a negative gap must never become a region.
		pushGap(Math.max(ordered[i]!.endSec, ordered[i]!.startSec), ordered[i + 1]!.startSec);
	}

	if (typeof mediaDurationSec === "number" && Number.isFinite(mediaDurationSec)) {
		const lastEnd = ordered[ordered.length - 1]!.endSec;
		pushGap(lastEnd, mediaDurationSec);
	}

	const clamped = regions.map((r) => ({
		...r,
		endMs:
			typeof mediaDurationSec === "number" && Number.isFinite(mediaDurationSec)
				? Math.min(r.endMs, secToMs(mediaDurationSec))
				: r.endMs,
	}));

	return mergeTrimRegions(clamped, idPrefix);
}
