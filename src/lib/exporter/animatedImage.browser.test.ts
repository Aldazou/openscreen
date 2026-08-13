import { beforeAll, describe, expect, it } from "vitest";
import gifUrl from "../../../tests/fixtures/tiny-animated.gif?url";
import {
	clearImageAnnotationCache,
	decodeImageAnnotation,
	frameAtElapsed,
	isPotentiallyAnimated,
} from "./animatedImage";

/** 1x1 transparent PNG. */
const STILL_PNG =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

let animatedGifDataUrl = "";

beforeAll(async () => {
	const blob = await (await fetch(gifUrl)).blob();
	animatedGifDataUrl = await new Promise<string>((resolve) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.readAsDataURL(blob);
	});
});

describe("isPotentiallyAnimated", () => {
	it("recognises the formats the upload picker accepts", () => {
		expect(isPotentiallyAnimated("data:image/gif;base64,AAAA")).toBe(true);
		expect(isPotentiallyAnimated("data:image/webp;base64,AAAA")).toBe(true);
		expect(isPotentiallyAnimated("data:image/png;base64,AAAA")).toBe(false);
		expect(isPotentiallyAnimated("data:image/jpeg;base64,AAAA")).toBe(false);
	});
});

describe("decodeImageAnnotation (real browser)", () => {
	it("has ImageDecoder available — the whole fix depends on it", () => {
		expect(typeof (globalThis as { ImageDecoder?: unknown }).ImageDecoder).toBe("function");
	});

	it("decodes every frame of an animated GIF", async () => {
		const decoded = await decodeImageAnnotation(animatedGifDataUrl);

		expect(decoded.animated).toBe(true);
		// The fixture is 4 frames at 4fps.
		expect(decoded.frames.length).toBeGreaterThan(1);
		expect(decoded.totalDurationMs).toBeGreaterThan(0);
		expect(decoded.width).toBeGreaterThan(0);
		expect(decoded.degradedReason).toBeUndefined();
	});

	it("returns distinct frames rather than the same one repeatedly", async () => {
		// The actual bug: export drew frame 0 forever. Distinct frame objects across the
		// animation is what proves it no longer does.
		const decoded = await decodeImageAnnotation(animatedGifDataUrl);
		const step = decoded.totalDurationMs / decoded.frames.length;
		const seen = new Set<CanvasImageSource>();
		for (let i = 0; i < decoded.frames.length; i++) {
			const frame = frameAtElapsed(decoded, i * step + step / 2);
			if (frame) seen.add(frame);
		}
		expect(seen.size).toBe(decoded.frames.length);
	});

	it("treats a still PNG as a single non-animated frame", async () => {
		const decoded = await decodeImageAnnotation(STILL_PNG);

		expect(decoded.animated).toBe(false);
		expect(decoded.frames).toHaveLength(1);
		expect(decoded.totalDurationMs).toBe(0);
	});

	it("caches by source so per-frame rendering does not re-decode", async () => {
		const a = decodeImageAnnotation(animatedGifDataUrl);
		const b = decodeImageAnnotation(animatedGifDataUrl);
		expect(a).toBe(b);
		await a;
	});

	it("resolves to an empty result instead of rejecting on a corrupt source", async () => {
		const decoded = await decodeImageAnnotation("data:image/gif;base64,ZZZZnotarealgif");
		expect(decoded.degradedReason).toBe("decode-failed");
		expect(frameAtElapsed(decoded, 0)).toBeNull();
	});
});

describe("frameAtElapsed", () => {
	it("loops rather than clamping at the end", async () => {
		const decoded = await decodeImageAnnotation(animatedGifDataUrl);
		const first = frameAtElapsed(decoded, 0);

		// One full cycle later must land back on the first frame.
		expect(frameAtElapsed(decoded, decoded.totalDurationMs)).toBe(first);
		expect(frameAtElapsed(decoded, decoded.totalDurationMs * 3)).toBe(first);
	});

	it("is deterministic — the same elapsed time always yields the same frame", async () => {
		const decoded = await decodeImageAnnotation(animatedGifDataUrl);
		const at = decoded.totalDurationMs * 0.4;
		expect(frameAtElapsed(decoded, at)).toBe(frameAtElapsed(decoded, at));
	});

	it("handles negative elapsed time without throwing", async () => {
		const decoded = await decodeImageAnnotation(animatedGifDataUrl);
		expect(frameAtElapsed(decoded, -50)).not.toBeNull();
	});

	it("returns the only frame for a still image at any time", async () => {
		const decoded = await decodeImageAnnotation(STILL_PNG);
		expect(frameAtElapsed(decoded, 9999)).toBe(decoded.frames[0]!.image);
	});

	it("returns null when there are no frames at all", () => {
		expect(
			frameAtElapsed({ frames: [], totalDurationMs: 0, width: 0, height: 0, animated: false }, 0),
		).toBeNull();
	});
});

describe("clearImageAnnotationCache", () => {
	it("drops cached entries so a later decode starts fresh", async () => {
		const before = decodeImageAnnotation(STILL_PNG);
		await before;
		clearImageAnnotationCache();
		expect(decodeImageAnnotation(STILL_PNG)).not.toBe(before);
	});
});
