import { describe, expect, it } from "vitest";
import { buildZoomRegionsFromRecordingMarks } from "@/lib/recordingMarks";
import { normalizeRecordingMarks } from "@/lib/recordingSession";

describe("recording marks", () => {
	it("normalizes and sorts marks", () => {
		const marks = normalizeRecordingMarks([
			{ id: "b", timeMs: 2000, cx: 0.8, cy: 0.2, kind: "emphasis" },
			{ id: "a", timeMs: 500, cx: 0.1, cy: 0.9, kind: "emphasis" },
			{ id: "bad", timeMs: -1, cx: 0.5, cy: 0.5, kind: "emphasis" },
		]);
		expect(marks?.map((mark) => mark.id)).toEqual(["a", "b"]);
	});

	it("builds non-overlapping zoom spans within the video", () => {
		let n = 0;
		const regions = buildZoomRegionsFromRecordingMarks({
			marks: [
				{ id: "m1", timeMs: 1000, cx: 0.25, cy: 0.75, kind: "emphasis" },
				{ id: "m2", timeMs: 9000, cx: 0.5, cy: 0.5, kind: "emphasis" },
			],
			totalMs: 10_000,
			nextId: () => `zoom-${++n}`,
		});
		expect(regions).toHaveLength(2);
		expect(regions[0].source).toBe("recording-mark");
		expect(regions[0].startMs).toBe(700);
		expect(regions[0].endMs).toBe(2500);
		expect(regions[0].focus).toEqual({ cx: 0.25, cy: 0.75 });
		expect(regions[1].endMs).toBe(10_000);
	});
});
