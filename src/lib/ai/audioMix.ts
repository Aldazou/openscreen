import type { AudioClip, MediaAsset } from "./types";

export interface MixedAudioClipInput {
	clip: AudioClip;
	asset: MediaAsset;
	/** Decoded PCM as AudioBuffer (already loaded). */
	buffer: AudioBuffer;
}

const DUCK_GAIN = 0.22;

/**
 * Mixes the primary screen-recording audio with secondary clips (music/TTS)
 * into a single AudioBuffer using OfflineAudioContext. Music clips with
 * duckUnderVoice are attenuated for the full mix duration (v1 simple duck).
 */
export async function mixTimelineAudio(options: {
	primary: AudioBuffer | null;
	clips: MixedAudioClipInput[];
	sampleRate?: number;
	durationSec: number;
}): Promise<AudioBuffer | null> {
	const sampleRate = options.sampleRate ?? options.primary?.sampleRate ?? 48_000;
	const durationSec = Math.max(0.05, options.durationSec);
	const length = Math.max(1, Math.ceil(durationSec * sampleRate));
	const channels = Math.max(1, options.primary?.numberOfChannels ?? 2);

	const offline = new OfflineAudioContext(channels, length, sampleRate);

	if (options.primary) {
		const src = offline.createBufferSource();
		src.buffer = options.primary;
		src.connect(offline.destination);
		src.start(0);
	}

	for (const { clip, buffer } of options.clips) {
		const src = offline.createBufferSource();
		src.buffer = buffer;
		const gain = offline.createGain();
		const baseVolume = Math.min(1, Math.max(0, clip.volume));
		const ducked = clip.duckUnderVoice && options.primary ? DUCK_GAIN : 1;
		gain.gain.value = baseVolume * ducked;
		src.connect(gain);
		gain.connect(offline.destination);
		const startSec = Math.max(0, clip.timelineStartMs / 1000);
		const playDurationSec = Math.min(buffer.duration, Math.max(0.01, clip.durationMs / 1000));
		src.start(startSec, 0, playDurationSec);
	}

	if (!options.primary && options.clips.length === 0) {
		return null;
	}

	return offline.startRendering();
}

export async function decodeAudioFileToBuffer(
	fileUrl: string,
	audioContext: AudioContext | OfflineAudioContext = new AudioContext(),
): Promise<AudioBuffer> {
	const response = await fetch(fileUrl);
	if (!response.ok) {
		throw new Error(`Failed to fetch audio: ${response.status}`);
	}
	const data = await response.arrayBuffer();
	// OfflineAudioContext also has decodeAudioData in Chromium.
	return audioContext.decodeAudioData(data.slice(0));
}

export function resolveAudioClipsWithAssets(
	clips: AudioClip[],
	assets: MediaAsset[],
): Array<{ clip: AudioClip; asset: MediaAsset }> {
	const byId = new Map(assets.map((a) => [a.id, a]));
	return clips
		.map((clip) => {
			const asset = byId.get(clip.assetId);
			return asset ? { clip, asset } : null;
		})
		.filter((entry): entry is { clip: AudioClip; asset: MediaAsset } => Boolean(entry));
}
