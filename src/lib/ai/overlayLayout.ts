import type { OverlayClip, OverlayLayoutPreset } from "./types";

export interface OverlayRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Computes the destination rect for an overlay clip within a canvas. */
export function computeOverlayRect(
	canvasWidth: number,
	canvasHeight: number,
	layout: OverlayLayoutPreset,
	sizePercent: number,
	assetAspect = 16 / 9,
): OverlayRect {
	if (layout === "full") {
		return { x: 0, y: 0, width: canvasWidth, height: canvasHeight };
	}

	const shortSide = Math.min(canvasWidth, canvasHeight);
	const targetHeight = Math.max(24, (shortSide * Math.min(60, Math.max(10, sizePercent))) / 100);
	const targetWidth = targetHeight * assetAspect;
	const margin = Math.max(12, shortSide * 0.03);

	let x = margin;
	let y = margin;
	switch (layout) {
		case "bottom-right":
			x = canvasWidth - targetWidth - margin;
			y = canvasHeight - targetHeight - margin;
			break;
		case "bottom-left":
			x = margin;
			y = canvasHeight - targetHeight - margin;
			break;
		case "top-right":
			x = canvasWidth - targetWidth - margin;
			y = margin;
			break;
		case "top-left":
			x = margin;
			y = margin;
			break;
	}

	return {
		x: Math.max(0, x),
		y: Math.max(0, y),
		width: Math.min(canvasWidth, targetWidth),
		height: Math.min(canvasHeight, targetHeight),
	};
}

/** Returns overlays active at a timeline time (ms). */
export function activeOverlayClips(clips: OverlayClip[], timelineMs: number): OverlayClip[] {
	return clips.filter((clip) => {
		const duration = Math.max(0, clip.endMs - clip.startMs);
		const end = clip.timelineStartMs + duration;
		return timelineMs >= clip.timelineStartMs && timelineMs < end;
	});
}

/** Source time within the asset for a timeline position. */
export function overlaySourceTimeSec(clip: OverlayClip, timelineMs: number): number {
	const offsetMs = Math.max(0, timelineMs - clip.timelineStartMs);
	return (clip.startMs + offsetMs) / 1000;
}
