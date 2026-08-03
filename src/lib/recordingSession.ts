export interface CaptureCropRegion {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface ProjectMedia {
	screenVideoPath: string;
	webcamVideoPath?: string;
	cursorCaptureMode?: CursorCaptureMode;
	/** Normalized crop from region recording (0–1 relative to full capture). */
	cropRegion?: CaptureCropRegion;
}

export type CursorCaptureMode = "editable-overlay" | "system";

/** Timed emphasis mark dropped from the recording HUD (pause → Mark). */
export interface RecordingMark {
	id: string;
	timeMs: number;
	/** Normalized focus in the capture frame (0–1). */
	cx: number;
	cy: number;
	kind: "emphasis";
}

export interface RecordingSession extends ProjectMedia {
	createdAt: number;
	/** In-recording emphasis marks (materialized as zooms on editor open). */
	marks?: RecordingMark[];
}

export interface RecordedVideoAssetInput {
	fileName: string;
	videoData: ArrayBuffer;
}

export interface StoreRecordedSessionInput {
	screen: RecordedVideoAssetInput;
	webcam?: RecordedVideoAssetInput;
	createdAt?: number;
	cursorCaptureMode?: CursorCaptureMode;
	/**
	 * Recording wall-clock duration (ms). The main process patches the WebM Duration
	 * header on streamed recordings (the renderer no longer holds the bytes). Browser
	 * MediaRecorder writes no/zero duration, which breaks the editor seek bar and
	 * timeline for anything that took the streaming path.
	 */
	durationMs?: number;
}

export function normalizeCursorCaptureMode(value: unknown): CursorCaptureMode | undefined {
	return value === "editable-overlay" || value === "system" ? value : undefined;
}

function normalizePath(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}

	const trimmed = value.trim();
	return trimmed ? trimmed : undefined;
}

export function normalizeProjectMedia(candidate: unknown): ProjectMedia | null {
	if (!candidate || typeof candidate !== "object") {
		return null;
	}

	const raw = candidate as Partial<ProjectMedia>;
	const screenVideoPath = normalizePath(raw.screenVideoPath);

	if (!screenVideoPath) {
		return null;
	}

	const webcamVideoPath = normalizePath(raw.webcamVideoPath);
	const cursorCaptureMode = normalizeCursorCaptureMode(raw.cursorCaptureMode);
	const cropRegion = normalizeCaptureCropRegion(raw.cropRegion);

	return {
		screenVideoPath,
		...(webcamVideoPath ? { webcamVideoPath } : {}),
		...(cursorCaptureMode ? { cursorCaptureMode } : {}),
		...(cropRegion ? { cropRegion } : {}),
	};
}

export function normalizeCaptureCropRegion(value: unknown): CaptureCropRegion | undefined {
	if (!value || typeof value !== "object") return undefined;
	const raw = value as Partial<CaptureCropRegion>;
	const x = typeof raw.x === "number" ? raw.x : NaN;
	const y = typeof raw.y === "number" ? raw.y : NaN;
	const width = typeof raw.width === "number" ? raw.width : NaN;
	const height = typeof raw.height === "number" ? raw.height : NaN;
	if (![x, y, width, height].every((n) => Number.isFinite(n))) return undefined;
	if (x < 0 || y < 0 || width <= 0.02 || height <= 0.02) return undefined;
	if (x + width > 1.001 || y + height > 1.001) return undefined;
	return {
		x: Math.max(0, Math.min(1, x)),
		y: Math.max(0, Math.min(1, y)),
		width: Math.max(0.02, Math.min(1 - x, width)),
		height: Math.max(0.02, Math.min(1 - y, height)),
	};
}

export function normalizeRecordingMark(value: unknown): RecordingMark | undefined {
	if (!value || typeof value !== "object") return undefined;
	const raw = value as Partial<RecordingMark>;
	const timeMs = typeof raw.timeMs === "number" ? raw.timeMs : NaN;
	const cx = typeof raw.cx === "number" ? raw.cx : NaN;
	const cy = typeof raw.cy === "number" ? raw.cy : NaN;
	if (![timeMs, cx, cy].every((n) => Number.isFinite(n))) return undefined;
	if (timeMs < 0) return undefined;
	const id =
		typeof raw.id === "string" && raw.id.trim().length > 0
			? raw.id.trim()
			: `mark-${Math.round(timeMs)}`;
	return {
		id,
		timeMs: Math.max(0, timeMs),
		cx: Math.max(0, Math.min(1, cx)),
		cy: Math.max(0, Math.min(1, cy)),
		kind: "emphasis",
	};
}

export function normalizeRecordingMarks(value: unknown): RecordingMark[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const marks = value
		.map((entry) => normalizeRecordingMark(entry))
		.filter((entry): entry is RecordingMark => Boolean(entry))
		.sort((a, b) => a.timeMs - b.timeMs)
		.slice(0, 64);
	return marks.length > 0 ? marks : undefined;
}

export function normalizeRecordingSession(candidate: unknown): RecordingSession | null {
	if (!candidate || typeof candidate !== "object") {
		return null;
	}

	const raw = candidate as Partial<RecordingSession>;
	const media = normalizeProjectMedia(raw);
	if (!media) {
		return null;
	}

	const marks = normalizeRecordingMarks(raw.marks);

	return {
		...media,
		createdAt:
			typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt)
				? raw.createdAt
				: Date.now(),
		...(marks ? { marks } : {}),
	};
}
