import { Clapperboard, Library, MessageSquare, Sparkles, Wand2 } from "lucide-react";
import { useState } from "react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import type { AudioClip, MediaAsset, OverlayClip } from "@/lib/ai/types";
import { AiGeneratePanel } from "./AiGeneratePanel";
import { AiSettingsPanel } from "./AiSettingsPanel";
import { MediaLibraryPanel } from "./MediaLibraryPanel";
import { PromptDirectorPanel } from "./PromptDirectorPanel";

type AiTab = "director" | "generate" | "library";

interface AiDirectorDialogProps {
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
	/** Custom trigger; defaults to a header-style AI button. */
	trigger?: React.ReactNode;
}

/**
 * Always-reachable AI Director entry (prompt chat, generate, library, keys).
 * Lives in the editor header so it is visible even before a video is loaded.
 */
export function AiDirectorDialog({
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
	trigger,
}: AiDirectorDialogProps) {
	const [open, setOpen] = useState(false);
	const [tab, setTab] = useState<AiTab>("director");

	const tabs: Array<{ id: AiTab; label: string; icon: typeof MessageSquare }> = [
		{ id: "director", label: "Director", icon: MessageSquare },
		{ id: "generate", label: "Generate", icon: Wand2 },
		{ id: "library", label: "Library", icon: Library },
	];

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				{trigger ?? (
					<button
						type="button"
						className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-white/50 hover:text-white/90 hover:bg-white/[0.08] transition-all duration-150 text-[11px] font-medium"
					>
						<Sparkles size={14} className="text-[#34B27B]" />
						AI
					</button>
				)}
			</DialogTrigger>
			<DialogContent className="flex max-h-[90vh] max-w-xl flex-col gap-0 border-white/10 bg-[#09090b] p-0 [&>button]:text-slate-400 [&>button:hover]:text-white">
				<DialogHeader className="border-b border-white/10 px-5 py-4">
					<DialogTitle className="flex items-center gap-2 text-base font-semibold text-slate-100">
						<Clapperboard className="h-4 w-4 text-[#34B27B]" />
						AI Director
					</DialogTitle>
					<DialogDescription className="text-xs text-slate-500">
						Prompt the edit, generate assets, and place them on the timeline.
					</DialogDescription>
				</DialogHeader>

				<div className="flex gap-1 border-b border-white/10 px-4 py-2">
					{tabs.map(({ id, label, icon: Icon }) => (
						<button
							key={id}
							type="button"
							onClick={() => setTab(id)}
							className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors ${
								tab === id
									? "bg-[#34B27B]/20 text-[#34B27B]"
									: "text-slate-500 hover:text-slate-300"
							}`}
						>
							<Icon className="h-3 w-3" />
							{label}
						</button>
					))}
				</div>

				<div className="flex-1 space-y-5 overflow-y-auto custom-scrollbar px-5 py-4">
					{tab === "director" && (
						<PromptDirectorPanel
							projectId={projectId}
							playheadMs={playheadMs}
							durationMs={durationMs}
							hasVideo={hasVideo}
							mediaAssets={mediaAssets}
							overlayCount={overlayCount}
							audioCount={audioCount}
							onMediaAssetsChange={onMediaAssetsChange}
							onAddOverlayClip={onAddOverlayClip}
							onAddAudioClip={onAddAudioClip}
							onSetDucking={onSetDucking}
							onGenerateCaptions={(min, max) => {
								onGenerateCaptions(min, max);
								setOpen(false);
							}}
							onExport={(format) => {
								onExport(format);
								setOpen(false);
							}}
						/>
					)}

					{tab === "generate" && (
						<AiGeneratePanel
							projectId={projectId}
							onAssetReady={(asset) => {
								onMediaAssetsChange([asset, ...mediaAssets.filter((a) => a.id !== asset.id)]);
							}}
						/>
					)}

					{tab === "library" && (
						<MediaLibraryPanel
							projectId={projectId}
							playheadMs={playheadMs}
							mediaAssets={mediaAssets}
							onMediaAssetsChange={onMediaAssetsChange}
							onAddOverlayClip={(clip) => {
								onAddOverlayClip(clip);
								setOpen(false);
							}}
							onAddAudioClip={(clip) => {
								onAddAudioClip(clip);
								setOpen(false);
							}}
						/>
					)}

					<details className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
						<summary className="cursor-pointer text-xs font-medium text-slate-400">
							API keys (fal · ElevenLabs · OpenAI · HeyGen)
						</summary>
						<div className="mt-3">
							<AiSettingsPanel />
						</div>
					</details>
				</div>
			</DialogContent>
		</Dialog>
	);
}
