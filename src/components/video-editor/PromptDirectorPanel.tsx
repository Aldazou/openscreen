import { Loader2, MessageSquare, Send, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	type AudioClip,
	createId,
	DEFAULT_OVERLAY_CLIP,
	type DirectorMessage,
	type DirectorToolCall,
	type DirectorTurnRequest,
	type MediaAsset,
	type OverlayClip,
} from "@/lib/ai/types";

const MAX_TOOL_ROUNDS = 8;

type ChatLine =
	| { id: string; kind: "user"; text: string }
	| { id: string; kind: "assistant"; text: string }
	| { id: string; kind: "tool"; name: string; ok: boolean; detail: string }
	| { id: string; kind: "system"; text: string };

interface PendingExpensiveConfirm {
	toolCall: DirectorToolCall;
	/** Short label for the confirm UI, e.g. "5s AI video" or "avatar video". */
	label: string;
	/** Prompt / script preview. */
	summary: string;
	/** History including the assistant message that requested tools. */
	historyWithAssistant: DirectorMessage[];
	/** Tool results already produced for earlier calls in this batch. */
	completedToolMessages: DirectorMessage[];
	remainingCalls: DirectorToolCall[];
}

function isExpensiveTool(name: string): boolean {
	return name === "generateVideo" || name === "generateAvatar";
}

function expensiveConfirmMeta(call: DirectorToolCall): { label: string; summary: string } {
	const args = parseArgs(call.arguments);
	if (call.name === "generateAvatar") {
		return {
			label: "avatar video",
			summary: String(args.script || "").trim(),
		};
	}
	const sec = args.durationSec === 10 ? 10 : 5;
	return {
		label: `${sec}s AI video`,
		summary: String(args.prompt || "").trim(),
	};
}

interface PromptDirectorPanelProps {
	projectId: string;
	playheadMs: number;
	durationMs: number;
	hasVideo: boolean;
	mediaAssets: MediaAsset[];
	overlayCount: number;
	audioCount: number;
	onMediaAssetsChange: (assets: MediaAsset[]) => void;
	onAddOverlayClip: (clip: OverlayClip) => void;
	onAddAudioClip: (clip: AudioClip) => void;
	onSetDucking: (duckUnderVoice: boolean, assetId?: string) => void;
	onGenerateCaptions: (wordsMin?: number, wordsMax?: number) => void;
	onExport: (format?: "mp4" | "gif") => void;
}

