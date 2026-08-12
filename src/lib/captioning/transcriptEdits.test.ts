import { describe, expect, it } from "vitest";
import type { CaptionSegment } from "./transcribe";
import {
	DEFAULT_EDGE_PAD_SEC,
	findFillerRegions,
	findSilenceRegions,
	mergeTrimRegions,
	normalizeToken,
} from "./transcriptEdits";

/** Builds word segments back-to-back at `step` seconds each, starting at `startSec`. */
function words(list: string[], startSec = 0, step = 0.4): CaptionSegment[] {
	return list.map((text, i) => ({
		text,
		startSec: startSec + i * step,
		endSec: startSec + i * step + step,
	}));
}

describe("normalizeToken", () => {
	it("strips surrounding punctuation and lowercases", () => {
		expect(normalizeToken('  "Um," ')).toBe("um");
		expect(normalizeToken("Uh...")).toBe("uh");
	});

	it("preserves letters in non-Latin scripts", () => {
		expect(normalizeToken("、あの。")).toBe("あの");
		expect(normalizeToken("«Ммм»")).toBe("ммм");
	});

	it("does not strip punctuation inside a token", () => {
		expect(normalizeToken("don't")).toBe("don't");
	});
});

describe("findFillerRegions", () => {
	it("matches whole tokens only and never inside a real word", () => {
		// The one bug in this module that would silently destroy a recording.
		const segments = words(["umbrella", "uhlan", "ahead", "hmmm", "ermine", "erm"]);
		const regions = findFillerRegions(segments);

		// Only "hmmm" (index 3) and "erm" (index 5) are fillers.
		expect(regions).toHaveLength(2);
		expect(regions[0]!.startMs).toBeGreaterThanOrEqual(1200);
		expect(regions[0]!.endMs).toBeLessThanOrEqual(1600);
		expect(regions[1]!.startMs).toBeGreaterThanOrEqual(2000);
	});

	it("catches elongated disfluencies without enumerating variants", () => {
		// Real words either side, or the all-filler guard below would fire instead.
		const segments = words(["start", "ummm", "uhhh", "errr", "mhm", "end"]);
		// The four adjacent disfluencies coalesce into a single cut.
		expect(findFillerRegions(segments)).toHaveLength(1);
	});

	it("coalesces back-to-back fillers into one cut", () => {
		const segments = words(["hello", "um", "uh", "world"]);
		const regions = findFillerRegions(segments);

		// One run spanning "um"(0.4) through "uh"(1.2), not two cuts with a sliver between.
		expect(regions).toHaveLength(1);
		expect(regions[0]!.startMs).toBe(Math.round((0.4 + DEFAULT_EDGE_PAD_SEC) * 1000));
		expect(regions[0]!.endMs).toBe(Math.round((1.2 - DEFAULT_EDGE_PAD_SEC) * 1000));
	});

	it("leaves ordinary speech untouched", () => {
		const segments = words(["record", "your", "screen", "and", "ship", "it"]);
		expect(findFillerRegions(segments)).toEqual([]);
	});

	it("does not remove discourse markers by default", () => {
		const segments = words(["things", "i", "like", "basically", "work"]);
		expect(findFillerRegions(segments)).toEqual([]);
	});

	it("removes discourse markers only when opted in", () => {
		const segments = words(["it", "basically", "works"]);
		expect(findFillerRegions(segments, { includeDiscourseMarkers: true })).toHaveLength(1);
	});

	it("matches multi-word phrases across consecutive segments, longest first", () => {
		const segments = words(["it", "you", "know", "works"]);
		const regions = findFillerRegions(segments, { includeDiscourseMarkers: true });

		expect(regions).toHaveLength(1);
		// Spans "you"(0.4-0.8) through "know"(0.8-1.2), inset by the edge padding.
		expect(regions[0]!.startMs).toBe(Math.round((0.4 + DEFAULT_EDGE_PAD_SEC) * 1000));
		expect(regions[0]!.endMs).toBe(Math.round((1.2 - DEFAULT_EDGE_PAD_SEC) * 1000));
	});

	it("applies language-specific tokens for the requested locale", () => {
		const segments = words(["das", "ähm", "geht"]);
		expect(findFillerRegions(segments, { language: "de" })).toHaveLength(1);
		// The same audio under the wrong language list finds nothing.
		expect(findFillerRegions(segments, { language: "en" })).toEqual([]);
	});

	it("accepts a full locale tag, not just a bare prefix", () => {
		const segments = words(["das", "ähm", "geht"]);
		expect(findFillerRegions(segments, { language: "de-DE" })).toHaveLength(1);
	});

	it("refuses to wipe the clip when every segment looks like filler", () => {
		// Almost always a misdetection (music, noise, wrong language) — never a helpful cut.
		const segments = words(["um", "uh", "erm", "hmm"]);
		expect(findFillerRegions(segments)).toEqual([]);
	});

	it("still cuts when a short clip is genuinely all filler", () => {
		// The guard only applies past two segments, so a real two-word "um uh" is honoured —
		// and the two adjacent matches coalesce into a single cut.
		expect(findFillerRegions(words(["um", "uh"]))).toHaveLength(1);
	});

	it("insets each cut so neighbouring words are not clipped", () => {
		const segments = words(["hello", "um", "world"]);
		const [region] = findFillerRegions(segments);

		expect(region!.startMs).toBe(Math.round((0.4 + DEFAULT_EDGE_PAD_SEC) * 1000));
		expect(region!.endMs).toBe(Math.round((0.8 - DEFAULT_EDGE_PAD_SEC) * 1000));
	});

	it("drops a filler too short to survive padding", () => {
		const segments: CaptionSegment[] = [
			{ text: "hello", startSec: 0, endSec: 0.4 },
			{ text: "um", startSec: 0.4, endSec: 0.44 },
			{ text: "world", startSec: 0.44, endSec: 0.9 },
		];
		expect(findFillerRegions(segments)).toEqual([]);
	});

	it("handles empty and single-segment input", () => {
		expect(findFillerRegions([])).toEqual([]);
		expect(findFillerRegions(words(["um"]))).toHaveLength(1);
	});

	it("sorts out-of-order segments before matching", () => {
		const segments: CaptionSegment[] = [
			{ text: "world", startSec: 1.0, endSec: 1.4 },
			{ text: "um", startSec: 0.4, endSec: 0.9 },
			{ text: "hello", startSec: 0, endSec: 0.4 },
		];
		const [region] = findFillerRegions(segments);
		expect(region!.startMs).toBe(Math.round((0.4 + DEFAULT_EDGE_PAD_SEC) * 1000));
	});
});

