import {
	Film,
	Image as ImageIcon,
	Link2,
	Loader2,
	Music,
	Plus,
	Trash2,
	Upload,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	type AiJob,
	type AudioClip,
	createId,
	DEFAULT_OVERLAY_CLIP,
	type MediaAsset,
	type OverlayClip,
} from "@/lib/ai/types";

function assetIcon(asset: MediaAsset) {
	if (asset.type === "music" || asset.type === "tts" || asset.mimeType.startsWith("audio/")) {
		return Music;
	}
	if (asset.type === "ai-image" || asset.mimeType.startsWith("image/")) {
		return ImageIcon;
	}
	return Film;
}

function isVisualAsset(asset: MediaAsset): boolean {
	return (
		asset.type === "ai-image" ||
		asset.type === "ai-video" ||
		asset.type === "import" ||
		asset.mimeType.startsWith("image/") ||
		asset.mimeType.startsWith("video/")
	);
}

function isAudioAsset(asset: MediaAsset): boolean {
	return asset.type === "music" || asset.type === "tts" || asset.mimeType.startsWith("audio/");
}

interface MediaLibraryPanelProps {
	projectId: string;
	playheadMs: number;
	mediaAssets: MediaAsset[];
	onMediaAssetsChange: (assets: MediaAsset[]) => void;
	onAddOverlayClip: (clip: OverlayClip) => void;
	onAddAudioClip: (clip: AudioClip) => void;
}

