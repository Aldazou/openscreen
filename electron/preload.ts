import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { NativeMacRecordingRequest } from "../src/lib/nativeMacRecording";
import type { NativeWindowsRecordingRequest } from "../src/lib/nativeWindowsRecording";
import type { RecordingSession, StoreRecordedSessionInput } from "../src/lib/recordingSession";
import type { ShortcutBinding } from "../src/lib/shortcuts";
import { NATIVE_BRIDGE_CHANNEL, type NativeBridgeRequest } from "../src/native/contracts";

// Asset base URL is passed from the main process via webPreferences.additionalArguments
// (see windows.ts). Sandboxed preloads cannot import node:path / node:url, so we
// can't compute it here.
const ASSET_BASE_URL_ARG_PREFIX = "--asset-base-url=";
const assetBaseUrlArg = process.argv.find((arg) => arg.startsWith(ASSET_BASE_URL_ARG_PREFIX));
const assetBaseUrl = assetBaseUrlArg ? assetBaseUrlArg.slice(ASSET_BASE_URL_ARG_PREFIX.length) : "";

contextBridge.exposeInMainWorld("electronAPI", {
	assetBaseUrl,
	invokeNativeBridge: <TData>(request: NativeBridgeRequest) => {
		return ipcRenderer.invoke(NATIVE_BRIDGE_CHANNEL, request) as Promise<TData>;
	},
	hudOverlayHide: () => {
		ipcRenderer.send("hud-overlay-hide");
	},
	hudOverlayClose: () => {
		ipcRenderer.send("hud-overlay-close");
	},
	setHudOverlayIgnoreMouseEvents: (ignore: boolean) => {
		ipcRenderer.send("hud-overlay-ignore-mouse-events", ignore);
	},
	moveHudOverlayBy: (deltaX: number, deltaY: number) => {
		ipcRenderer.send("hud-overlay-move-by", deltaX, deltaY);
	},
	setHudOverlaySize: (width: number, height: number) => {
		ipcRenderer.send("hud-overlay-set-size", width, height);
	},
	getSources: async (opts: Electron.SourcesOptions) => {
		return await ipcRenderer.invoke("get-sources", opts);
	},
	switchToEditor: () => {
		return ipcRenderer.invoke("switch-to-editor");
	},
	switchToHud: () => {
		return ipcRenderer.invoke("switch-to-hud");
	},
	startNewRecording: () => {
		return ipcRenderer.invoke("start-new-recording");
	},
	openSourceSelector: () => {
		return ipcRenderer.invoke("open-source-selector");
	},
	selectSource: (source: ProcessedDesktopSource) => {
		return ipcRenderer.invoke("select-source", source);
	},
	getSelectedSource: () => {
		return ipcRenderer.invoke("get-selected-source");
	},
	openRegionPicker: (displayId?: string) => {
		return ipcRenderer.invoke("open-region-picker", displayId);
	},
	regionPickerComplete: (payload: {
		canceled: boolean;
		region?: { x: number; y: number; width: number; height: number };
	}) => {
		return ipcRenderer.invoke("region-picker-complete", payload);
	},
	listRecentRecordings: () => {
		return ipcRenderer.invoke("list-recent-recordings");
	},
	copyTextToClipboard: (text: string) => {
		return ipcRenderer.invoke("copy-text-to-clipboard", text);
	},
	canShareFile: () => {
		return ipcRenderer.invoke("can-share-file");
	},
	shareFile: (filePath: string) => {
		return ipcRenderer.invoke("share-file", filePath);
	},
	requestCameraAccess: () => {
		return ipcRenderer.invoke("request-camera-access");
	},
	requestScreenAccess: () => {
		return ipcRenderer.invoke("request-screen-access");
	},
	requestNativeMacCursorAccess: () => {
		return ipcRenderer.invoke("request-native-mac-cursor-access");
	},
	storeRecordedVideo: (videoData: ArrayBuffer, fileName: string) => {
		return ipcRenderer.invoke("store-recorded-video", videoData, fileName);
	},
	storeRecordedSession: (payload: StoreRecordedSessionInput) => {
		return ipcRenderer.invoke("store-recorded-session", payload);
	},
	openRecordingStream: (fileName: string) => {
		return ipcRenderer.invoke("open-recording-stream", fileName);
	},
	appendRecordingChunk: (fileName: string, chunk: ArrayBuffer) => {
		return ipcRenderer.invoke("append-recording-chunk", fileName, chunk);
	},
	closeRecordingStream: (fileName: string) => {
		return ipcRenderer.invoke("close-recording-stream", fileName);
	},

	getRecordedVideoPath: () => {
		return ipcRenderer.invoke("get-recorded-video-path");
	},
	setRecordingState: (
		recording: boolean,
		recordingId?: number,
		cursorCaptureMode?: import("../src/lib/recordingSession").CursorCaptureMode,
	) => {
		return ipcRenderer.invoke("set-recording-state", recording, recordingId, cursorCaptureMode);
	},
	isNativeWindowsCaptureAvailable: () => {
		return ipcRenderer.invoke("is-native-windows-capture-available");
	},
	isNativeMacCaptureAvailable: () => {
		return ipcRenderer.invoke("is-native-mac-capture-available");
	},
	startNativeWindowsRecording: (request: NativeWindowsRecordingRequest) => {
		return ipcRenderer.invoke("start-native-windows-recording", request);
	},
	stopNativeWindowsRecording: (discard?: boolean) => {
		return ipcRenderer.invoke("stop-native-windows-recording", discard);
	},
	pauseNativeWindowsRecording: () => {
		return ipcRenderer.invoke("pause-native-windows-recording");
	},
	resumeNativeWindowsRecording: () => {
		return ipcRenderer.invoke("resume-native-windows-recording");
	},
	startNativeMacRecording: (request: NativeMacRecordingRequest) => {
		return ipcRenderer.invoke("start-native-mac-recording", request);
	},
	pauseNativeMacRecording: () => {
		return ipcRenderer.invoke("pause-native-mac-recording");
	},
	resumeNativeMacRecording: () => {
		return ipcRenderer.invoke("resume-native-mac-recording");
	},
	stopNativeMacRecording: (discard?: boolean) => {
		return ipcRenderer.invoke("stop-native-mac-recording", discard);
	},
	attachNativeMacWebcamRecording: (payload: {
		screenVideoPath: string;
		recordingId: number;
		webcam: { fileName: string; videoData: ArrayBuffer };
		cursorCaptureMode?: import("../src/lib/recordingSession").CursorCaptureMode;
	}) => {
		return ipcRenderer.invoke("attach-native-mac-webcam-recording", payload);
	},
	getCursorTelemetry: (videoPath?: string) => {
		return ipcRenderer.invoke("get-cursor-telemetry", videoPath);
	},
	discardCursorTelemetry: (recordingId: number) => {
		return ipcRenderer.invoke("discard-cursor-telemetry", recordingId);
	},
	onStopRecordingFromTray: (callback: () => void) => {
		const listener = () => callback();
		ipcRenderer.on("stop-recording-from-tray", listener);
		return () => ipcRenderer.removeListener("stop-recording-from-tray", listener);
	},
	openExternalUrl: (url: string) => {
		return ipcRenderer.invoke("open-external-url", url);
	},
	pickExportSavePath: (fileName: string, exportFolder?: string) => {
		return ipcRenderer.invoke("pick-export-save-path", fileName, exportFolder);
	},
	writeExportToPath: (videoData: ArrayBuffer, filePath: string) => {
		return ipcRenderer.invoke("write-export-to-path", videoData, filePath);
	},
	openVideoFilePicker: () => {
		return ipcRenderer.invoke("open-video-file-picker");
	},
	setCurrentVideoPath: (path: string) => {
		return ipcRenderer.invoke("set-current-video-path", path);
	},
	setCurrentRecordingSession: (session: RecordingSession | null) => {
		return ipcRenderer.invoke("set-current-recording-session", session);
	},
	getCurrentVideoPath: () => {
		return ipcRenderer.invoke("get-current-video-path");
	},
	getCurrentRecordingSession: () => {
		return ipcRenderer.invoke("get-current-recording-session");
	},
	readBinaryFile: (filePath: string) => {
		return ipcRenderer.invoke("read-binary-file", filePath);
	},
	preparePreviewAudioTrack: (filePath: string) => {
		return ipcRenderer.invoke("prepare-preview-audio-track", filePath);
	},
	clearCurrentVideoPath: () => {
		return ipcRenderer.invoke("clear-current-video-path");
	},
	saveProjectFile: (projectData: unknown, suggestedName?: string, existingProjectPath?: string) => {
		return ipcRenderer.invoke("save-project-file", projectData, suggestedName, existingProjectPath);
	},
	loadProjectFile: (projectFolder?: string) => {
		return ipcRenderer.invoke("load-project-file", projectFolder);
	},
	loadProjectFileFromPath: (filePath: string) => {
		return ipcRenderer.invoke("load-project-file-from-path", filePath);
	},
	getPathForFile: (file: File) => {
		try {
			return webUtils.getPathForFile(file);
		} catch {
			return "";
		}
	},
	loadCurrentProjectFile: () => {
		return ipcRenderer.invoke("load-current-project-file");
	},
	onMenuNewProject: (callback: () => void) => {
		const listener = () => callback();
		ipcRenderer.on("menu-new-project", listener);
		return () => ipcRenderer.removeListener("menu-new-project", listener);
	},
	onMenuImportVideo: (callback: () => void) => {
		const listener = () => callback();
		ipcRenderer.on("menu-import-video", listener);
		return () => ipcRenderer.removeListener("menu-import-video", listener);
	},
	onMenuLoadProject: (callback: () => void) => {
		const listener = () => callback();
		ipcRenderer.on("menu-load-project", listener);
		return () => ipcRenderer.removeListener("menu-load-project", listener);
	},
	onMenuSaveProject: (callback: () => void) => {
		const listener = () => callback();
		ipcRenderer.on("menu-save-project", listener);
		return () => ipcRenderer.removeListener("menu-save-project", listener);
	},
	onMenuSaveProjectAs: (callback: () => void) => {
		const listener = () => callback();
		ipcRenderer.on("menu-save-project-as", listener);
		return () => ipcRenderer.removeListener("menu-save-project-as", listener);
	},
	getPlatform: () => {
		return ipcRenderer.invoke("get-platform");
	},
	revealInFolder: (filePath: string) => {
		return ipcRenderer.invoke("reveal-in-folder", filePath);
	},
	getShortcuts: () => {
		return ipcRenderer.invoke("get-shortcuts");
	},
	saveShortcuts: (shortcuts: unknown) => {
		return ipcRenderer.invoke("save-shortcuts", shortcuts);
	},
	updateGlobalShortcut: (binding: ShortcutBinding) => {
		return ipcRenderer.invoke("update-global-shortcut", binding);
	},
	setLocale: (locale: string) => {
		return ipcRenderer.invoke("set-locale", locale);
	},
	saveDiagnostic: (payload: {
		error: string;
		stack?: string;
		projectState: unknown;
		logs: string[];
	}) => {
		return ipcRenderer.invoke("save-diagnostic", payload);
	},
	setMicrophoneExpanded: (expanded: boolean) => {
		ipcRenderer.send("hud:setMicrophoneExpanded", expanded);
	},
	setHasUnsavedChanges: (hasChanges: boolean) => {
		ipcRenderer.send("set-has-unsaved-changes", hasChanges);
	},
	showCountdownOverlay: (value: number, runId: number) => {
		return ipcRenderer.invoke("countdown-overlay-show", value, runId);
	},
	setCountdownOverlayValue: (value: number, runId: number) => {
		return ipcRenderer.invoke("countdown-overlay-set-value", value, runId);
	},
	hideCountdownOverlay: (runId: number) => {
		return ipcRenderer.invoke("countdown-overlay-hide", runId);
	},
	onCountdownOverlayValue: (callback: (value: number | null) => void) => {
		const listener = (_event: unknown, value: number | null) => callback(value);
		ipcRenderer.on("countdown-overlay-value", listener);
		return () => ipcRenderer.removeListener("countdown-overlay-value", listener);
	},
	onRequestSaveBeforeClose: (callback: () => Promise<boolean> | boolean) => {
		const listener = async () => {
			try {
				const shouldClose = await callback();
				ipcRenderer.send("save-before-close-done", shouldClose);
			} catch {
				ipcRenderer.send("save-before-close-done", false);
			}
		};
		ipcRenderer.on("request-save-before-close", listener);
		return () => ipcRenderer.removeListener("request-save-before-close", listener);
	},
	onRequestCloseConfirm: (callback: () => void) => {
		const listener = () => callback();
		ipcRenderer.on("request-close-confirm", listener);
		return () => ipcRenderer.removeListener("request-close-confirm", listener);
	},
	sendCloseConfirmResponse: (choice: "save" | "discard" | "cancel") => {
		ipcRenderer.send("close-confirm-response", choice);
	},

	// AI Director foundation
	aiSetApiKey: (provider: import("../src/lib/ai/types").AiProviderId, key: string) => {
		return ipcRenderer.invoke("ai-set-api-key", provider, key);
	},
	aiClearApiKey: (provider: import("../src/lib/ai/types").AiProviderId) => {
		return ipcRenderer.invoke("ai-clear-api-key", provider);
	},
	aiGetApiKeyStatus: (provider: import("../src/lib/ai/types").AiProviderId) => {
		return ipcRenderer.invoke("ai-get-api-key-status", provider);
	},
	aiGetAllApiKeyStatuses: () => {
		return ipcRenderer.invoke("ai-get-all-api-key-statuses");
	},
	aiListAssets: (projectId: string) => {
		return ipcRenderer.invoke("ai-list-assets", projectId);
	},
	aiOpenImportPicker: () => {
		return ipcRenderer.invoke("ai-open-import-picker");
	},
	aiImportFile: (payload: { projectId: string; sourcePath: string; prompt?: string }) => {
		return ipcRenderer.invoke("ai-import-file", payload);
	},
	aiDeleteAsset: (payload: { projectId: string; assetId: string }) => {
		return ipcRenderer.invoke("ai-delete-asset", payload);
	},
	aiEnqueueImportJob: (payload: {
		kind: "import-file" | "import-url";
		projectId: string;
		sourcePath?: string;
		url?: string;
		prompt?: string;
	}) => {
		return ipcRenderer.invoke("ai-enqueue-import-job", payload);
	},
	aiListJobs: () => {
		return ipcRenderer.invoke("ai-list-jobs");
	},
	aiGetJob: (jobId: string) => {
		return ipcRenderer.invoke("ai-get-job", jobId);
	},
	aiCancelJob: (jobId: string) => {
		return ipcRenderer.invoke("ai-cancel-job", jobId);
	},
	onAiJobProgress: (callback: (payload: { job: import("../src/lib/ai/types").AiJob }) => void) => {
		const listener = (_event: unknown, payload: { job: import("../src/lib/ai/types").AiJob }) =>
			callback(payload);
		ipcRenderer.on("ai-job-progress", listener);
		return () => ipcRenderer.removeListener("ai-job-progress", listener);
	},
	aiListVoices: () => {
		return ipcRenderer.invoke("ai-list-voices");
	},
	aiGenerateTts: (payload: { projectId: string; text: string; voiceId?: string }) => {
		return ipcRenderer.invoke("ai-generate-tts", payload);
	},
	aiGenerateMusic: (payload: { projectId: string; prompt: string; lengthMs?: number }) => {
		return ipcRenderer.invoke("ai-generate-music", payload);
	},
	aiGenerateImage: (payload: { projectId: string; prompt: string }) => {
		return ipcRenderer.invoke("ai-generate-image", payload);
	},
	aiGenerateVideo: (payload: { projectId: string; prompt: string; durationSec?: 5 | 10 }) => {
		return ipcRenderer.invoke("ai-generate-video", payload);
	},
	aiListAvatars: () => {
		return ipcRenderer.invoke("ai-list-avatars");
	},
	aiListHeyGenVoices: () => {
		return ipcRenderer.invoke("ai-list-heygen-voices");
	},
	aiOpenPhotoAvatarPicker: () => {
		return ipcRenderer.invoke("ai-open-photo-avatar-picker");
	},
	aiCreatePhotoAvatar: (payload: { imagePath: string; name?: string }) => {
		return ipcRenderer.invoke("ai-create-photo-avatar", payload);
	},
	aiGenerateAvatar: (payload: {
		projectId: string;
		script: string;
		avatarId?: string;
		talkingPhotoId?: string;
		voiceId?: string;
		photoPath?: string;
	}) => {
		return ipcRenderer.invoke("ai-generate-avatar", payload);
	},
	aiDirectorTurn: (payload: import("../src/lib/ai/types").DirectorTurnRequest) => {
		return ipcRenderer.invoke("ai-director-turn", payload);
	},
});
