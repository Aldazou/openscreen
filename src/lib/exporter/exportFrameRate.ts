/**
 * Chooses the export frame rate.
 *
 * The editor asks for 60 fps so zoom animations, cursor smoothing and motion blur render
 * smoothly — those are generated per output frame, so they genuinely benefit. But when a
 * project has none of them, every output frame is just a re-render of the same source frame
 * and 60 fps buys nothing.
 *
 * Measured on a 30 fps 1080p source with no synthetic motion: exporting at 60 fps took 12.1s
 * versus 7.0s at 30 fps. The file was only 11% larger — duplicate frames are nearly free in
 * H.264 — so the real cost is encode time, not bytes.
 */

/** Only the fields that decide whether anything animates between source frames. */
export interface FrameRateMotionInputs {
	zoomRegions?: Array<{ startMs: number; endMs: number }>;
	speedRegions?: Array<{ startMs: number; endMs: number; speed: number }>;
	annotationRegions?: Array<{ startMs: number; endMs: number }>;
	overlayClips?: unknown[];
	cursorScale?: number;
	motionBlurAmount?: number;
	webcamVideoUrl?: string;
	webcamReactiveZoom?: boolean;
}

const EPSILON = 0.0001;

function hasSpan(regions?: Array<{ startMs: number; endMs: number }>) {
	return Boolean(regions?.some((r) => r.endMs - r.startMs > EPSILON));
}

/** True when something in the project animates independently of the source video's own frames. */
export function hasSyntheticMotion(config: FrameRateMotionInputs): boolean {
	if (hasSpan(config.zoomRegions)) return true;
	// Annotations animate (text reveal, pop) and image annotations can be animated GIFs.
	if (hasSpan(config.annotationRegions)) return true;
	if (config.speedRegions?.some((r) => r.endMs - r.startMs > EPSILON)) return true;
	if ((config.overlayClips?.length ?? 0) > 0) return true;
	// The rendered cursor is interpolated and smoothed per output frame.
	if ((config.cursorScale ?? 0) > 0) return true;
	if ((config.motionBlurAmount ?? 0) > EPSILON) return true;
	// Covers reactive webcam zoom too: `webcamReactiveZoom` defaults to true even with no
	// webcam attached, so it only means anything alongside an actual webcam track.
	if (config.webcamVideoUrl) return true;
	return false;
}

/**
 * Returns the frame rate to export at: the requested rate when anything animates, otherwise the
 * source rate (never *raising* it above what was asked for).
 */
export function resolveExportFrameRate(
	requestedFrameRate: number,
	sourceFrameRate: number | undefined,
	config: FrameRateMotionInputs,
): number {
	if (!Number.isFinite(requestedFrameRate) || requestedFrameRate <= 0) return 60;
	if (hasSyntheticMotion(config)) return requestedFrameRate;
	if (!sourceFrameRate || !Number.isFinite(sourceFrameRate) || sourceFrameRate <= 0) {
		return requestedFrameRate;
	}
	// Round because containers report rates like 29.97; never go below a sane floor, and never
	// exceed what the caller asked for.
	const rounded = Math.max(1, Math.round(sourceFrameRate));
	return Math.min(requestedFrameRate, rounded);
}