describe("findSilenceRegions", () => {
	it("ignores gaps at or below the threshold", () => {
		const segments: CaptionSegment[] = [
			{ text: "one", startSec: 0, endSec: 1 },
			{ text: "two", startSec: 1.5, endSec: 2 },
		];
		expect(findSilenceRegions(segments, { includeLeading: false })).toEqual([]);
	});

	it("collapses a long gap to the residual rather than removing it entirely", () => {
		const segments: CaptionSegment[] = [
			{ text: "one", startSec: 0, endSec: 1 },
			{ text: "two", startSec: 5, endSec: 6 },
		];
		const [region] = findSilenceRegions(segments, {
			includeLeading: false,
			residualSec: 0.2,
		});

		// 4s gap, 0.2s preserved split evenly → cut runs 1.1s..4.9s.
		expect(region!.startMs).toBe(1100);
		expect(region!.endMs).toBe(4900);

		const removedSec = (region!.endMs - region!.startMs) / 1000;
		expect(4 - removedSec).toBeCloseTo(0.2, 5);
	});

	it("never removes a gap down to zero", () => {
		const segments: CaptionSegment[] = [
			{ text: "one", startSec: 0, endSec: 1 },
			{ text: "two", startSec: 9, endSec: 10 },
		];
		const [region] = findSilenceRegions(segments, { includeLeading: false });
		const remaining = 8 - (region!.endMs - region!.startMs) / 1000;
		expect(remaining).toBeGreaterThan(0);
	});

	it("trims leading dead air by default and skips it when disabled", () => {
		const segments: CaptionSegment[] = [{ text: "hello", startSec: 4, endSec: 5 }];
		expect(findSilenceRegions(segments)).toHaveLength(1);
		expect(findSilenceRegions(segments, { includeLeading: false })).toEqual([]);
	});

	it("trims trailing dead air only when the media duration is known", () => {
		const segments: CaptionSegment[] = [{ text: "hello", startSec: 0, endSec: 1 }];
		expect(findSilenceRegions(segments, { includeLeading: false })).toEqual([]);
		expect(
			findSilenceRegions(segments, { includeLeading: false, mediaDurationSec: 10 }),
		).toHaveLength(1);
	});

	it("clamps regions to the media duration", () => {
		const segments: CaptionSegment[] = [{ text: "hello", startSec: 0, endSec: 1 }];
		const [region] = findSilenceRegions(segments, {
			includeLeading: false,
			mediaDurationSec: 10,
		});
		expect(region!.endMs).toBeLessThanOrEqual(10_000);
	});

	it("never emits a region from overlapping segments", () => {
		// Whisper can emit overlaps at chunk boundaries; a negative gap must not invert.
		const segments: CaptionSegment[] = [
			{ text: "one", startSec: 0, endSec: 5 },
			{ text: "two", startSec: 3, endSec: 6 },
		];
		for (const region of findSilenceRegions(segments, { includeLeading: false })) {
			expect(region.endMs).toBeGreaterThan(region.startMs);
		}
	});

	it("handles empty input and back-to-back speech", () => {
		expect(findSilenceRegions([])).toEqual([]);
		expect(findSilenceRegions(words(["a", "b", "c"]), { includeLeading: false })).toEqual([]);
	});
});

