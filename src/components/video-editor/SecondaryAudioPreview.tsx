import { useEffect, useRef } from "react";
import type { AudioClip, MediaAsset } from "@/lib/ai/types";
import { toFileUrl } from "./projectPersistence";

const DUCK_GAIN = 0.22;

interface SecondaryAudioPreviewProps {
	clips: AudioClip[];
	assets: MediaAsset[];
	currentTimeSec: number;
	isPlaying: boolean;
	/** When true, duck music under assumed primary voice. */
	hasPrimaryAudio?: boolean;
}

/**
 * Lightweight preview mixer for secondary audio clips (music/TTS).
 * Keeps HTMLAudioElements in sync with the playhead; export uses OfflineAudioContext.
 */
export function SecondaryAudioPreview({
	clips,
	assets,
	currentTimeSec,
	isPlaying,
	hasPrimaryAudio = true,
}: SecondaryAudioPreviewProps) {
	const elementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
	const assetsRef = useRef(assets);
	assetsRef.current = assets;
	const assetSignature = assets.map((a) => `${a.id}:${a.path}`).join("|");

	useEffect(() => {
		void assetSignature; // re-run when asset ids/paths change
		const assetsById = new Map(assetsRef.current.map((a) => [a.id, a]));
		const alive = new Set(clips.map((c) => c.id));
		for (const [id, el] of elementsRef.current) {
			if (!alive.has(id)) {
				el.pause();
				el.removeAttribute("src");
				elementsRef.current.delete(id);
			}
		}

		for (const clip of clips) {
			const asset = assetsById.get(clip.assetId);
			if (!asset) continue;
			let el = elementsRef.current.get(clip.id);
			if (!el) {
				el = new Audio();
				el.preload = "auto";
				elementsRef.current.set(clip.id, el);
			}
			const url =
				asset.path.startsWith("file:") || asset.path.startsWith("http")
					? asset.path
					: toFileUrl(asset.path);
			if (el.dataset.assetUrl !== url) {
				el.src = url;
				el.dataset.assetUrl = url;
			}
			const ducked = clip.duckUnderVoice && hasPrimaryAudio ? DUCK_GAIN : 1;
			el.volume = Math.min(1, Math.max(0, clip.volume * ducked));
		}
	}, [clips, assetSignature, hasPrimaryAudio]);

	useEffect(() => {
		for (const clip of clips) {
			const el = elementsRef.current.get(clip.id);
			if (!el) continue;
			const startSec = clip.timelineStartMs / 1000;
			const endSec = startSec + clip.durationMs / 1000;
			const inRange = currentTimeSec >= startSec && currentTimeSec < endSec;
			const localTime = Math.max(0, currentTimeSec - startSec);

			if (!inRange || !isPlaying) {
				if (!el.paused) el.pause();
				continue;
			}

			if (Math.abs(el.currentTime - localTime) > 0.18) {
				try {
					el.currentTime = localTime;
				} catch {
					// ignore seek errors
				}
			}
			if (el.paused) {
				void el.play().catch(() => undefined);
			}
		}
	}, [clips, currentTimeSec, isPlaying]);

	useEffect(() => {
		return () => {
			for (const el of elementsRef.current.values()) {
				el.pause();
				el.removeAttribute("src");
			}
			elementsRef.current.clear();
		};
	}, []);

	return null;
}
