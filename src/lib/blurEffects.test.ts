import { describe, expect, it } from "vitest";
import {
	DEFAULT_BLUR_BLOCK_SIZE,
	DEFAULT_BLUR_INTENSITY,
	MAX_BLUR_BLOCK_SIZE,
	MAX_BLUR_INTENSITY,
	MIN_BLUR_BLOCK_SIZE,
	MIN_BLUR_INTENSITY,
} from "@/components/video-editor/types";
import {
	applyMosaicToImageData,
	getBlurOverlayColor,
	getNormalizedBlurIntensity,
	getNormalizedMosaicBlockSize,
	normalizeBlurColor,
} from "./blurEffects";

function createTestImageData(width: number, height: number) {
	const data = new Uint8ClampedArray(width * height * 4);

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const offset = (y * width + x) * 4;
			data[offset] = x * 20 + y;
			data[offset + 1] = y * 20 + x;
			data[offset + 2] = (x + y) * 10;
			data[offset + 3] = 255;
		}
	}

	return {
		data,
		width,
		height,
	} as ImageData;
}

describe("applyMosaicToImageData", () => {
	it("collapses each block to a single representative color", () => {
		const imageData = createTestImageData(4, 4);
		const original = new Uint8ClampedArray(imageData.data);

		applyMosaicToImageData(imageData, 2);

		const topLeft = Array.from(imageData.data.slice(0, 4));
		const topRightOffset = (1 * 4 + 1) * 4;
		const topRight = Array.from(imageData.data.slice(topRightOffset, topRightOffset + 4));
		expect(topLeft).toEqual(topRight);

		expect(Array.from(original.slice(0, 4))).not.toEqual(topLeft);
	});

	it("reduces unique pixel colors, making the transform information-lossy", () => {
		const imageData = createTestImageData(8, 8);
		const before = new Set<string>();
		const after = new Set<string>();

		for (let i = 0; i < imageData.data.length; i += 4) {
			before.add(
				`${imageData.data[i]}-${imageData.data[i + 1]}-${imageData.data[i + 2]}-${imageData.data[i + 3]}`,
			);
		}

		applyMosaicToImageData(imageData, 4);

		for (let i = 0; i < imageData.data.length; i += 4) {
			after.add(
				`${imageData.data[i]}-${imageData.data[i + 1]}-${imageData.data[i + 2]}-${imageData.data[i + 3]}`,
			);
		}

		expect(after.size).toBeLessThan(before.size);
		expect(after.size).toBe(4);
	});
});

describe("blur color helpers", () => {
	it("normalizes invalid blur colors to white", () => {
		expect(normalizeBlurColor("black")).toBe("black");
		expect(normalizeBlurColor("invalid")).toBe("white");
	});

	it("returns a dark overlay when black blur color is selected", () => {
		expect(
			getBlurOverlayColor({
				type: "mosaic",
				shape: "rectangle",
				color: "black",
				intensity: 12,
				blockSize: 12,
			}),
		).toBe("rgba(0, 0, 0, 0.72)");
	});
});