function parseArgs(raw: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(raw || "{}") as unknown;
		return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

function lineId(): string {
	return createId("chat");
}

/**
 * Prompt director chat: OpenAI tool-calling loop in the renderer.
 * Generation secrets stay in Electron; timeline mutations use editor callbacks.
 */
export function PromptDirectorPanel({
	projectId,
	playheadMs,
	durationMs,
	hasVideo,
	mediaAssets,
	overlayCount,
	audioCount,
	onMediaAssetsChange,
	onAddOverlayClip,
	onAddAudioClip,
	onSetDucking,
	onGenerateCaptions,
	onExport,
}: PromptDirectorPanelProps) {
	const [input, setInput] = useState("");
	const [lines, setLines] = useState<ChatLine[]>([
		{
			id: "welcome",
			kind: "system",
			text: "Describe the edit — e.g. “add a short VO and upbeat music at the playhead”. Generations place automatically. Needs an OpenAI key under API keys.",
		},
	]);
	const [messages, setMessages] = useState<DirectorMessage[]>([]);
	const [busy, setBusy] = useState(false);
	const [pendingExpensive, setPendingExpensive] = useState<PendingExpensiveConfirm | null>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const mediaAssetsRef = useRef(mediaAssets);
	mediaAssetsRef.current = mediaAssets;

	// biome-ignore lint/correctness/useExhaustiveDependencies: pin scroll when transcript/status changes
	useEffect(() => {
		const el = scrollRef.current;
		if (el) el.scrollTop = el.scrollHeight;
	}, [lines, busy, pendingExpensive]);

	const buildContext = useCallback((): DirectorTurnRequest["context"] => {
		const assets = mediaAssetsRef.current;
		return {
			playheadMs: Math.round(playheadMs),
			durationMs: Math.round(durationMs),
			hasVideo,
			overlayCount,
			audioCount,
			assetSummaries: assets.slice(0, 40).map((a) => ({
				id: a.id,
				type: a.type,
				fileName: a.fileName,
				prompt: a.prompt,
			})),
		};
	}, [playheadMs, durationMs, hasVideo, overlayCount, audioCount]);

	const placeAsset = useCallback(
		(
			assetId: string,
			kind: "overlay" | "audio",
			duckUnderVoice?: boolean,
		): { ok: boolean; detail: string } => {
			const asset = mediaAssetsRef.current.find((a) => a.id === assetId);
			if (!asset) return { ok: false, detail: `Unknown asset ${assetId}` };

			if (kind === "audio") {
				const duration = asset.durationMs && asset.durationMs > 0 ? asset.durationMs : 15_000;
				const isTts = asset.type === "tts";
				onAddAudioClip({
					id: createId("audio"),
					assetId: asset.id,
					kind: isTts ? "tts" : "music",
					timelineStartMs: Math.max(0, Math.round(playheadMs)),
					durationMs: duration,
					volume: isTts ? 1 : 0.35,
					duckUnderVoice: duckUnderVoice ?? !isTts,
				});
				return { ok: true, detail: `Placed audio ${asset.fileName} at playhead` };
			}

			const duration = asset.durationMs && asset.durationMs > 0 ? asset.durationMs : 5_000;
			onAddOverlayClip({
				id: createId("overlay"),
				assetId: asset.id,
				...DEFAULT_OVERLAY_CLIP,
				endMs: duration,
				timelineStartMs: Math.max(0, Math.round(playheadMs)),
			});
			return { ok: true, detail: `Placed overlay ${asset.fileName} at playhead` };
		},
		[onAddAudioClip, onAddOverlayClip, playheadMs],
	);

	const runTool = useCallback(
		async (
			call: DirectorToolCall,
		): Promise<{ ok: boolean; detail: string; asset?: MediaAsset }> => {
			const args = parseArgs(call.arguments);
			const api = window.electronAPI;
			const shouldPlace = args.placeAtPlayhead !== false;

			const finishGenerate = (
				asset: MediaAsset,
				kind: "overlay" | "audio",
				label: string,
			): { ok: boolean; detail: string; asset: MediaAsset } => {
				mediaAssetsRef.current = [
					asset,
					...mediaAssetsRef.current.filter((a) => a.id !== asset.id),
				];
				onMediaAssetsChange(mediaAssetsRef.current);
				if (!shouldPlace) {
					return { ok: true, detail: `${label} ready (library only): ${asset.id}`, asset };
				}
				const placed = placeAsset(asset.id, kind);
				return {
					ok: placed.ok,
					detail: placed.ok
						? `${label} ready and placed at playhead: ${asset.id}`
						: `${label} ready (${asset.id}) but place failed: ${placed.detail}`,
					asset,
				};
			};

			switch (call.name) {
				case "generateImage": {
					const prompt = String(args.prompt || "").trim();
					if (!prompt) return { ok: false, detail: "prompt required" };
					const result = await api.aiGenerateImage({ projectId, prompt });
					if (!result.success || !result.asset) {
						return { ok: false, detail: result.error || "Image generation failed" };
					}
					return finishGenerate(result.asset, "overlay", "Image");
				}
				case "generateVideo": {
					const prompt = String(args.prompt || "").trim();
					if (!prompt) return { ok: false, detail: "prompt required" };
					const durationSec = args.durationSec === 10 ? 10 : 5;
					const result = await api.aiGenerateVideo({ projectId, prompt, durationSec });
					if (!result.success || !result.asset) {
						return { ok: false, detail: result.error || "Video generation failed" };
					}
					return finishGenerate(result.asset, "overlay", "Video");
				}
				case "createPhotoAvatar": {
					const assetId = String(args.assetId || "").trim();
					const source = mediaAssetsRef.current.find((a) => a.id === assetId);
					if (!source) return { ok: false, detail: `Unknown asset ${assetId}` };
					if (!source.mimeType.startsWith("image/") && source.type !== "ai-image") {
						return { ok: false, detail: "createPhotoAvatar requires an image asset" };
					}
					const name =
						typeof args.name === "string" && args.name.trim() ? args.name.trim() : undefined;
					const result = await api.aiCreatePhotoAvatar({
						imagePath: source.path,
						name,
					});
					if (!result.success || !result.avatar) {
						return { ok: false, detail: result.error || "Photo avatar creation failed" };
					}
					return {
						ok: true,
						detail: `Photo avatar ready: ${result.avatar.avatarId}${
							result.avatar.talkingPhotoId ? ` (talking_photo ${result.avatar.talkingPhotoId})` : ""
						}`,
					};
				}
				case "generateAvatar": {
					const avatarScript = String(args.script || "").trim();
					if (!avatarScript) return { ok: false, detail: "script required" };
					const avatarId =
						typeof args.avatarId === "string" && args.avatarId.trim()
							? args.avatarId.trim()
							: undefined;
					const heygenVoiceId =
						typeof args.voiceId === "string" && args.voiceId.trim()
							? args.voiceId.trim()
							: undefined;
					let photoPath: string | undefined;
					const photoAssetId =
						typeof args.photoAssetId === "string" && args.photoAssetId.trim()
							? args.photoAssetId.trim()
							: undefined;
					if (photoAssetId) {
						const source = mediaAssetsRef.current.find((a) => a.id === photoAssetId);
						if (!source) return { ok: false, detail: `Unknown photo asset ${photoAssetId}` };
						photoPath = source.path;
					}
					const result = await api.aiGenerateAvatar({
						projectId,
						script: avatarScript,
						avatarId: photoPath ? undefined : avatarId,
						voiceId: heygenVoiceId,
						photoPath,
					});
					if (!result.success || !result.asset) {
						return { ok: false, detail: result.error || "Avatar generation failed" };
					}
					return finishGenerate(result.asset, "overlay", "Avatar");
				}
				case "generateVoice": {
					const text = String(args.text || "").trim();
					if (!text) return { ok: false, detail: "text required" };
					const voiceId =
						typeof args.voiceId === "string" && args.voiceId.trim()
							? args.voiceId.trim()
							: undefined;
					const result = await api.aiGenerateTts({ projectId, text, voiceId });
					if (!result.success || !result.asset) {
						return { ok: false, detail: result.error || "Voice generation failed" };
					}
					return finishGenerate(result.asset, "audio", "Voice");
				}
				case "generateMusic": {
					const prompt = String(args.prompt || "").trim();
					if (!prompt) return { ok: false, detail: "prompt required" };
					const lengthMs =
						typeof args.lengthMs === "number" && Number.isFinite(args.lengthMs)
							? Math.round(args.lengthMs)
							: undefined;
					const result = await api.aiGenerateMusic({ projectId, prompt, lengthMs });
					if (!result.success || !result.asset) {
						return { ok: false, detail: result.error || "Music generation failed" };
					}
					return finishGenerate(result.asset, "audio", "Music");
				}
				case "placeAsset": {
					const assetId = String(args.assetId || "").trim();
					const kind = args.kind === "audio" ? "audio" : "overlay";
					const duck = typeof args.duckUnderVoice === "boolean" ? args.duckUnderVoice : undefined;
					return placeAsset(assetId, kind, duck);
				}
				case "setDucking": {
					if (typeof args.duckUnderVoice !== "boolean") {
						return { ok: false, detail: "duckUnderVoice required" };
					}
					const assetId =
						typeof args.assetId === "string" && args.assetId.trim()
							? args.assetId.trim()
							: undefined;
					onSetDucking(args.duckUnderVoice, assetId);
					return {
						ok: true,
						detail: assetId
							? `Ducking ${args.duckUnderVoice ? "on" : "off"} for ${assetId}`
							: `Ducking ${args.duckUnderVoice ? "on" : "off"} for music clips`,
					};
				}
				case "generateCaptions": {
					const wordsMin =
						typeof args.wordsMin === "number" ? Math.round(args.wordsMin) : undefined;
					const wordsMax =
						typeof args.wordsMax === "number" ? Math.round(args.wordsMax) : undefined;
					onGenerateCaptions(wordsMin, wordsMax);
					return { ok: true, detail: "Auto-captions started" };
				}
				case "exportProject": {
					const format = args.format === "gif" ? "gif" : args.format === "mp4" ? "mp4" : undefined;
					onExport(format);
					return { ok: true, detail: "Opened export dialog" };
				}
				default:
					return { ok: false, detail: `Unknown tool: ${call.name}` };
			}
		},
		[projectId, onMediaAssetsChange, placeAsset, onSetDucking, onGenerateCaptions, onExport],
	);

	const finishToolBatchAndContinue = useCallback(
		async (historyWithAssistant: DirectorMessage[], toolMessages: DirectorMessage[]) => {
			const api = window.electronAPI;
			if (!api?.aiDirectorTurn) return;

			let working = [...historyWithAssistant, ...toolMessages];
			for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
				const turn = await api.aiDirectorTurn({
					messages: working,
					context: buildContext(),
				});
				if (!turn.success || !turn.message) {
					setLines((prev) => [
						...prev,
						{ id: lineId(), kind: "system", text: turn.error || "Director turn failed" },
					]);
					setMessages(working);
					return;
				}

				const assistant = turn.message;
				working = [...working, assistant];
				const calls = assistant.tool_calls?.filter((c) => c.name) ?? [];

				if (assistant.content?.trim()) {
					setLines((prev) => [
						...prev,
						{ id: lineId(), kind: "assistant", text: assistant.content!.trim() },
					]);
				}

				if (calls.length === 0) {
					setMessages(working);
					return;
				}

				const nextTools: DirectorMessage[] = [];
				for (let i = 0; i < calls.length; i++) {
					const call = calls[i]!;
					if (isExpensiveTool(call.name)) {
						const meta = expensiveConfirmMeta(call);
						setPendingExpensive({
							toolCall: call,
							label: meta.label,
							summary: meta.summary,
							historyWithAssistant: working,
							completedToolMessages: nextTools,
							remainingCalls: calls.slice(i + 1),
						});
						setMessages(working);
						return;
					}

					const result = await runTool(call);
					setLines((prev) => [
						...prev,
						{
							id: lineId(),
							kind: "tool",
							name: call.name,
							ok: result.ok,
							detail: result.detail,
						},
					]);
					nextTools.push({
						role: "tool",
						tool_call_id: call.id,
						name: call.name,
						content: JSON.stringify({
							ok: result.ok,
							detail: result.detail,
							assetId: result.asset?.id,
						}),
					});
				}

				working = [...working, ...nextTools];
			}

			setLines((prev) => [
				...prev,
				{ id: lineId(), kind: "system", text: "Stopped after too many tool rounds." },
			]);
			setMessages(working);
		},
		[buildContext, runTool],
	);

	const processAssistantTools = useCallback(
		async (history: DirectorMessage[], assistant: DirectorMessage) => {
			const historyWithAssistant = [...history, assistant];
			const calls = assistant.tool_calls?.filter((c) => c.name) ?? [];

			if (assistant.content?.trim()) {
				setLines((prev) => [
					...prev,
					{ id: lineId(), kind: "assistant", text: assistant.content!.trim() },
				]);
			}

			if (calls.length === 0) {
				setMessages(historyWithAssistant);
				return;
			}

			const toolMessages: DirectorMessage[] = [];
			for (let i = 0; i < calls.length; i++) {
				const call = calls[i]!;
				if (isExpensiveTool(call.name)) {
					const meta = expensiveConfirmMeta(call);
					setPendingExpensive({
						toolCall: call,
						label: meta.label,
						summary: meta.summary,
						historyWithAssistant,
						completedToolMessages: toolMessages,
						remainingCalls: calls.slice(i + 1),
					});
					setMessages(historyWithAssistant);
					return;
				}

				const result = await runTool(call);
				setLines((prev) => [
					...prev,
					{
						id: lineId(),
						kind: "tool",
						name: call.name,
						ok: result.ok,
						detail: result.detail,
					},
				]);
				toolMessages.push({
					role: "tool",
					tool_call_id: call.id,
					name: call.name,
					content: JSON.stringify({
						ok: result.ok,
						detail: result.detail,
						assetId: result.asset?.id,
					}),
				});
			}

			await finishToolBatchAndContinue(historyWithAssistant, toolMessages);
		},
		[runTool, finishToolBatchAndContinue],
	);

	const confirmExpensive = async (approved: boolean) => {
		const pending = pendingExpensive;
		if (!pending) return;
		setPendingExpensive(null);
		setBusy(true);
		try {
			const toolResult = approved
				? await runTool(pending.toolCall)
				: {
						ok: false,
						detail: `User declined ${pending.toolCall.name}`,
						asset: undefined as MediaAsset | undefined,
					};

			setLines((prev) => [
				...prev,
				{
					id: lineId(),
					kind: "tool",
					name: pending.toolCall.name,
					ok: toolResult.ok,
					detail: toolResult.detail,
				},
			]);

			const toolMessages: DirectorMessage[] = [
				...pending.completedToolMessages,
				{
					role: "tool",
					tool_call_id: pending.toolCall.id,
					name: pending.toolCall.name,
					content: JSON.stringify({
						ok: toolResult.ok,
						detail: toolResult.detail,
						assetId: toolResult.asset?.id,
					}),
				},
			];

			for (let i = 0; i < pending.remainingCalls.length; i++) {
				const call = pending.remainingCalls[i]!;
				if (isExpensiveTool(call.name)) {
					const meta = expensiveConfirmMeta(call);
					setPendingExpensive({
						toolCall: call,
						label: meta.label,
						summary: meta.summary,
						historyWithAssistant: pending.historyWithAssistant,
						completedToolMessages: toolMessages,
						remainingCalls: pending.remainingCalls.slice(i + 1),
					});
					return;
				}

				const result = await runTool(call);
				setLines((prev) => [
					...prev,
					{
						id: lineId(),
						kind: "tool",
						name: call.name,
						ok: result.ok,
						detail: result.detail,
					},
				]);
				toolMessages.push({
					role: "tool",
					tool_call_id: call.id,
					name: call.name,
					content: JSON.stringify({
						ok: result.ok,
						detail: result.detail,
						assetId: result.asset?.id,
					}),
				});
			}

			await finishToolBatchAndContinue(pending.historyWithAssistant, toolMessages);
		} finally {
			setBusy(false);
		}
	};

	const send = async () => {
		const text = input.trim();
		if (!text || busy || pendingExpensive) return;
		if (!window.electronAPI?.aiDirectorTurn) {
			setLines((prev) => [
				...prev,
				{ id: lineId(), kind: "system", text: "AI bridge unavailable (Electron only)." },
			]);
			return;
		}

		const userMessage: DirectorMessage = { role: "user", content: text };
		const history = [...messages, userMessage];
		setInput("");
		setLines((prev) => [...prev, { id: lineId(), kind: "user", text }]);
		setBusy(true);

		try {
			const turn = await window.electronAPI.aiDirectorTurn({
				messages: history,
				context: buildContext(),
			});
			if (!turn.success || !turn.message) {
				setLines((prev) => [
					...prev,
					{ id: lineId(), kind: "system", text: turn.error || "Director turn failed" },
				]);
				setMessages(history);
				return;
			}
			await processAssistantTools(history, turn.message);
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="flex h-[min(420px,50vh)] flex-col gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
			<div className="flex items-center gap-2 text-sm font-medium text-slate-200">
				<MessageSquare className="h-4 w-4 text-[#34B27B]" />
				Prompt director
			</div>

			<div ref={scrollRef} className="custom-scrollbar flex-1 space-y-2 overflow-y-auto pr-1">
				{lines.map((line) => {
					if (line.kind === "user") {
						return (
							<div key={line.id} className="flex justify-end">
								<div className="max-w-[90%] rounded-lg bg-[#34B27B]/20 px-2.5 py-1.5 text-xs text-slate-100">
									{line.text}
								</div>
							</div>
						);
					}
					if (line.kind === "assistant") {
						return (
							<div key={line.id} className="flex justify-start gap-1.5">
								<Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-[#34B27B]" />
								<div className="max-w-[90%] rounded-lg bg-white/5 px-2.5 py-1.5 text-xs text-slate-200">
									{line.text}
								</div>
							</div>
						);
					}
					if (line.kind === "tool") {
						return (
							<div
								key={line.id}
								className={`rounded-md border px-2 py-1 text-[11px] ${
									line.ok
										? "border-[#34B27B]/25 bg-[#34B27B]/5 text-[#34B27B]"
										: "border-red-500/30 bg-red-500/5 text-red-300"
								}`}
							>
								<span className="font-medium">{line.name}</span> — {line.detail}
							</div>
						);
					}
					return (
						<p key={line.id} className="text-[11px] leading-relaxed text-slate-500">
							{line.text}
						</p>
					);
				})}
				{busy && !pendingExpensive && (
					<div className="flex items-center gap-1.5 text-[11px] text-slate-500">
						<Loader2 className="h-3 w-3 animate-spin" />
						Thinking…
					</div>
				)}
			</div>

			{pendingExpensive && (
				<div className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2">
					<p className="text-[11px] text-amber-100/90">
						Generate a {pendingExpensive.label}? This uses provider credits and may take several
						minutes.
					</p>
					<p className="line-clamp-2 text-[11px] text-slate-400">
						“{pendingExpensive.summary || "(no preview)"}”
					</p>
					<div className="flex gap-2">
						<Button
							type="button"
							size="sm"
							disabled={busy}
							onClick={() => void confirmExpensive(true)}
							className="h-7 flex-1 bg-[#34B27B] text-xs text-white hover:bg-[#2d9e6c]"
						>
							Generate
						</Button>
						<Button
							type="button"
							size="sm"
							variant="ghost"
							disabled={busy}
							onClick={() => void confirmExpensive(false)}
							className="h-7 flex-1 text-xs text-slate-300"
						>
							Skip
						</Button>
					</div>
				</div>
			)}

			<div className="flex gap-2">
				<textarea
					value={input}
					onChange={(e) => setInput(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault();
							void send();
						}
					}}
					disabled={busy || Boolean(pendingExpensive)}
					placeholder="Tell the director what to build…"
					rows={2}
					className="min-h-[52px] flex-1 resize-none rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-xs text-slate-200 outline-none focus:border-[#34B27B]/40 disabled:opacity-50"
				/>
				<Button
					type="button"
					size="sm"
					disabled={busy || Boolean(pendingExpensive) || !input.trim()}
					onClick={() => void send()}
					className="h-auto self-stretch bg-[#34B27B] px-3 text-white hover:bg-[#2d9e6c]"
				>
					{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
				</Button>
			</div>
		</div>
	);
}
