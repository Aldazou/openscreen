import {
	DEFAULT_EDITOR_LAYOUT_SETTINGS,
	DEFAULT_EXPORT_SETTINGS,
} from "@/components/video-editor/editorDefaults";
import type { ExportFormat, ExportQuality } from "@/lib/exporter";
import { pushRecentProject, type RecentProjectEntry } from "@/lib/recentItems";
import type { AspectRatio } from "@/utils/aspectRatioUtils";

const PREFS_KEY = "openscreen_user_preferences";

const VALID_ASPECT_RATIOS: readonly string[] = [
	"16:9",
	"9:16",
	"1:1",
	"4:3",
	"4:5",
	"16:10",
	"10:16",
	"native",
];

export interface UserPreferences {
	/** Default padding % */
	padding: number;
	/** Default aspect ratio */
	aspectRatio: AspectRatio;
	/** Default export quality */
	exportQuality: ExportQuality;
	/** Default export format */
	exportFormat: ExportFormat;
	/** Folder used for the most recent successful export, if any */
	exportFolder: string | null;
	/** Folder of the most recently opened project, if any */
	projectFolder: string | null;
	/** Recording HUD control layout */
	trayLayout: "horizontal" | "vertical";
	/** Recently opened .openscreen projects */
	recentProjects: RecentProjectEntry[];
	/** Remembered HUD: microphone on by default */
	recordingMicrophoneEnabled: boolean;
	/** Remembered HUD: system audio on by default */
	recordingSystemAudioEnabled: boolean;
	/** Remembered HUD: webcam on by default */
	recordingWebcamEnabled: boolean;
	/** Remembered HUD: countdown seconds before record (0 = off) */
	recordingCountdownSec: 0 | 3;
	/** Last selected capture source (id + name for rematch after relaunch) */
	lastRecordingSource: { id: string; name: string } | null;
	/** Last HUD capture mode chip (Screen / Window / Region) */
	lastCaptureMode: "screen" | "window" | "region";
	/**
	 * When true, the next HUD mount should open the region picker once
	 * (e.g. Studio home "Record region"), then clear the flag.
	 */
	pendingRegionPick: boolean;
}

export const DEFAULT_PREFS: UserPreferences = {
	padding: DEFAULT_EDITOR_LAYOUT_SETTINGS.padding,
	aspectRatio: DEFAULT_EDITOR_LAYOUT_SETTINGS.aspectRatio,
	exportQuality: DEFAULT_EXPORT_SETTINGS.quality,
	exportFormat: DEFAULT_EXPORT_SETTINGS.format,
	exportFolder: null,
	projectFolder: null,
	trayLayout: "horizontal",
	recentProjects: [],
	recordingMicrophoneEnabled: false,
	recordingSystemAudioEnabled: false,
	recordingWebcamEnabled: false,
	recordingCountdownSec: 3,
	lastRecordingSource: null,
	lastCaptureMode: "screen",
	pendingRegionPick: false,
};

