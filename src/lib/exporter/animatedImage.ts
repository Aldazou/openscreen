/**
 * Decodes image annotations for export, including animated GIF/WebP.
 *
 * The preview renders image annotations through an `<img>`, which animates on its own. The
 * export canvas does not: `ctx.drawImage(new Image(), …)` only ever draws the first frame, so
 * an animated annotation played in the editor and froze in the exported file. This decodes
 * every frame up front and lets the renderer pick the right one per timestamp.
 *
 * Decoded results are cached per source, because the renderer runs once per exported frame and
 * re-decoding a data URL 1,800 times for a 30 s export is pure waste.
 */

/** Fallback when a frame reports no duration (some GIFs write 0). Matches browser behaviour. */
const DEFAULT_FRAME_DURATION_MS = 100;

/**
 * Upper bound on decoded frames held in memory at once. A long, large GIF could otherwise
 * pin hundreds of full-resolution bitmaps for the whole export.
 */
const MAX_DECODED_FRAMES = 300;

export interface AnimationFrame {
	image: CanvasImageSource;
	durationMs: number;
}

export interface DecodedImage {
	frames: AnimationFrame[];
	/** Sum of all frame durations; 0 for a still image. */
	totalDurationMs: number;
	width: number;
	height: number;
	animated: boolean;
	/** Set when an animated source had to be reduced to its first frame, and why. */
	degradedReason?: "no-decoder" | "too-many-frames" | "decode-failed";
}

interface ImageDecoderInstance {
	completed: Promise<void>;
	tracks: {
		ready: Promise<void>;
		selectedTrack?: { frameCount: number; animated: boolean } | null;
	};
	decode(options?: { frameIndex?: number }): Promise<{
		image: VideoFrame & { duration?: number | null };
	}>;
	close(): void;
}

type ImageDecoderCtor = new (init: {
	data: ArrayBuffer | Uint8Array;
	type: string;
}) => ImageDecoderInstance;

function getImageDecoder(): ImageDecoderCtor | null {
	const ctor = (globalThis as { ImageDecoder?: ImageDecoderCtor }).ImageDecoder;
	return typeof ctor === "function" ? ctor : null;
}

/** True for source types the browser can animate; anything else is decoded as a still. */
export function isPotentiallyAnimated(dataUrl: string): boolean {
	return /^data:image\/(gif|webp|apng|avif)/i.test(dataUrl);
}

function mimeFromDataUrl(dataUrl: string): string {
	return dataUrl.match(/^data:([^;,]+)/)?.[1] ?? "image/png";
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
	const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

function loadStillImage(dataUrl: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error("Failed to load image annotation"));
		img.src = dataUrl;
	});
}

async function decodeStill(
	dataUrl: string,
	degradedReason?: DecodedImage["degradedReason"],
): Promise<DecodedImage> {
	const img = await loadStillImage(dataUrl);
	return {
		frames: [{ image: img, durationMs: 0 }],
		totalDurationMs: 0,
		width: img.naturalWidth || img.width,
		height: img.naturalHeight || img.height,
		animated: false,
		...(degradedReason ? { degradedReason } : {}),
	};
}

async function decodeAnimated(dataUrl: string): Promise<DecodedImage> {
	const Decoder = getImageDecoder();
	if (!Decoder) return decodeStill(dataUrl, "no-decoder");

	let decoder: ImageDecoderInstance | null = null;
	try {
		decoder = new Decoder({ data: dataUrlToBytes(dataUrl), type: mimeFromDataUrl(dataUrl) });
		await decoder.tracks.ready;

		const track = decoder.tracks.selectedTrack;
		const frameCount = track?.frameCount ?? 1;
		if (!track?.animated || frameCount <= 1) {
			decoder.close();
			return decodeStill(dataUrl);
		}
		if (frameCount > MAX_DECODED_FRAMES) {
			decoder.close();
			return decodeStill(dataUrl, "too-many-frames");
		}

		const frames: AnimationFrame[] = [];
		let totalDurationMs = 0;
		for (let i = 0; i < frameCount; i++) {
			const { image } = await decoder.decode({ frameIndex: i });
			// `duration` is microseconds and may be null/0 on malformed sources.
			const durationMs = image.duration ? image.duration / 1000 : DEFAULT_FRAME_DURATION_MS;
			frames.push({ image, durationMs });
			totalDurationMs += durationMs;
		}

		const first = frames[0]!.image as VideoFrame;
		const decoded: DecodedImage = {
			frames,
			totalDurationMs,
			width: first.displayWidth,
			height: first.displayHeight,
			animated: true,
		};
		decoder.close();
		return decoded;
	} catch {
		decoder?.close();
		// A source the decoder rejects should still render as a still rather than vanish.
		return decodeStill(dataUrl, "decode-failed").catch(() => ({
			frames: [],
			totalDurationMs: 0,
			width: 0,
			height: 0,
			animated: false,
			degradedReason: "decode-failed" as const,
		}));
	}
}

const cache = new Map<string, Promise<DecodedImage>>();

/** Decodes (or returns a cached decode of) an image annotation's data URL. */
export function decodeImageAnnotation(dataUrl: string): Promise<DecodedImage> {
	const cached = cache.get(dataUrl);
	if (cached) return cached;

	const pending = isPotentiallyAnimated(dataUrl)
		? decodeAnimated(dataUrl)
		: decodeStill(dataUrl).catch(
				(): DecodedImage => ({
					frames: [],
					totalDurationMs: 0,
					width: 0,
					height: 0,
					animated: false,
					degradedReason: "decode-failed",
				}),
			);

	cache.set(dataUrl, pending);
	return pending;
}

/**
 * Picks the frame showing at `elapsedMs` since the annotation appeared, looping. Deterministic:
 * the same timeline position always exports the same frame, which wall-clock `<img>` animation
 * cannot guarantee.
 */
export function frameAtElapsed(decoded: DecodedImage, elapsedMs: number): CanvasImageSource | null {
	if (decoded.frames.length === 0) return null;
	if (!decoded.animated || decoded.totalDurationMs <= 0) return decoded.frames[0]!.image;

	const looped =
		((elapsedMs % decoded.totalDurationMs) + decoded.totalDurationMs) % decoded.totalDurationMs;

	let accumulated = 0;
	for (const frame of decoded.frames) {
		accumulated += frame.durationMs;
		if (looped < accumulated) return frame.image;
	}
	return decoded.frames[decoded.frames.length - 1]!.image;
}

/** Releases decoded frames. Call when an export finishes; VideoFrames hold real memory. */
export function clearImageAnnotationCache(): void {
	for (const pending of cache.values()) {
		void pending
			.then((decoded) => {
				for (const frame of decoded.frames) {
					(frame.image as Partial<VideoFrame>).close?.();
				}
			})
			.catch(() => {
				// A decode that already failed has no frames to release.
			});
	}
	cache.clear();
}
