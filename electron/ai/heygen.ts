import fs from "node:fs/promises";
import path from "node:path";
import type { HeyGenAvatar, HeyGenVoice } from "../../src/lib/ai/types";
import { getApiKey } from "./vault";

const BASE = "https://api.heygen.com";
const UPLOAD_BASE = "https://upload.heygen.com";

/** Fallback public avatar/voice when lists are empty or user hasn't picked. */
export const DEFAULT_HEYGEN_AVATAR_ID = "Abigail_expressive_2024112501";
export const DEFAULT_HEYGEN_VOICE_ID = "1bd001e7e50f421d891986aad5e3e5d2";

function requireKey(): string {
	const key = getApiKey("heygen");
	if (!key) {
		throw new Error("HeyGen API key not configured. Add it in AI settings.");
	}
	return key;
}

function authHeaders(key: string, json = true): HeadersInit {
	const headers: Record<string, string> = { "X-Api-Key": key };
	if (json) headers["Content-Type"] = "application/json";
	return headers;
}

function mimeFromPath(filePath: string): string {
	const ext = path.extname(filePath).toLowerCase();
	if (ext === ".png") return "image/png";
	if (ext === ".webp") return "image/webp";
	if (ext === ".gif") return "image/gif";
	return "image/jpeg";
}

async function readError(response: Response): Promise<string> {
	try {
		const text = await response.text();
		try {
			const json = JSON.parse(text) as {
				error?: string | { message?: string };
				message?: string;
			};
			if (typeof json.error === "string") return json.error;
			if (json.error && typeof json.error === "object" && json.error.message) {
				return json.error.message;
			}
			if (json.message) return json.message;
		} catch {
			/* fall through */
		}
		return text.slice(0, 240) || `HTTP ${response.status}`;
	} catch {
		return `HTTP ${response.status}`;
	}
}

async function sleep(ms: number) {
	await new Promise((r) => setTimeout(r, ms));
}

export async function listAvatars(): Promise<HeyGenAvatar[]> {
	const key = requireKey();
	const response = await fetch(`${BASE}/v2/avatars`, {
		headers: authHeaders(key),
	});
	if (!response.ok) {
		throw new Error(await readError(response));
	}
	const data = (await response.json()) as {
		data?: {
			avatars?: Array<{
				avatar_id: string;
				avatar_name?: string;
				preview_image_url?: string;
				gender?: string;
			}>;
		};
	};
	return (data.data?.avatars ?? []).map((a) => ({
		avatarId: a.avatar_id,
		name: a.avatar_name || a.avatar_id,
		previewUrl: a.preview_image_url,
		gender: a.gender,
	}));
}

export async function listHeyGenVoices(): Promise<HeyGenVoice[]> {
	const key = requireKey();
	const response = await fetch(`${BASE}/v2/voices`, {
		headers: authHeaders(key),
	});
	if (!response.ok) {
		throw new Error(await readError(response));
	}
	const data = (await response.json()) as {
		data?: {
			voices?: Array<{
				voice_id: string;
				name?: string;
				language?: string;
				gender?: string;
				preview_audio?: string;
			}>;
		};
	};
	return (data.data?.voices ?? []).map((v) => ({
		voiceId: v.voice_id,
		name: v.name || v.voice_id,
		language: v.language,
		gender: v.gender,
		previewUrl: v.preview_audio,
	}));
}

/**
 * Upload a portrait and create a photo avatar look (v3), with talking-photo fallback.
 * Returns an id usable as avatarId (or talkingPhotoId when fallback).
 */