describe("mergeTrimRegions", () => {
	it("merges overlapping and exactly-touching regions", () => {
		const merged = mergeTrimRegions([
			{ id: "a", startMs: 0, endMs: 100 },
			{ id: "b", startMs: 100, endMs: 200 },
			{ id: "c", startMs: 150, endMs: 400 },
		]);
		expect(merged).toEqual([{ id: "trim-0", startMs: 0, endMs: 400 }]);
	});

	it("keeps disjoint regions separate and sorted", () => {
		const merged = mergeTrimRegions([
			{ id: "b", startMs: 900, endMs: 1000 },
			{ id: "a", startMs: 0, endMs: 100 },
		]);
		expect(merged.map((r) => r.startMs)).toEqual([0, 900]);
	});

	it("drops empty, inverted, and non-finite regions", () => {
		const merged = mergeTrimRegions([
			{ id: "a", startMs: 100, endMs: 100 },
			{ id: "b", startMs: 400, endMs: 200 },
			{ id: "c", startMs: Number.NaN, endMs: 50 },
		]);
		expect(merged).toEqual([]);
	});
});

describe("filler and silence regions combined", () => {
	it("merges into non-overlapping cuts when a filler sits beside dead air", () => {
		const segments: CaptionSegment[] = [
			{ text: "hello", startSec: 0, endSec: 0.5 },
			{ text: "um", startSec: 0.6, endSec: 1.2 },
			{ text: "world", startSec: 4.0, endSec: 4.5 },
		];
		const combined = mergeTrimRegions([
			...findFillerRegions(segments),
			...findSilenceRegions(segments, { includeLeading: false }),
		]);

		for (let i = 1; i < combined.length; i++) {
			expect(combined[i]!.startMs).toBeGreaterThan(combined[i - 1]!.endMs);
		}
		// The cut must never reach the final word's onset.
		expect(combined[combined.length - 1]!.endMs).toBeLessThan(4000);
	});
});
