import {
	clampFocusToDepth,
	DEFAULT_ZOOM_DEPTH,
	ZOOM_DEPTH_SCALES,
	type ZoomRegion,
} from "@/components/video-editor/types";
import type { RecordingMark } from "@/lib/recordingSession";

const MARK_LEAD_MS = 300;
const MARK_HOLD_MS = 1500;

/** Turn HUD recording marks into zoom regions for the editor timeline. */
export function buildZoomRegionsFromRecordingMarks(options: {
	marks: RecordingMark[];
	totalMs: number;
	nextId: () => string;
}): ZoomRegion[] {
	const { marks, totalMs, nextId } = options;
	if (totalMs <= 0 || marks.length === 0) return [];

	return marks.map((mark) => {
		const center = Math.min(totalMs, Math.max(0, Math.round(mark.timeMs)));
		const startMs = Math.max(0, center - MARK_LEAD_MS);
		const endMs = Math.min(totalMs, Math.max(startMs + 400, center + MARK_HOLD_MS));
		return {
			id: nextId(),
			startMs,
			endMs,
			depth: DEFAULT_ZOOM_DEPTH,
			customScale: ZOOM_DEPTH_SCALES[DEFAULT_ZOOM_DEPTH],
			focus: clampFocusToDepth({ cx: mark.cx, cy: mark.cy }, DEFAULT_ZOOM_DEPTH),
			focusMode: "manual" as const,
			source: "recording-mark" as const,
		};
	});
}
