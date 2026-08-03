import type { ElevenLabsVoice } from "../../src/lib/ai/types";
import { getApiKey } from "./vault";

const BASE = "https://api.elevenlabs.io";

/** Sensible default voice (Rachel) when the user hasn't picked one. */
export const DEFAULT_ELEVENLABS_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";

function requireKey(): string {
	const key = getApiKey("elevenlabs");
	if (!key) {
		throw new Error("ElevenLabs API key not configured. Add it in AI settings.");
	}
	return key;
}

async function readError(response: Response): Promise<string> {
	try {
		const text = await response.text();
		try {
			const json = JSON.parse(text) as { detail?: { message?: string } | string };
			if (typeof json.detail === "string") return json.detail;
			if (json.detail && typeof json.detail === "object" && json.detail.message) {
				return json.detail.message;
			}
		} catch {
			/* fall through */
		}
		return text.slice(0, 240) || `HTTP ${response.status}`;
	} catch {
		return `HTTP ${response.status}`;
	}
}

export async function listVoices(): Promise<ElevenLabsVoice[]> {
	const key = requireKey();
	const response = await fetch(`${BASE}/v1/voices`, {
		headers: { "xi-api-key": key },
	});
	if (!response.ok) {
		throw new Error(await readError(response));
	}
	const data = (await response.json()) as {
		voices?: Array<{
			voice_id: string;
			name: string;
			preview_url?: string;
			category?: string;
		}>;
	};
	return (data.voices ?? []).map((v) => ({
		voiceId: v.voice_id,
		name: v.name,
		previewUrl: v.preview_url,
		category: v.category,
	}));
}

export async function generateSpeech(options: {
	text: string;
	voiceId?: string;
}): Promise<{ bytes: Buffer; mimeType: string; voiceId: string }> {
	const key = requireKey();
	const text = options.text.trim();
	if (!text) throw new Error("Script text is empty");
	if (text.length > 5000) throw new Error("Script is too long (max 5000 characters)");

	const voiceId = options.voiceId?.trim() || DEFAULT_ELEVENLABS_VOICE_ID;
	const response = await fetch(`${BASE}/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
		method: "POST",
		headers: {
			"xi-api-key": key,
			"Content-Type": "application/json",
			Accept: "audio/mpeg",
		},
		body: JSON.stringify({
			text,
			model_id: "eleven_multilingual_v2",
		}),
	});
	if (!response.ok) {
		throw new Error(await readError(response));
	}
	const bytes = Buffer.from(await response.arrayBuffer());
	return { bytes, mimeType: "audio/mpeg", voiceId };
}

export async function generateMusic(options: {
	prompt: string;
	lengthMs?: number;
}): Promise<{ bytes: Buffer; mimeType: string; durationMs: number }> {
	const key = requireKey();
	const prompt = options.prompt.trim();
	if (!prompt) throw new Error("Music prompt is empty");

	const lengthMs = Math.min(120_000, Math.max(3_000, options.lengthMs ?? 15_000));
	const response = await fetch(`${BASE}/v1/music?output_format=mp3_44100_128`, {
		method: "POST",
		headers: {
			"xi-api-key": key,
			"Content-Type": "application/json",
			Accept: "audio/mpeg",
		},
		body: JSON.stringify({
			prompt,
			music_length_ms: lengthMs,
			model_id: "music_v1",
		}),
	});
	if (!response.ok) {
		throw new Error(await readError(response));
	}
	const bytes = Buffer.from(await response.arrayBuffer());
	return { bytes, mimeType: "audio/mpeg", durationMs: lengthMs };
}