export async function createPhotoAvatarFromImage(options: {
	imagePath: string;
	name?: string;
	onProgress?: (message: string, progress: number) => void;
	isCancelled?: () => boolean;
}): Promise<HeyGenAvatar & { talkingPhotoId?: string }> {
	const key = requireKey();
	const imagePath = options.imagePath;
	const bytes = await fs.readFile(imagePath);
	const mimeType = mimeFromPath(imagePath);
	const fileName = path.basename(imagePath) || "portrait.jpg";
	const name = options.name?.trim() || `Photo ${fileName}`;

	options.onProgress?.("Uploading photo…", 15);
	if (options.isCancelled?.()) throw new Error("Cancelled");

	// Prefer v3 photo avatar: asset upload → create look → poll until ready.
	try {
		const form = new FormData();
		form.append("file", new Blob([new Uint8Array(bytes)], { type: mimeType }), fileName);
		const uploadRes = await fetch(`${BASE}/v3/assets`, {
			method: "POST",
			headers: { "X-Api-Key": key },
			body: form,
		});
		if (!uploadRes.ok) throw new Error(await readError(uploadRes));
		const uploadJson = (await uploadRes.json()) as { data?: { asset_id?: string } };
		const assetId = uploadJson.data?.asset_id;
		if (!assetId) throw new Error("HeyGen asset upload returned no asset_id");

		options.onProgress?.("Creating photo avatar…", 40);
		if (options.isCancelled?.()) throw new Error("Cancelled");

		const createRes = await fetch(`${BASE}/v3/avatars`, {
			method: "POST",
			headers: authHeaders(key),
			body: JSON.stringify({
				type: "photo",
				name,
				file: { type: "asset_id", asset_id: assetId },
			}),
		});
		if (!createRes.ok) throw new Error(await readError(createRes));
		const createJson = (await createRes.json()) as {
			data?: {
				avatar_item?: { id?: string; status?: string; name?: string; preview_image_url?: string };
				avatar_id?: string;
			};
		};
		let lookId = createJson.data?.avatar_item?.id || createJson.data?.avatar_id;
		if (!lookId) throw new Error("HeyGen did not return a photo avatar id");

		// Poll look status when still processing.
		let status = createJson.data?.avatar_item?.status?.toLowerCase() || "processing";
		let attempts = 0;
		while (status === "processing" || status === "pending") {
			if (options.isCancelled?.()) throw new Error("Cancelled");
			if (attempts > 60) break;
			await sleep(3000);
			attempts += 1;
			options.onProgress?.("Training photo avatar…", Math.min(85, 45 + attempts));
			const poll = await fetch(`${BASE}/v3/avatars/${encodeURIComponent(lookId)}`, {
				headers: authHeaders(key),
			});
			if (!poll.ok) break;
			const pollJson = (await poll.json()) as {
				data?: {
					avatar_item?: { id?: string; status?: string; name?: string; preview_image_url?: string };
					status?: string;
					id?: string;
				};
			};
			const item = pollJson.data?.avatar_item;
			lookId = item?.id || pollJson.data?.id || lookId;
			status = (item?.status || pollJson.data?.status || "completed").toLowerCase();
			if (status === "failed" || status === "error") {
				throw new Error("HeyGen photo avatar training failed");
			}
			if (status === "completed" || status === "ready") {
				return {
					avatarId: lookId,
					name: item?.name || name,
					previewUrl: item?.preview_image_url,
				};
			}
		}

		return { avatarId: lookId, name };
	} catch (v3Error) {
		// Fallback: legacy talking photo binary upload (supported through Oct 2026).
		options.onProgress?.("Uploading talking photo (fallback)…", 50);
		if (options.isCancelled?.()) throw new Error("Cancelled");

		const talkRes = await fetch(`${UPLOAD_BASE}/v1/talking_photo`, {
			method: "POST",
			headers: {
				"X-Api-Key": key,
				"Content-Type": mimeType,
			},
			body: bytes,
		});
		if (!talkRes.ok) {
			const v3Msg = v3Error instanceof Error ? v3Error.message : String(v3Error);
			throw new Error(
				`Photo avatar failed (${v3Msg}); talking-photo fallback: ${await readError(talkRes)}`,
			);
		}
		const talkJson = (await talkRes.json()) as {
			data?: { talking_photo_id?: string; talking_photo_url?: string };
			talking_photo_id?: string;
		};
		const talkingPhotoId = talkJson.data?.talking_photo_id || talkJson.talking_photo_id;
		if (!talkingPhotoId) {
			throw new Error("HeyGen talking-photo upload returned no id");
		}
		return {
			avatarId: talkingPhotoId,
			name,
			previewUrl: talkJson.data?.talking_photo_url,
			talkingPhotoId,
		};
	}
}