export function MediaLibraryPanel({
	projectId,
	playheadMs,
	mediaAssets,
	onMediaAssetsChange,
	onAddOverlayClip,
	onAddAudioClip,
}: MediaLibraryPanelProps) {
	const [importUrl, setImportUrl] = useState("");
	const [busy, setBusy] = useState(false);
	const [activeJob, setActiveJob] = useState<AiJob | null>(null);
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		if (!window.electronAPI?.aiListAssets || !projectId) return;
		const result = await window.electronAPI.aiListAssets(projectId);
		if (result.success && result.assets) {
			onMediaAssetsChange(result.assets);
		}
	}, [onMediaAssetsChange, projectId]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	useEffect(() => {
		if (!window.electronAPI?.onAiJobProgress) return;
		return window.electronAPI.onAiJobProgress(({ job }) => {
			setActiveJob(job);
			if (job.status === "done") {
				void refresh();
			}
		});
	}, [refresh]);

	const handleImportFile = async () => {
		setError(null);
		setBusy(true);
		try {
			const picker = await window.electronAPI.aiOpenImportPicker();
			if (picker.canceled || !picker.path) return;
			const result = await window.electronAPI.aiEnqueueImportJob({
				kind: "import-file",
				projectId,
				sourcePath: picker.path,
			});
			if (!result.success) {
				setError(result.error || "Import failed");
				return;
			}
			if (result.asset) {
				onMediaAssetsChange([
					result.asset,
					...mediaAssets.filter((a) => a.id !== result.asset!.id),
				]);
			} else {
				await refresh();
			}
		} finally {
			setBusy(false);
		}
	};

	const handleImportUrl = async () => {
		const url = importUrl.trim();
		if (!url) return;
		setError(null);
		setBusy(true);
		try {
			const result = await window.electronAPI.aiEnqueueImportJob({
				kind: "import-url",
				projectId,
				url,
			});
			if (!result.success) {
				setError(result.error || "Import failed");
				return;
			}
			setImportUrl("");
			if (result.asset) {
				onMediaAssetsChange([
					result.asset,
					...mediaAssets.filter((a) => a.id !== result.asset!.id),
				]);
			} else {
				await refresh();
			}
		} finally {
			setBusy(false);
		}
	};

	const handleDelete = async (assetId: string) => {
		setError(null);
		const result = await window.electronAPI.aiDeleteAsset({ projectId, assetId });
		if (!result.success) {
			setError(result.error || "Delete failed");
			return;
		}
		onMediaAssetsChange(mediaAssets.filter((a) => a.id !== assetId));
	};

	const handleAddToTimeline = (asset: MediaAsset) => {
		if (isAudioAsset(asset)) {
			const durationMs = asset.durationMs && asset.durationMs > 0 ? asset.durationMs : 15_000;
			onAddAudioClip({
				id: createId("audio"),
				assetId: asset.id,
				kind: asset.type === "tts" ? "tts" : "music",
				timelineStartMs: Math.max(0, playheadMs),
				durationMs,
				volume: asset.type === "tts" ? 1 : 0.35,
				duckUnderVoice: asset.type !== "tts",
			});
			return;
		}

		if (isVisualAsset(asset)) {
			const durationMs = asset.durationMs && asset.durationMs > 0 ? asset.durationMs : 5_000;
			onAddOverlayClip({
				id: createId("overlay"),
				assetId: asset.id,
				...DEFAULT_OVERLAY_CLIP,
				endMs: durationMs,
				timelineStartMs: Math.max(0, playheadMs),
			});
		}
	};

	return (
		<div className="space-y-3 px-1">
			<div className="flex items-center justify-between gap-2">
				<div>
					<div className="text-sm font-medium text-slate-200">Media library</div>
					<p className="text-[11px] text-slate-500">
						Import images, video, or audio — then add them to the timeline.
					</p>
				</div>
				<Button
					type="button"
					size="sm"
					disabled={busy}
					onClick={() => void handleImportFile()}
					className="h-7 gap-1 bg-white/10 px-2 text-xs text-slate-200 hover:bg-white/15"
				>
					{busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
					Import
				</Button>
			</div>

			<div className="flex gap-2">
				<Input
					value={importUrl}
					onChange={(e) => setImportUrl(e.target.value)}
					placeholder="https://… import URL"
					className="h-8 border-white/10 bg-white/5 text-xs text-slate-200"
				/>
				<Button
					type="button"
					size="sm"
					disabled={busy || !importUrl.trim()}
					onClick={() => void handleImportUrl()}
					className="h-8 gap-1 px-2 text-xs"
					variant="ghost"
				>
					<Link2 className="h-3.5 w-3.5" />
					URL
				</Button>
			</div>

			{activeJob && activeJob.status !== "done" && (
				<div className="rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-2 text-[11px] text-slate-400">
					<div className="flex items-center justify-between gap-2">
						<span>
							{activeJob.message || activeJob.status} ({Math.round(activeJob.progress)}%)
						</span>
						{activeJob.status === "running" || activeJob.status === "queued" ? (
							<button
								type="button"
								className="text-slate-500 hover:text-slate-300"
								onClick={() => void window.electronAPI.aiCancelJob(activeJob.id)}
							>
								Cancel
							</button>
						) : null}
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

			<div className="max-h-64 space-y-1.5 overflow-y-auto custom-scrollbar">
				{mediaAssets.length === 0 ? (
					<p className="py-6 text-center text-xs text-slate-600">No assets yet.</p>
				) : (
					mediaAssets.map((asset) => {
						const Icon = assetIcon(asset);
						return (
							<div
								key={asset.id}
								className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-2 py-1.5"
							>
								<Icon className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
								<div className="min-w-0 flex-1">
									<div className="truncate text-[11px] font-medium text-slate-200">
										{asset.fileName}
									</div>
									<div className="truncate text-[10px] text-slate-500">
										{asset.type}
										{asset.prompt ? ` · ${asset.prompt}` : ""}
									</div>
								</div>
								<button
									type="button"
									title="Add to timeline at playhead"
									className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-[#34B27B]"
									onClick={() => handleAddToTimeline(asset)}
								>
									<Plus className="h-3.5 w-3.5" />
								</button>
								<button
									type="button"
									title="Remove from library"
									className="rounded p-1 text-slate-500 hover:bg-white/10 hover:text-red-300"
									onClick={() => void handleDelete(asset.id)}
								>
									<Trash2 className="h-3.5 w-3.5" />
								</button>
							</div>
						);
					})
				)}
			</div>
		</div>
	);
}