/** Parses stored preferences without throwing on malformed JSON. */
function safeJsonParse(text: string | null): Record<string, unknown> | null {
	if (!text) return null;
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

/** Load preferences from localStorage, falling back to defaults for missing or invalid fields. */
export function loadUserPreferences(): UserPreferences {
	let raw: Record<string, unknown> | null = null;
	try {
		raw = safeJsonParse(localStorage.getItem(PREFS_KEY));
	} catch {
		return { ...DEFAULT_PREFS };
	}
	if (!raw || typeof raw !== "object") return { ...DEFAULT_PREFS };

	return {
		padding:
			typeof raw.padding === "number" &&
			Number.isFinite(raw.padding) &&
			raw.padding >= 0 &&
			raw.padding <= 100
				? raw.padding
				: DEFAULT_PREFS.padding,
		aspectRatio:
			typeof raw.aspectRatio === "string" && VALID_ASPECT_RATIOS.includes(raw.aspectRatio)
				? (raw.aspectRatio as AspectRatio)
				: DEFAULT_PREFS.aspectRatio,
		exportQuality:
			raw.exportQuality === "medium" ||
			raw.exportQuality === "good" ||
			raw.exportQuality === "source"
				? (raw.exportQuality as ExportQuality)
				: DEFAULT_PREFS.exportQuality,
		exportFormat:
			raw.exportFormat === "gif" || raw.exportFormat === "mp4"
				? (raw.exportFormat as ExportFormat)
				: DEFAULT_PREFS.exportFormat,
		exportFolder:
			typeof raw.exportFolder === "string" && raw.exportFolder.length > 0
				? raw.exportFolder
				: DEFAULT_PREFS.exportFolder,
		projectFolder:
			typeof raw.projectFolder === "string" && raw.projectFolder.length > 0
				? raw.projectFolder
				: DEFAULT_PREFS.projectFolder,
		trayLayout:
			raw.trayLayout === "horizontal" || raw.trayLayout === "vertical"
				? raw.trayLayout
				: DEFAULT_PREFS.trayLayout,
		recentProjects: Array.isArray(raw.recentProjects)
			? raw.recentProjects
					.filter((entry): entry is RecentProjectEntry =>
						Boolean(
							entry &&
								typeof entry === "object" &&
								typeof (entry as RecentProjectEntry).path === "string" &&
								(entry as RecentProjectEntry).path.length > 0 &&
								typeof (entry as RecentProjectEntry).name === "string" &&
								typeof (entry as RecentProjectEntry).openedAt === "number",
						),
					)
					.slice(0, 8)
			: DEFAULT_PREFS.recentProjects,
		recordingMicrophoneEnabled:
			typeof raw.recordingMicrophoneEnabled === "boolean"
				? raw.recordingMicrophoneEnabled
				: DEFAULT_PREFS.recordingMicrophoneEnabled,
		recordingSystemAudioEnabled:
			typeof raw.recordingSystemAudioEnabled === "boolean"
				? raw.recordingSystemAudioEnabled
				: DEFAULT_PREFS.recordingSystemAudioEnabled,
		recordingWebcamEnabled:
			typeof raw.recordingWebcamEnabled === "boolean"
				? raw.recordingWebcamEnabled
				: DEFAULT_PREFS.recordingWebcamEnabled,
		recordingCountdownSec:
			raw.recordingCountdownSec === 0 || raw.recordingCountdownSec === 3
				? raw.recordingCountdownSec
				: DEFAULT_PREFS.recordingCountdownSec,
		lastRecordingSource: (() => {
			const entry = raw.lastRecordingSource;
			if (
				entry &&
				typeof entry === "object" &&
				typeof (entry as { id?: unknown }).id === "string" &&
				(entry as { id: string }).id.length > 0 &&
				typeof (entry as { name?: unknown }).name === "string"
			) {
				return {
					id: (entry as { id: string }).id,
					name: (entry as { name: string }).name,
				};
			}
			return DEFAULT_PREFS.lastRecordingSource;
		})(),
		lastCaptureMode:
			raw.lastCaptureMode === "screen" ||
			raw.lastCaptureMode === "window" ||
			raw.lastCaptureMode === "region"
				? raw.lastCaptureMode
				: DEFAULT_PREFS.lastCaptureMode,
		pendingRegionPick:
			typeof raw.pendingRegionPick === "boolean"
				? raw.pendingRegionPick
				: DEFAULT_PREFS.pendingRegionPick,
	};
}

/** Remember a project path in the recent-projects list. */
export function rememberRecentProject(filePath: string): void {
	const current = loadUserPreferences();
	saveUserPreferences({
		recentProjects: pushRecentProject(current.recentProjects, filePath),
	});
}

/**
 * Parent directory of a saved file path. Handles both POSIX and Windows
 * separators since the path comes from the OS save dialog. Root dirs keep their
 * trailing separator so the result stays a valid directory ("/video.mp4" -> "/",
 * "C:\\video.mp4" -> "C:\\"). Returns null if no separator is found.
 */
export function parentDirectoryOf(filePath: string): string | null {
	const lastSep = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
	if (lastSep < 0) return null;

	// POSIX root, e.g. "/video.mp4" -> "/"
	if (lastSep === 0) return filePath[0];

	// Windows drive root, e.g. "C:\\video.mp4" -> "C:\\"
	if (lastSep === 2 && /^[A-Za-z]:[/\\]/.test(filePath)) {
		return filePath.slice(0, lastSep + 1);
	}

	return filePath.slice(0, lastSep);
}

/** Remembered export folder as `string | undefined`, for IPC handlers that treat absence as "use the default". */
export function getExportFolder(): string | undefined {
	return loadUserPreferences().exportFolder ?? undefined;
}

/** Remembered open-project folder as `string | undefined`, for IPC handlers that treat absence as "use the default". */
export function getProjectFolder(): string | undefined {
	return loadUserPreferences().projectFolder ?? undefined;
}

/** Persist preferences to localStorage; only the provided fields are updated. */
export function saveUserPreferences(partial: Partial<UserPreferences>): void {
	const current = loadUserPreferences();
	const merged = { ...current, ...partial };
	try {
		localStorage.setItem(PREFS_KEY, JSON.stringify(merged));
	} catch {
		// localStorage may be unavailable (e.g. private browsing, quota exceeded)
	}
}
