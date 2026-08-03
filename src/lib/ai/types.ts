/** AI Director shared types — keys, media library, timeline clips, jobs. */

export type AiProviderId = "fal" | "elevenlabs" | "heygen" | "openai";

export type MediaAssetType = "recording" | "import" | "ai-image" | "ai-video" | "tts" | "music";

export type MediaAssetProvider = AiProviderId | "local" | "import";

export interface MediaAsset {
	id: string;
	type: MediaAssetType;
	/** Absolute filesystem path to the asset file. */
	path: string;
	fileName: string;
	mimeType: string;
	prompt?: string;
	provider: MediaAssetProvider;
	createdAt: number;
	durationMs?: number;
	width?: number;
	height?: number;
}

export type OverlayLayoutPreset =
	| "bottom-right"
	| "bottom-left"
	| "top-right"
	| "top-left"
	| "full";

export interface OverlayClip {
	id: string;
	assetId: string;
	/** Source trim start within the asset (ms). */
	startMs: number;
	/** Source trim end within the asset (ms). */
	endMs: number;
	/** Where the clip begins on the project timeline (ms). */
	timelineStartMs: number;
	opacity: number;
	layout: OverlayLayoutPreset;
	/** Size as % of canvas short side (10–60). */
	sizePercent: number;
}

export type AudioClipKind = "tts" | "music" | "sfx";

export interface AudioClip {
	id: string;
	assetId: string;
	kind: AudioClipKind;
	timelineStartMs: number;
	durationMs: number;
	volume: number;
	/** When true, volume is ducked while primary voice/source audio is present. */
	duckUnderVoice: boolean;
}

export type AiJobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export type AiJobKind =
	| "import-file"
	| "import-url"
	| "generate-tts"
	| "generate-music"
	| "generate-image"
	| "generate-video"
	| "generate-avatar"
	| "create-photo-avatar";

export interface ElevenLabsVoice {
	voiceId: string;
	name: string;
	previewUrl?: string;
	category?: string;
}

export interface HeyGenAvatar {
	avatarId: string;
	name: string;
	previewUrl?: string;
	gender?: string;
	/** Set when created via legacy talking-photo upload fallback. */
	talkingPhotoId?: string;
}

export interface HeyGenVoice {
	voiceId: string;
	name: string;
	language?: string;
	gender?: string;
	previewUrl?: string;
}

export interface AiJob {
	id: string;
	kind: AiJobKind;
	status: AiJobStatus;
	progress: number;
	message?: string;
	error?: string;
	createdAt: number;
	updatedAt: number;
	resultAssetId?: string;
}

export interface AiApiKeyStatus {
	provider: AiProviderId;
	configured: boolean;
	/** Last 4 chars of key when configured; never the full secret. */
	hint?: string;
	source: "vault" | "env" | "none";
}

export const AI_PROVIDERS: readonly AiProviderId[] = [
	"fal",
	"elevenlabs",
	"heygen",
	"openai",
] as const;

/** OpenAI-compatible chat message used by the prompt director. */
export type DirectorRole = "system" | "user" | "assistant" | "tool";

export interface DirectorToolCall {
	id: string;
	name: string;
	arguments: string;
}

export interface DirectorMessage {
	role: DirectorRole;
	content?: string | null;
	tool_call_id?: string;
	name?: string;
	tool_calls?: DirectorToolCall[];
}

export interface DirectorTurnRequest {
	messages: DirectorMessage[];
	/** Compact project context for the system prompt. */
	context?: {
		playheadMs?: number;
		durationMs?: number;
		assetSummaries?: Array<{ id: string; type: string; fileName: string; prompt?: string }>;
		overlayCount?: number;
		audioCount?: number;
		hasVideo?: boolean;
	};
}

export interface DirectorTurnResponse {
	success: boolean;
	message?: DirectorMessage;
	error?: string;
}

export const DEFAULT_OVERLAY_CLIP: Pick<
	OverlayClip,
	"startMs" | "opacity" | "layout" | "sizePercent"
> = {
	startMs: 0,
	opacity: 1,
	layout: "bottom-right",
	sizePercent: 28,
};

export function createId(prefix: string): string {
	return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