/**
 * Generate a talking-avatar MP4 via HeyGen v2, poll until ready, download bytes.
 * v2 remains supported through Oct 2026; same vault key works with v3 later.
 */
export async function generateAvatarVideo(options: {
	script: string;
	avatarId?: string;
	talkingPhotoId?: string;
	voiceId?: string;
	width?: number;
	height?: number;
	onProgress?: (message: string, progress: number) => void;
	isCancelled?: () => boolean;
}): Promise<{ bytes: Buffer; mimeType: string; durationMs: number; videoId: string }> {
	const key = requireKey();
	const script = options.script.trim();
	if (!script) throw new Error("Avatar script is empty");
	if (script.length > 5000) throw new Error("Script is too long (max 5000 characters)");

	const talkingPhotoId = options.talkingPhotoId?.trim();
	const avatarId = options.avatarId?.trim() || (!talkingPhotoId ? DEFAULT_HEYGEN_AVATAR_ID : "");
	const voiceId = options.voiceId?.trim() || DEFAULT_HEYGEN_VOICE_ID;
	const width = options.width ?? 1280;
	const height = options.height ?? 720;

	options.onProgress?.("Submitting to HeyGen…", 10);

	const character = talkingPhotoId
		? { type: "talking_photo", talking_photo_id: talkingPhotoId }
		: { type: "avatar", avatar_id: avatarId, avatar_style: "normal" };

	const create = await fetch(`${BASE}/v2/video/generate`, {
		method: "POST",
		headers: authHeaders(key),
		body: JSON.stringify({
			video_inputs: [
				{
					character,
					voice: {
						type: "text",
						input_text: script,
						voice_id: voiceId,
					},
				},
			],
			dimension: { width, height },
		}),
	});
	if (!create.ok) {
		throw new Error(await readError(create));
	}

	const created = (await create.json()) as {
		data?: { video_id?: string };
		error?: string | null;
	};
	const videoId = created.data?.video_id;
	if (!videoId) {
		throw new Error(
			typeof created.error === "string" ? created.error : "HeyGen did not return a video_id",
		);
	}

	options.onProgress?.("Rendering avatar…", 25);

	let attempts = 0;
	const maxAttempts = 180; // ~15 min at 5s
	while (attempts < maxAttempts) {
		if (options.isCancelled?.()) throw new Error("Cancelled");
		await sleep(5000);
		attempts += 1;

		const statusRes = await fetch(
			`${BASE}/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`,
			{ headers: authHeaders(key) },
		);
		if (!statusRes.ok) {
			throw new Error(await readError(statusRes));
		}
		const statusJson = (await statusRes.json()) as {
			data?: {
				status?: string;
				video_url?: string;
				duration?: number;
				error?: { message?: string } | string | null;
			};
		};
		const status = statusJson.data?.status?.toLowerCase();
		const progress = Math.min(90, 25 + attempts * 0.5);
		options.onProgress?.(
			status === "processing" || status === "pending" || status === "waiting"
				? `Rendering avatar (${status})…`
				: `HeyGen status: ${status || "unknown"}…`,
			progress,
		);

		if (status === "completed") {
			const videoUrl = statusJson.data?.video_url;
			if (!videoUrl) throw new Error("HeyGen completed but returned no video_url");

			options.onProgress?.("Downloading avatar video…", 92);
			const download = await fetch(videoUrl);
			if (!download.ok) {
				throw new Error(`Failed to download HeyGen video (${download.status})`);
			}
			const bytes = Buffer.from(await download.arrayBuffer());
			const durationSec =
				typeof statusJson.data?.duration === "number" && statusJson.data.duration > 0
					? statusJson.data.duration
					: Math.max(2, script.split(/\s+/).length / 2.5);
			return {
				bytes,
				mimeType: "video/mp4",
				durationMs: Math.round(durationSec * 1000),
				videoId,
			};
		}

		if (status === "failed" || status === "error") {
			const err = statusJson.data?.error;
			const detail =
				typeof err === "string"
					? err
					: err && typeof err === "object" && err.message
						? err.message
						: "HeyGen render failed";
			throw new Error(detail);
		}
	}

	throw new Error("HeyGen render timed out — try again or check your HeyGen dashboard");
}