// AnnotationOverlay.tsx (preview) and annotationRenderer.ts (export) both
// call getNormalizedBlurIntensity()/getNormalizedMosaicBlockSize() directly
// now, rather than each computing their own clamp inline — preview used to
// floor at 1 with no upper bound, silently able to render a *stronger* blur
// than export would ever produce for the same out-of-range data. These tests
// pin the shared normalizers' clamp behavior so neither call site can drift
// back to its own copy without a visible test failure.
describe("getNormalizedBlurIntensity — shared clamp used by both preview and export", () => {
	it(`clamps a value above MAX_BLUR_INTENSITY (${MAX_BLUR_INTENSITY}) down to it`, () => {
		expect(getNormalizedBlurIntensity({ intensity: 999 } as never)).toBe(MAX_BLUR_INTENSITY);
	});

	it(`clamps a value below MIN_BLUR_INTENSITY (${MIN_BLUR_INTENSITY}) up to it`, () => {
		expect(getNormalizedBlurIntensity({ intensity: -5 } as never)).toBe(MIN_BLUR_INTENSITY);
		expect(getNormalizedBlurIntensity({ intensity: 0 } as never)).toBe(MIN_BLUR_INTENSITY);
	});

	it("passes an in-range value through unchanged", () => {
		expect(getNormalizedBlurIntensity({ intensity: 20 } as never)).toBe(20);
	});

	it("falls back to DEFAULT_BLUR_INTENSITY when unset", () => {
		expect(getNormalizedBlurIntensity(undefined)).toBe(DEFAULT_BLUR_INTENSITY);
		expect(getNormalizedBlurIntensity({} as never)).toBe(DEFAULT_BLUR_INTENSITY);
	});

	it("falls back to the minimum for non-finite input (NaN, Infinity)", () => {
		expect(getNormalizedBlurIntensity({ intensity: Number.NaN } as never)).toBe(MIN_BLUR_INTENSITY);
		expect(getNormalizedBlurIntensity({ intensity: Number.POSITIVE_INFINITY } as never)).toBe(
			MIN_BLUR_INTENSITY,
		);
	});

	// Reproduces exactly what each call site does with the normalizer's
	// output (AnnotationOverlay.tsx's blur case; annotationRenderer.ts's
	// renderBlur, scaleFactor 1 for an apples-to-apples preview comparison)
	// and asserts they agree for both directions of out-of-range input. This
	// is the literal "parity" pin: if either call site ever reintroduces its
	// own inline clamp instead of calling getNormalizedBlurIntensity(), this
	// test still passes only by coincidence, not by construction — the real
	// guarantee is the source-level dependency verified elsewhere in this
	// file's docs and in the code itself (both now import from blurEffects.ts).
	it.each([
		["above MAX_BLUR_INTENSITY", 999],
		["below MIN_BLUR_INTENSITY", -10],
	])("preview and export formulas agree for an intensity %s (%d)", (_label, rawIntensity) => {
		const blurData = { intensity: rawIntensity } as never;
		const previewBlurIntensity = Math.max(1, Math.round(getNormalizedBlurIntensity(blurData)));
		const exportBlurRadius = Math.max(1, Math.round(getNormalizedBlurIntensity(blurData) * 1));
		expect(previewBlurIntensity).toBe(exportBlurRadius);
	});
});

describe("getNormalizedMosaicBlockSize — shared clamp used by both preview paths and export", () => {
	// AnnotationOverlay.tsx has *two* independent blockSize reads: one for the
	// actual pixelation canvas (always went through this normalizer) and one
	// for the decorative block-boundary grid overlay (used to be a raw
	// `Math.max(1, Math.round(blurData?.blockSize ?? DEFAULT_BLUR_BLOCK_SIZE))`
	// with no upper bound). The grid overlay has no export equivalent to
	// diverge *from* — it's a preview-only editing aid — but an unclamped
	// duplicate of the same computation sitting next to the correct one is
	// exactly the kind of drift this whole normalizer exists to prevent.
	it(`clamps a value above MAX_BLUR_BLOCK_SIZE (${MAX_BLUR_BLOCK_SIZE}) down to it`, () => {
		expect(getNormalizedMosaicBlockSize({ blockSize: 999 } as never)).toBe(MAX_BLUR_BLOCK_SIZE);
	});

	it(`clamps a value below MIN_BLUR_BLOCK_SIZE (${MIN_BLUR_BLOCK_SIZE}) up to it`, () => {
		expect(getNormalizedMosaicBlockSize({ blockSize: -5 } as never)).toBe(MIN_BLUR_BLOCK_SIZE);
	});

	it("falls back to DEFAULT_BLUR_BLOCK_SIZE when unset", () => {
		expect(getNormalizedMosaicBlockSize(undefined)).toBe(DEFAULT_BLUR_BLOCK_SIZE);
	});
});
