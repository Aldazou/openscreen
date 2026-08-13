/**
 * Builds a reviewable "clean up audio" plan from a transcript: which filler words and which
 * over-long pauses would be cut, and how much time that saves.
 *
 * Kept separate from the editor component so the decision logic is pure and testable — the
 * component only renders the plan and applies it.
 */
import type { TrimRegion } from "@/components/video-editor/types";
import type { CaptionSegment, CaptionTimestampGranularity } from "./transcribe";
import {
	type FillerRegionOptions,
	findFillerRegions,
	findSilenceRegions,
	mergeTrimRegions,
	type SilenceRegionOptions,
} from "./transcriptEdits";

export interface CleanupPlanOptions {
	/** Remove filler words. Default true. */
	removeFillers?: boolean;
	/**
	 * Collapse over-long pauses. Default false — silence removal changes pacing everywhere in
	 * the take, so it is opt-in even though it usually saves the most time.
	 */
	removeSilences?: boolean;
	/** Locale driving the filler word list. */
	language?: string;
	filler?: Omit<FillerRegionOptions, "language" | "idPrefix">;
	silence?: Omit<SilenceRegionOptions, "idPrefix">;
	/** Total media length, enabling trailing-silence detection and save-percentage maths. */
	mediaDurationSec?: number;
}

export interface CleanupPlan {
	/** Every cut, merged and sorted — what actually gets applied. */
	regions: TrimRegion[];
	/** Distinct filler cuts found (before merging with silences). */
	fillerCount: number;
	/** Distinct silence cuts found (before merging with fillers). */
	silenceCount: number;
	/** Total duration removed if the plan is applied. */
	removedMs: number;
	/** Share of the media removed, 0–1. Zero when the duration is unknown. */
	removedFraction: number;
	/**
	 * Set when filler detection was skipped because the transcript is phrase-level. Filler
	 * matching needs one word per segment; against phrases it would cut whole sentences.
	 */
	fillersUnavailableReason?: "phrase-granularity";
}

/** A plan that would remove more of the take than this is reported but never pre-selected. */
export const CLEANUP_REVIEW_FRACTION = 0.5;

export function buildCleanupPlan(
	segments: CaptionSegment[],
	granularity: CaptionTimestampGranularity,
	options: CleanupPlanOptions = {},
): CleanupPlan {
	const {
		removeFillers = true,
		removeSilences = false,
		language,
		filler,
		silence,
		mediaDurationSec,
	} = options;

	// Filler matching assumes one word per segment. Phrase-level segments would match a whole
	// sentence containing "um" and cut all of it, so skip rather than guess.
	const canDetectFillers = granularity === "word";

	const fillerRegions =
		removeFillers && canDetectFillers
			? findFillerRegions(segments, { ...filler, language, idPrefix: "filler" })
			: [];

	const silenceRegions = removeSilences
		? findSilenceRegions(segments, {
				...silence,
				mediaDurationSec: silence?.mediaDurationSec ?? mediaDurationSec,
				idPrefix: "silence",
			})
		: [];

	const regions = mergeTrimRegions([...fillerRegions, ...silenceRegions], "cleanup");
	const removedMs = regions.reduce((sum, r) => sum + (r.endMs - r.startMs), 0);
	const durationMs =
		typeof mediaDurationSec === "number" && Number.isFinite(mediaDurationSec)
			? mediaDurationSec * 1000
			: 0;

	return {
		regions,
		fillerCount: fillerRegions.length,
		silenceCount: silenceRegions.length,
		removedMs,
		removedFraction: durationMs > 0 ? Math.min(1, removedMs / durationMs) : 0,
		...(removeFillers && !canDetectFillers
			? { fillersUnavailableReason: "phrase-granularity" as const }
			: {}),
	};
}

/**
 * Merges a cleanup plan into the trim regions already on the timeline, renumbering ids so they
 * cannot collide with existing ones. Existing trims are preserved — cleanup adds cuts, it never
 * replaces the user's own edits.
 */
export function applyCleanupPlan(existing: TrimRegion[], plan: CleanupPlan): TrimRegion[] {
	return mergeTrimRegions([...existing, ...plan.regions], "trim");
}
