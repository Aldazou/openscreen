import { describe, expect, it } from "vitest";
import { applyCleanupPlan, buildCleanupPlan } from "./audioCleanup";
import type { CaptionSegment } from "./transcribe";

function words(list: string[], step = 0.4): CaptionSegment[] {
	return list.map((text, i) => ({ text, startSec: i * step, endSec: i * step + step }));
}

describe("buildCleanupPlan", () => {
	it("removes fillers by default and leaves silences alone", () => {
		const segments: CaptionSegment[] = [
			{ text: "hello", startSec: 0, endSec: 0.5 },
			{ text: "um", startSec: 0.5, endSec: 1.1 },
			// A 4s pause that must survive, because silence removal is opt-in.
			{ text: "world", startSec: 5.1, endSec: 5.6 },
		];
		const plan = buildCleanupPlan(segments, "word", { mediaDurationSec: 6 });

		expect(plan.fillerCount).toBe(1);
		expect(plan.silenceCount).toBe(0);
		expect(plan.regions).toHaveLength(1);
	});

	it("includes silences only when opted in", () => {
		const segments: CaptionSegment[] = [
			{ text: "hello", startSec: 0, endSec: 0.5 },
			{ text: "world", startSec: 5, endSec: 5.5 },
		];
		const plan = buildCleanupPlan(segments, "word", {
			removeSilences: true,
			silence: { includeLeading: false },
			mediaDurationSec: 6,
		});

		expect(plan.silenceCount).toBe(1);
		expect(plan.removedMs).toBeGreaterThan(0);
	});

	it("skips filler detection on phrase-level transcripts and says why", () => {
		// One segment holding a whole sentence: matching "um" here would cut the sentence.
		const segments: CaptionSegment[] = [
			{ text: "so um this is the dashboard", startSec: 0, endSec: 3 },
		];
		const plan = buildCleanupPlan(segments, "phrase", { mediaDurationSec: 3 });

		expect(plan.fillerCount).toBe(0);
		expect(plan.regions).toEqual([]);
		expect(plan.fillersUnavailableReason).toBe("phrase-granularity");
	});

	it("does not flag phrase-granularity when fillers were not requested", () => {
		const plan = buildCleanupPlan(words(["a", "b"]), "phrase", { removeFillers: false });
		expect(plan.fillersUnavailableReason).toBeUndefined();
	});

	it("merges a filler that overlaps an adjacent silence into one cut", () => {
		const segments: CaptionSegment[] = [
			{ text: "hello", startSec: 0, endSec: 0.5 },
			{ text: "um", startSec: 0.6, endSec: 1.4 },
			{ text: "world", startSec: 5.0, endSec: 5.5 },
		];
		const plan = buildCleanupPlan(segments, "word", {
			removeSilences: true,
			silence: { includeLeading: false },
			mediaDurationSec: 6,
		});

		for (let i = 1; i < plan.regions.length; i++) {
			expect(plan.regions[i]!.startMs).toBeGreaterThan(plan.regions[i - 1]!.endMs);
		}
		expect(plan.removedMs).toBeGreaterThan(0);
	});

	it("reports the removed fraction against the media duration", () => {
		const segments: CaptionSegment[] = [
			{ text: "hello", startSec: 0, endSec: 1 },
			{ text: "world", startSec: 9, endSec: 10 },
		];
		const plan = buildCleanupPlan(segments, "word", {
			removeFillers: false,
			removeSilences: true,
			silence: { includeLeading: false },
			mediaDurationSec: 10,
		});

		expect(plan.removedFraction).toBeGreaterThan(0.5);
		expect(plan.removedFraction).toBeLessThanOrEqual(1);
	});

	it("reports a zero fraction rather than dividing by an unknown duration", () => {
		const plan = buildCleanupPlan(words(["hello", "um", "world"]), "word");
		expect(plan.removedFraction).toBe(0);
		expect(Number.isFinite(plan.removedFraction)).toBe(true);
	});

	it("returns an empty plan for an empty transcript", () => {
		const plan = buildCleanupPlan([], "word", { mediaDurationSec: 10 });
		expect(plan.regions).toEqual([]);
		expect(plan.removedMs).toBe(0);
	});
});

describe("applyCleanupPlan", () => {
	it("keeps the user's existing trims", () => {
		const existing = [{ id: "trim-a", startMs: 0, endMs: 500 }];
		const plan = buildCleanupPlan(
			[
				{ text: "hello", startSec: 2, endSec: 2.5 },
				{ text: "um", startSec: 2.6, endSec: 3.2 },
				{ text: "world", startSec: 3.3, endSec: 3.8 },
			],
			"word",
			{ mediaDurationSec: 4 },
		);
		const merged = applyCleanupPlan(existing, plan);

		// The original 0–500ms cut survives alongside the new one.
		expect(merged[0]!.startMs).toBe(0);
		expect(merged[0]!.endMs).toBe(500);
		expect(merged.length).toBeGreaterThan(1);
	});

	it("merges a cleanup cut that overlaps an existing trim", () => {
		const existing = [{ id: "trim-a", startMs: 0, endMs: 3000 }];
		const plan = buildCleanupPlan(
			[
				{ text: "hello", startSec: 2, endSec: 2.5 },
				{ text: "um", startSec: 2.6, endSec: 3.2 },
				{ text: "world", startSec: 3.3, endSec: 3.8 },
			],
			"word",
			{ mediaDurationSec: 4 },
		);
		const merged = applyCleanupPlan(existing, plan);

		expect(merged).toHaveLength(1);
		expect(merged[0]!.startMs).toBe(0);
		expect(merged[0]!.endMs).toBeGreaterThan(3000);
	});

	it("returns existing trims unchanged for an empty plan", () => {
		const existing = [{ id: "trim-a", startMs: 100, endMs: 500 }];
		const merged = applyCleanupPlan(existing, buildCleanupPlan([], "word"));

		expect(merged).toHaveLength(1);
		expect(merged[0]!.startMs).toBe(100);
		expect(merged[0]!.endMs).toBe(500);
	});

	it("never emits ids that collide", () => {
		const existing = [
			{ id: "trim-0", startMs: 0, endMs: 100 },
			{ id: "trim-1", startMs: 8000, endMs: 8100 },
		];
		const plan = buildCleanupPlan(words(["hello", "um", "world"]), "word");
		const ids = applyCleanupPlan(existing, plan).map((r) => r.id);

		expect(new Set(ids).size).toBe(ids.length);
	});
});
