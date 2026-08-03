import {
	Film,
	Image as ImageIcon,
	Loader2,
	Mic,
	Music,
	Upload,
	UserRound,
	Wand2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AiJob, ElevenLabsVoice, HeyGenAvatar, HeyGenVoice, MediaAsset } from "@/lib/ai/types";

type GenTab = "voice" | "music" | "image" | "video" | "avatar";

interface AiGeneratePanelProps {
	projectId: string;
	onAssetReady: (asset: MediaAsset) => void;
}

/**
 * Generation UI for ElevenLabs, fal, and HeyGen.
 * Calls Electron main; secrets never touch the renderer.
 */
export function AiGeneratePanel({ projectId, onAssetReady }: AiGeneratePanelProps) {
	const [tab, setTab] = useState<GenTab>("voice");
	const [script, setScript] = useState("");
	const [avatarScript, setAvatarScript] = useState("");
	const [musicPrompt, setMusicPrompt] = useState(
		"Upbeat corporate product demo underscore, light percussion, optimistic",
	);
	const [imagePrompt, setImagePrompt] = useState("");
	const [videoPrompt, setVideoPrompt] = useState("");
	const [musicSeconds, setMusicSeconds] = useState(15);
	const [videoSeconds, setVideoSeconds] = useState<5 | 10>(5);
	const [voices, setVoices] = useState<ElevenLabsVoice[]>([]);
	const [voiceId, setVoiceId] = useState("");
	const [avatars, setAvatars] = useState<HeyGenAvatar[]>([]);
	const [avatarId, setAvatarId] = useState("");
	const [heygenVoices, setHeygenVoices] = useState<HeyGenVoice[]>([]);
	const [heygenVoiceId, setHeygenVoiceId] = useState("");
	const [photoPath, setPhotoPath] = useState<string | null>(null);
	const [talkingPhotoId, setTalkingPhotoId] = useState<string | undefined>();
	const [busy, setBusy] = useState(false);
	const [activeJob, setActiveJob] = useState<AiJob | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [statusNote, setStatusNote] = useState<string | null>(null);

	const loadVoices = useCallback(async () => {
		if (!window.electronAPI?.aiListVoices) return;
		const result = await window.electronAPI.aiListVoices();
		if (result.success && result.voices?.length) {
			setVoices(result.voices);
			setVoiceId((prev) => prev || result.voices![0]!.voiceId);
		}
	}, []);

	const loadHeyGen = useCallback(async () => {
		if (!window.electronAPI?.aiListAvatars) return;
		const [avatarResult, voiceResult] = await Promise.all([
			window.electronAPI.aiListAvatars(),
			window.electronAPI.aiListHeyGenVoices(),
		]);
		if (avatarResult.success && avatarResult.avatars?.length) {
			setAvatars(avatarResult.avatars);
			setAvatarId((prev) => prev || avatarResult.avatars![0]!.avatarId);
		}
		if (voiceResult.success && voiceResult.voices?.length) {
			setHeygenVoices(voiceResult.voices);
			setHeygenVoiceId((prev) => prev || voiceResult.voices![0]!.voiceId);
		}
	}, []);

	useEffect(() => {
		void loadVoices();
	}, [loadVoices]);

	useEffect(() => {
		if (tab === "avatar") void loadHeyGen();
	}, [tab, loadHeyGen]);

	useEffect(() => {
		if (!window.electronAPI?.onAiJobProgress) return;
		return window.electronAPI.onAiJobProgress(({ job }) => {
			if (
				job.kind === "generate-tts" ||
				job.kind === "generate-music" ||
				job.kind === "generate-image" ||
				job.kind === "generate-video" ||
				job.kind === "generate-avatar" ||
				job.kind === "create-photo-avatar"
			) {
				setActiveJob(job);
			}
		});
	}, []);

	const handleUploadPhotoAvatar = async () => {
		setError(null);
		setStatusNote(null);
		setBusy(true);
		try {
			const picker = await window.electronAPI.aiOpenPhotoAvatarPicker();
			if (picker.canceled || !picker.path) return;
			setPhotoPath(picker.path);
			const result = await window.electronAPI.aiCreatePhotoAvatar({
				imagePath: picker.path,
			});
			if (!result.success || !result.avatar) {
				setError(result.error || "Photo avatar upload failed");
				return;
			}
			setTalkingPhotoId(result.avatar.talkingPhotoId);
			setAvatars((prev) => {
				const next = [
					result.avatar!,
					...prev.filter((a) => a.avatarId !== result.avatar!.avatarId),
				];
				return next;
			});
			setAvatarId(result.avatar.avatarId);
			setStatusNote(
				result.avatar.talkingPhotoId
					? "Talking photo ready — generate to render a video."
					: "Photo avatar ready — generate to render a video.",
			);
		} finally {
			setBusy(false);
		}
	};

	const run = async (
		action: () => Promise<{ success: boolean; asset?: MediaAsset; error?: string }>,
	) => {
		setBusy(true);
		setError(null);
		setStatusNote(null);
		try {
			const result = await action();
			if (!result.success) {
				setError(result.error || "Generation failed");
				return;
			}
			if (result.asset) {
				onAssetReady(result.asset);
				setStatusNote("Saved to media library — use + to place on the timeline.");
			}
		} finally {
			setBusy(false);
		}
	};

	const tabs: Array<{ id: GenTab; label: string; icon: typeof Mic }> = [
		{ id: "voice", label: "Voice", icon: Mic },
		{ id: "music", label: "Music", icon: Music },
		{ id: "image", label: "Image", icon: ImageIcon },
		{ id: "video", label: "Video", icon: Film },
		{ id: "avatar", label: "Avatar", icon: UserRound },
	];

	return (
		<div className="space-y-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
			<div className="flex items-center gap-2 text-sm font-medium text-slate-200">
				<Wand2 className="h-4 w-4 text-[#34B27B]" />
				Generate
			</div>
			<p className="text-[11px] leading-relaxed text-slate-500">
				ElevenLabs · fal · HeyGen avatars. Assets land in your library ready to mix onto the
				recording.
			</p>

			<div className="flex gap-1 rounded-lg bg-black/30 p-0.5">
				{tabs.map(({ id, label, icon: Icon }) => (
					<button
						key={id}
						type="button"
						onClick={() => setTab(id)}
						className={`flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors ${
							tab === id ? "bg-[#34B27B]/20 text-[#34B27B]" : "text-slate-500 hover:text-slate-300"
						}`}
					>
						<Icon className="h-3 w-3" />
						{label}
					</button>
				))}
			</div>

			{tab === "voice" && (
				<div className="space-y-2">
					<textarea
						value={script}
						onChange={(e) => setScript(e.target.value)}
						placeholder="Script for the AI voiceover…"
						rows={4}
						className="w-full resize-none rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-xs text-slate-200 outline-none focus:border-[#34B27B]/40"
					/>
					<select
						value={voiceId}
						onChange={(e) => setVoiceId(e.target.value)}
						onFocus={() => void loadVoices()}
						className="w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-slate-200"
					>
						{voices.length === 0 ? (
							<option value="">Default voice (set ElevenLabs key to load list)</option>
						) : (
							voices.map((v) => (
								<option key={v.voiceId} value={v.voiceId}>
									{v.name}
								</option>
							))
						)}
					</select>
					<Button
						type="button"
						size="sm"
						disabled={busy || !script.trim()}
						onClick={() =>
							void run(() =>
								window.electronAPI.aiGenerateTts({
									projectId,
									text: script,
									voiceId: voiceId || undefined,
								}),
							)
						}
						className="h-8 w-full gap-1.5 bg-[#34B27B] text-xs text-white hover:bg-[#2d9e6c]"
					>
						{busy ? (
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
						) : (
							<Mic className="h-3.5 w-3.5" />
						)}
						Generate voiceover
					</Button>
				</div>
			)}

			{tab === "music" && (
				<div className="space-y-2">
					<textarea
						value={musicPrompt}
						onChange={(e) => setMusicPrompt(e.target.value)}
						placeholder="Describe the music bed…"
						rows={3}
						className="w-full resize-none rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-xs text-slate-200 outline-none focus:border-[#34B27B]/40"
					/>
					<div className="flex items-center gap-2">
						<label className="text-[11px] text-slate-500">Length</label>
						<Input
							type="number"
							min={3}
							max={60}
							value={musicSeconds}
							onChange={(e) => setMusicSeconds(Number(e.target.value) || 15)}
							className="h-8 w-20 border-white/10 bg-white/5 text-xs"
						/>
						<span className="text-[11px] text-slate-500">sec</span>
					</div>
					<Button
						type="button"
						size="sm"
						disabled={busy || !musicPrompt.trim()}
						onClick={() =>
							void run(() =>
								window.electronAPI.aiGenerateMusic({
									projectId,
									prompt: musicPrompt,
									lengthMs: Math.round(musicSeconds * 1000),
								}),
							)
						}
						className="h-8 w-full gap-1.5 bg-[#34B27B] text-xs text-white hover:bg-[#2d9e6c]"
					>
						{busy ? (
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
						) : (
							<Music className="h-3.5 w-3.5" />
						)}
						Generate music
					</Button>
				</div>
			)}

			{tab === "image" && (
				<div className="space-y-2">
					<textarea
						value={imagePrompt}
						onChange={(e) => setImagePrompt(e.target.value)}
						placeholder="Describe the B-roll image…"
						rows={3}
						className="w-full resize-none rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-xs text-slate-200 outline-none focus:border-[#34B27B]/40"
					/>
					<Button
						type="button"
						size="sm"
						disabled={busy || !imagePrompt.trim()}
						onClick={() =>
							void run(() =>
								window.electronAPI.aiGenerateImage({
									projectId,
									prompt: imagePrompt,
								}),
							)
						}
						className="h-8 w-full gap-1.5 bg-[#34B27B] text-xs text-white hover:bg-[#2d9e6c]"
					>
						{busy ? (
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
						) : (
							<ImageIcon className="h-3.5 w-3.5" />
						)}
						Generate image
					</Button>
				</div>
			)}

			{tab === "video" && (
				<div className="space-y-2">
					<textarea
						value={videoPrompt}
						onChange={(e) => setVideoPrompt(e.target.value)}
						placeholder="Describe the AI video clip…"
						rows={3}
						className="w-full resize-none rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-xs text-slate-200 outline-none focus:border-[#34B27B]/40"
					/>
					<div className="flex gap-2">
						{(
							[
								[5, "5s"],
								[10, "10s"],
							] as const
						).map(([sec, label]) => (
							<button
								key={sec}
								type="button"
								onClick={() => setVideoSeconds(sec)}
								className={`rounded-md border px-2.5 py-1 text-[11px] ${
									videoSeconds === sec
										? "border-[#34B27B]/50 bg-[#34B27B]/15 text-[#34B27B]"
										: "border-white/10 text-slate-500"
								}`}
							>
								{label}
							</button>
						))}
					</div>
					<p className="text-[10px] text-slate-600">
						Video gen uses credits and can take 1–3 minutes.
					</p>
					<Button
						type="button"
						size="sm"
						disabled={busy || !videoPrompt.trim()}
						onClick={() =>
							void run(() =>
								window.electronAPI.aiGenerateVideo({
									projectId,
									prompt: videoPrompt,
									durationSec: videoSeconds,
								}),
							)
						}
						className="h-8 w-full gap-1.5 bg-[#34B27B] text-xs text-white hover:bg-[#2d9e6c]"
					>
						{busy ? (
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
						) : (
							<Film className="h-3.5 w-3.5" />
						)}
						Generate video clip
					</Button>
				</div>
			)}

			{tab === "avatar" && (
				<div className="space-y-2">
					<textarea
						value={avatarScript}
						onChange={(e) => setAvatarScript(e.target.value)}
						placeholder="Script for the talking avatar…"
						rows={4}
						className="w-full resize-none rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-xs text-slate-200 outline-none focus:border-[#34B27B]/40"
					/>
					<Button
						type="button"
						size="sm"
						variant="ghost"
						disabled={busy}
						onClick={() => void handleUploadPhotoAvatar()}
						className="h-8 w-full gap-1.5 border border-white/10 text-xs text-slate-300"
					>
						{busy ? (
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
						) : (
							<Upload className="h-3.5 w-3.5" />
						)}
						Upload portrait photo
					</Button>
					{photoPath && (
						<p className="truncate text-[10px] text-slate-500">
							Photo: {photoPath.split("/").pop()}
						</p>
					)}
					<select
						value={avatarId}
						onChange={(e) => {
							setAvatarId(e.target.value);
							setTalkingPhotoId(undefined);
						}}
						onFocus={() => void loadHeyGen()}
						className="w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-slate-200"
					>
						{avatars.length === 0 ? (
							<option value="">Default avatar (set HeyGen key to load list)</option>
						) : (
							avatars.slice(0, 80).map((a) => (
								<option key={a.avatarId} value={a.avatarId}>
									{a.name}
								</option>
							))
						)}
					</select>
					<select
						value={heygenVoiceId}
						onChange={(e) => setHeygenVoiceId(e.target.value)}
						onFocus={() => void loadHeyGen()}
						className="w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-slate-200"
					>
						{heygenVoices.length === 0 ? (
							<option value="">Default voice (set HeyGen key to load list)</option>
						) : (
							heygenVoices.slice(0, 80).map((v) => (
								<option key={v.voiceId} value={v.voiceId}>
									{v.name}
									{v.language ? ` · ${v.language}` : ""}
								</option>
							))
						)}
					</select>
					<p className="text-[10px] text-slate-600">
						Upload a portrait to use your face, or pick a stock avatar. Renders often take 2–10
						minutes.
					</p>
					<div className="flex gap-2">
						<Button
							type="button"
							size="sm"
							disabled={busy || !avatarScript.trim()}
							onClick={() =>
								void run(() =>
									window.electronAPI.aiGenerateAvatar({
										projectId,
										script: avatarScript,
										avatarId: talkingPhotoId ? undefined : avatarId || undefined,
										talkingPhotoId,
										voiceId: heygenVoiceId || undefined,
									}),
								)
							}
							className="h-8 flex-1 gap-1.5 bg-[#34B27B] text-xs text-white hover:bg-[#2d9e6c]"
						>
							{busy ? (
								<Loader2 className="h-3.5 w-3.5 animate-spin" />
							) : (
								<UserRound className="h-3.5 w-3.5" />
							)}
							Generate
						</Button>
						<Button
							type="button"
							size="sm"
							disabled={busy || !avatarScript.trim() || !photoPath}
							onClick={() =>
								void run(() =>
									window.electronAPI.aiGenerateAvatar({
										projectId,
										script: avatarScript,
										voiceId: heygenVoiceId || undefined,
										photoPath: photoPath || undefined,
									}),
								)
							}
							className="h-8 flex-1 gap-1.5 border border-white/10 bg-white/5 text-xs text-slate-200 hover:bg-white/10"
						>
							Photo → video
						</Button>
					</div>
				</div>
			)}

			{activeJob && (activeJob.status === "running" || activeJob.status === "queued") && (
				<div className="rounded-md border border-white/10 bg-black/30 px-2.5 py-2 text-[11px] text-slate-400">
					<div className="flex items-center justify-between gap-2">
						<span>
							{activeJob.message} ({Math.round(activeJob.progress)}%)
						</span>
						<button
							type="button"
							className="text-slate-500 hover:text-slate-300"
							onClick={() => void window.electronAPI.aiCancelJob(activeJob.id)}
						>
							Cancel
						</button>
					</div>
					<div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10">
						<div
							className="h-full bg-[#34B27B] transition-all"
							style={{ width: `${Math.min(100, Math.max(0, activeJob.progress))}%` }}
						/>
					</div>
				</div>
			)}

			{error && <p className="text-xs text-red-400">{error}</p>}
			{statusNote && <p className="text-xs text-[#34B27B]">{statusNote}</p>}
		</div>
	);
}
