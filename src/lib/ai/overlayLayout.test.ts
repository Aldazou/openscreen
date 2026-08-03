import { describe, expect, it } from "vitest";
import { activeOverlayClips, computeOverlayRect, overlaySourceTimeSec } from "./overlayLayout";
import type { OverlayClip } from "./types";

const clip = (overrides: Partial<OverlayClip> = {}): OverlayClip => ({
	id: "o1",
	assetId: "a1",
	startMs: 0,
	endMs: 5000,
	timelineStartMs: 1000,
	opacity: 1,
	layout: "bottom-right",
	sizePercent: 30,
	...overrides,
});

describe("computeOverlayRect", () => {
	it("places bottom-right overlays inside the canvas", () => {
		const rect = computeOverlayRect(1920, 1080, "bottom-right", 30, 16 / 9);
		expect(rect.width).toBeGreaterThan(0);
		expect(rect.height).toBeGreaterThan(0);
		expect(rect.x + rect.width).toBeLessThanOrEqual(1920);
		expect(rect.y + rect.height).toBeLessThanOrEqual(1080);
	});

	it("fills the canvas for full layout", () => {
		const rect = computeOverlayRect(800, 600, "full", 30);
		expect(rect).toEqual({ x: 0, y: 0, width: 800, height: 600 });
	});
});

describe("activeOverlayClips", () => {
	it("returns clips active at the playhead", () => {
		const clips = [clip(), clip({ id: "o2", timelineStartMs: 8000, endMs: 2000 })];
		expect(activeOverlayClips(clips, 1500).map((c) => c.id)).toEqual(["o1"]);
		expect(activeOverlayClips(clips, 8500).map((c) => c.id)).toEqual(["o2"]);
		expect(activeOverlayClips(clips, 500)).toEqual([]);
	});
});

describe("overlaySourceTimeSec", () => {
	it("maps timeline time into asset source time", () => {
		expect(overlaySourceTimeSec(clip({ startMs: 500 }), 1500)).toBeCloseTo(1.0);
	});
});
