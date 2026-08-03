import type {
	DirectorMessage,
	DirectorToolCall,
	DirectorTurnRequest,
	DirectorTurnResponse,
} from "../../src/lib/ai/types";
import { getApiKey } from "./vault";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o-mini";

const PLACE_AT_PLAYHEAD = {
	type: "boolean",
	description:
		"If true (default), also place the new asset on the timeline at the playhead. Set false only when the user wants library-only.",
} as const;

const DIRECTOR_TOOLS = [
	{
		type: "function",
		function: {
			name: "generateImage",
			description:
				"Generate an AI image (B-roll still) with fal. Defaults to placing it on the timeline at the playhead.",
			parameters: {
				type: "object",
				properties: {
					prompt: { type: "string", description: "Image prompt" },
					placeAtPlayhead: PLACE_AT_PLAYHEAD,
				},
				required: ["prompt"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "generateVideo",
			description:
				"Generate a short AI video clip with fal and place it at the playhead. Expensive — only when the user clearly wants motion B-roll.",
			parameters: {
				type: "object",
				properties: {
					prompt: { type: "string" },
					durationSec: { type: "number", enum: [5, 10] },
					placeAtPlayhead: PLACE_AT_PLAYHEAD,
				},
				required: ["prompt"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "generateAvatar",
			description:
				"Generate a talking AI avatar video with HeyGen and place it at the playhead. Expensive — confirm intent first.",
			parameters: {
				type: "object",
				properties: {
					script: { type: "string", description: "Words the avatar should speak" },
					avatarId: { type: "string", description: "Optional HeyGen avatar id" },
					voiceId: { type: "string", description: "Optional HeyGen voice id" },
					photoAssetId: {
						type: "string",
						description:
							"Optional media-library image asset id to use as a photo avatar (upload + speak).",
					},
					placeAtPlayhead: PLACE_AT_PLAYHEAD,
				},
				required: ["script"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "createPhotoAvatar",
			description:
				"Create a HeyGen photo avatar from an existing image in the media library (does not render video yet).",
			parameters: {
				type: "object",
				properties: {
					assetId: {
						type: "string",
						description: "Media library image asset id",
					},
					name: { type: "string", description: "Optional display name" },
				},
				required: ["assetId"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "generateVoice",
			description:
				"Generate a spoken voiceover with ElevenLabs and place it at the playhead by default.",
			parameters: {
				type: "object",
				properties: {
					text: { type: "string", description: "Narration script" },
					voiceId: { type: "string", description: "Optional ElevenLabs voice id" },
					placeAtPlayhead: PLACE_AT_PLAYHEAD,
				},
				required: ["text"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "generateMusic",
			description:
				"Generate a background music bed with ElevenLabs and place it at the playhead (ducked) by default.",
			parameters: {
				type: "object",
				properties: {
					prompt: { type: "string", description: "Music style / mood prompt" },
					lengthMs: { type: "number", description: "Length in ms (3000-60000)" },
					placeAtPlayhead: PLACE_AT_PLAYHEAD,
				},
				required: ["prompt"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "placeAsset",
			description:
				"Place a media-library asset on the timeline at the playhead. Prefer generate* with placeAtPlayhead=true for new assets.",
			parameters: {
				type: "object",
				properties: {
					assetId: { type: "string" },
					kind: { type: "string", enum: ["overlay", "audio"] },
					duckUnderVoice: {
						type: "boolean",
						description: "For audio/music: duck under voice (default true for music)",
					},
				},
				required: ["assetId", "kind"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "setDucking",
			description: "Enable or disable music ducking under voice for audio clips.",
			parameters: {
				type: "object",
				properties: {
					duckUnderVoice: { type: "boolean" },
					assetId: {
						type: "string",
						description: "Optional: only update clips using this asset",
					},
				},
				required: ["duckUnderVoice"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "generateCaptions",
			description: "Run on-device auto-captions for the current recording.",
			parameters: {
				type: "object",
				properties: {
					wordsMin: { type: "number" },
					wordsMax: { type: "number" },
				},
			},
		},
	},
	{
		type: "function",
		function: {
			name: "exportProject",
			description: "Open the export dialog so the user can render the video.",
			parameters: {
				type: "object",
				properties: {
					format: { type: "string", enum: ["mp4", "gif"] },
				},
			},
		},
	},
] as const;

function buildSystemPrompt(context: DirectorTurnRequest["context"]): string {
	const assets = context?.assetSummaries?.length
		? context.assetSummaries
				.map((a) => `- ${a.id} [${a.type}] ${a.fileName}${a.prompt ? ` — ${a.prompt}` : ""}`)
				.join("\n")
		: "(empty library)";

	return [
		"You are the OpenScreen AI Director — a concise creative assistant for product demo videos.",
		"You ONLY use the provided tools to mutate the project. Do not invent file paths or asset ids.",
		"Prefer short confirmations after tools succeed. Ask before expensive video generation if unclear.",
		"When the user asks to add B-roll/music/voice/avatar, call the matching generate* tool with placeAtPlayhead=true (default). Prefer one-shot generate+place over separate placeAsset.",
		"Only set placeAtPlayhead=false when the user explicitly wants generation without placing.",
		"Avatar clips are visual overlays. Music ducks under voice. Voiceovers are audio without ducking.",
		"For a photo avatar from a library image, pass photoAssetId to generateAvatar, or call createPhotoAvatar first.",
		"",
		"Project context:",
		`- hasVideo: ${Boolean(context?.hasVideo)}`,
		`- playheadMs: ${context?.playheadMs ?? 0}`,
		`- durationMs: ${context?.durationMs ?? 0}`,
		`- overlayClips: ${context?.overlayCount ?? 0}`,
		`- audioClips: ${context?.audioCount ?? 0}`,
		"Media library:",
		assets,
	].join("\n");
}

function toOpenAiMessages(messages: DirectorMessage[], system: string) {
	return [
		{ role: "system", content: system },
		...messages.map((m) => {
			if (m.role === "tool") {
				return {
					role: "tool" as const,
					tool_call_id: m.tool_call_id || "",
					content: m.content || "",
				};
			}
			if (m.role === "assistant" && m.tool_calls?.length) {
				return {
					role: "assistant" as const,
					content: m.content || null,
					tool_calls: m.tool_calls.map((tc) => ({
						id: tc.id,
						type: "function" as const,
						function: { name: tc.name, arguments: tc.arguments },
					})),
				};
			}
			return {
				role: m.role as "user" | "assistant",
				content: m.content || "",
			};
		}),
	];
}

export async function runDirectorTurn(request: DirectorTurnRequest): Promise<DirectorTurnResponse> {
	const key = getApiKey("openai");
	if (!key) {
		return {
			success: false,
			error:
				"OpenAI API key not configured. Add it under AI → API keys to use the prompt director.",
		};
	}

	const system = buildSystemPrompt(request.context);
	const body = {
		model: MODEL,
		messages: toOpenAiMessages(request.messages, system),
		tools: DIRECTOR_TOOLS,
		tool_choice: "auto",
		temperature: 0.4,
	};

	const response = await fetch(OPENAI_URL, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${key}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});

	if (!response.ok) {
		let detail = `OpenAI error ${response.status}`;
		try {
			const err = (await response.json()) as { error?: { message?: string } };
			if (err.error?.message) detail = err.error.message;
		} catch {
			/* ignore */
		}
		return { success: false, error: detail };
	}

	const data = (await response.json()) as {
		choices?: Array<{
			message?: {
				role?: string;
				content?: string | null;
				tool_calls?: Array<{
					id: string;
					function?: { name?: string; arguments?: string };
				}>;
			};
		}>;
	};

	const raw = data.choices?.[0]?.message;
	if (!raw) {
		return { success: false, error: "Empty response from director model" };
	}

	const toolCalls: DirectorToolCall[] | undefined = raw.tool_calls?.map((tc) => ({
		id: tc.id,
		name: tc.function?.name || "",
		arguments: tc.function?.arguments || "{}",
	}));

	const message: DirectorMessage = {
		role: "assistant",
		content: raw.content ?? null,
		tool_calls: toolCalls?.filter((t) => t.name),
	};

	return { success: true, message };
}
