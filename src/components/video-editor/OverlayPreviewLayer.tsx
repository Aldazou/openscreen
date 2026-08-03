import { useEffect, useMemo, useRef } from "react";
import {
	activeOverlayClips,
	computeOverlayRect,
	overlaySourceTimeSec,
} from "@/lib/ai/overlayLayout";
import type { MediaAsset, OverlayClip } from "@/lib/ai/types";
import { toFileUrl } from "./projectPersistence";

interface OverlayPreviewLayerProps {
	clips: OverlayClip[];
	assets: MediaAsset[];
	currentTimeSec: number;
	/** Width/height of the preview stage (CSS px). */
	width: number;
	height: number;
}

function assetUrl(asset: MediaAsset): string {
	if (asset.path.startsWith("file:") || asset.path.startsWith("http")) return asset.path;
	return toFileUrl(asset.path);
}

/**
 * DOM overlays for AI/imported media on the preview stage. Kept separate from
 * Pixi so interactive editor chrome stays simple; export composites via canvas.
 */
export function OverlayPreviewLayer({
	clips,
	assets,
	currentTimeSec,
	width,
	height,
}: OverlayPreviewLayerProps) {
	const assetsById = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
	const active = useMemo(
		() => activeOverlayClips(clips, currentTimeSec * 1000),
		[clips, currentTimeSec],
	);
	const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());

	useEffect(() => {
		for (const clip of active) {
			const asset = assetsById.get(clip.assetId);
			if (!asset || !asset.mimeType.startsWith("video/")) continue;
			const el = videoRefs.current.get(clip.id);
			if (!el) continue;
			const target = overlaySourceTimeSec(clip, currentTimeSec * 1000);
			if (Math.abs(el.currentTime - target) > 0.12) {
				try {
					el.currentTime = target;
				} catch {
					// seek can fail before metadata loads
				}
			}
		}
	}, [active, assetsById, currentTimeSec]);

	if (width <= 0 || height <= 0 || active.length === 0) return null;

	return (
		<div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
			{active.map((clip) => {
				const asset = assetsById.get(clip.assetId);
				if (!asset) return null;
				const aspect =
					asset.width && asset.height && asset.height > 0 ? asset.width / asset.height : 16 / 9;
				const rect = computeOverlayRect(width, height, clip.layout, clip.sizePercent, aspect);
				const url = assetUrl(asset);
				const style: React.CSSProperties = {
					left: rect.x,
					top: rect.y,
					width: rect.width,
					height: rect.height,
					opacity: Math.min(1, Math.max(0, clip.opacity)),
				};

				if (asset.mimeType.startsWith("image/")) {
					return (
						<img
							key={clip.id}
							src={url}
							alt=""
							className="absolute rounded-lg object-cover shadow-lg ring-1 ring-black/40"
							style={style}
						/>
					);
				}

				return (
					<video
						key={clip.id}
						ref={(el) => {
							if (el) videoRefs.current.set(clip.id, el);
							else videoRefs.current.delete(clip.id);
						}}
						src={url}
						muted
						playsInline
						className="absolute rounded-lg object-cover shadow-lg ring-1 ring-black/40"
						style={style}
					/>
				);
			})}
		</div>
	);
}
