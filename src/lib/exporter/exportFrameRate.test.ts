import { describe, expect, it } from "vitest";
import { hasSyntheticMotion, resolveExportFrameRate } from "./exportFrameRate";

const span = [{ startMs: 0, endMs: 1000 }];

describe("hasSyntheticMotion", () => {
	it("is false for a plain re-encode with nothing animating", () => {
		expect(hasSyntheticMotion({})).toBe(false);
		expect(hasSyntheticMotion({ zoomRegions: [], annotationRegions: [] })).toBe(false);
	});

	it.each([
		["zoom regions", { zoomRegions: span }],
		["annotations", { annotationRegions: span }],
		["speed regions", { speedRegions: [{ startMs: 0, endMs: 1000, speed: 2 }] }],
		["overlay clips", { overlayClips: [{}] }],
		["a rendered cursor", { cursorScale: 1 }],
		["motion blur", { motionBlurAmount: 0.5 }],
		["a webcam track", { webcamVideoUrl: "file:///webcam.mp4" }],
		["reactive zoom with a webcam", { webcamVideoUrl: "file:///w.mp4", webcamReactiveZoom: true }],
	])("is true for %s", (_label, config) => {
		expect(hasSyntheticMotion(config)).toBe(true);
	});

	it("ignores reactive webcam zoom when there is no webcam", () => {
		// DEFAULT_WEBCAM_REACTIVE_ZOOM is true, so this flag is set on every project — including
		// ones with no webcam at all. Treating it as motion kept every export pinned at 60 fps.
		expect(hasSyntheticMotion({ webcamReactiveZoom: true })).toBe(false);
	});

	it("ignores zero-length regions, which animate nothing", () => {
		expect(hasSyntheticMotion({ zoomRegions: [{ startMs: 500, endMs: 500 }] })).toBe(false);
	});
});

describe("resolveExportFrameRate", () => {
	it("drops to the source rate when nothing animates", () => {
		expect(resolveExportFrameRate(60, 30, {})).toBe(30);
	});

	it("keeps the requested rate when anything animates", () => {
		expect(resolveExportFrameRate(60, 30, { zoomRegions: span })).toBe(60);
		expect(resolveExportFrameRate(60, 30, { cursorScale: 1 })).toBe(60);
	});

	it("never raises above the requested rate", () => {
		// A 120 fps source must not force a 120 fps export.
		expect(resolveExportFrameRate(60, 120, {})).toBe(60);
	});

	it("rounds fractional container rates", () => {
		expect(resolveExportFrameRate(60, 29.97, {})).toBe(30);
		expect(resolveExportFrameRate(60, 23.976, {})).toBe(24);
	});

	it("falls back to the requested rate when the source rate is unusable", () => {
		for (const bad of [undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(resolveExportFrameRate(60, bad as number | undefined, {})).toBe(60);
		}
	});

	it("returns a sane default when the requested rate is itself invalid", () => {
		expect(resolveExportFrameRate(Number.NaN, 30, {})).toBe(60);
		expect(resolveExportFrameRate(0, 30, {})).toBe(60);
	});

	it("never returns a rate below 1", () => {
		expect(resolveExportFrameRate(60, 0.4, {})).toBeGreaterThanOrEqual(1);
	});
});
