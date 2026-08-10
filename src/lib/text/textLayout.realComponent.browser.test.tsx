import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnnotationOverlay } from "@/components/video-editor/AnnotationOverlay";
import type { AnnotationRegion, AnnotationTextStyle } from "@/components/video-editor/types";
import { TEXT_ANIMATION_DURATION_MS } from "@/lib/annotationTextAnimation";
import { applyReveal, getLineBackgroundRect, layoutText, type TextLayoutInput } from "./textLayout";

// Chunk 1's textLayout.browser.test.ts validates layoutText() against a DOM
// fixture *hand-built* to replicate AnnotationOverlay's text-rendering CSS.
// That is one hand-maintained approximation (the fixture) validating
// another (layoutText()) — exactly the failure mode this whole track exists
// to kill. This file closes that gap: it mounts the REAL AnnotationOverlay
// component (the thing that actually ships) and checks that what it renders
// matches layoutText() called with the same inputs.
//
// Note on what this test *can* and *can't* prove, now that AnnotationOverlay
// calls layoutText() directly and renders one element per pre-computed line
// (Chunk 2a): this is no longer an independent check of the wrapping
// *algorithm* against browser ground truth (that's what the fixture-based
// browser-vs-layoutText comparisons in textLayout.browser.test.ts are for,
// and they remain the right tool for that). What this file catches instead
// is *wiring* bugs — AnnotationOverlay passing the wrong values from
// `annotation.style`/its live size into layoutText(), a stale prop, a typo
// in which field feeds `boxWidth` vs `boxHeight`, etc. — the class of bug
// that only shows up by rendering the actual component tree.

afterEach(() => {
	cleanup();
});

const CONTAINER_WIDTH = 1000;
const CONTAINER_HEIGHT = 600;

function buildAnnotation(
	content: string,
	styleOverrides: Partial<AnnotationTextStyle> = {},
	sizeOverrides: Partial<{ width: number; height: number }> = {},
): AnnotationRegion {
	return {
		id: "test-annotation",
		startMs: 0,
		endMs: 10_000,
		type: "text",
		content,
		position: { x: 10, y: 10 },
		size: { width: 40, height: 30, ...sizeOverrides },
		style: {
			color: "#ffffff",
			backgroundColor: "transparent",
			fontSize: 24,
			fontFamily: "Arial, sans-serif",
			fontWeight: "normal",
			fontStyle: "normal",
			textDecoration: "none",
			textAlign: "left",
			textAnimation: "none",
			...styleOverrides,
		},
		zIndex: 1,
	};
}

function renderOverlay(annotation: AnnotationRegion, currentTimeMs = 0) {
	return render(
		<AnnotationOverlay
			annotation={annotation}
			isSelected={false}
			containerWidth={CONTAINER_WIDTH}
			containerHeight={CONTAINER_HEIGHT}
			onPositionChange={vi.fn()}
			onSizeChange={vi.fn()}
			onClick={vi.fn()}
			zIndex={1}
			isSelectedBoost={false}
			currentTimeMs={currentTimeMs}
		/>,
	);
}

function equivalentLayoutInput(annotation: AnnotationRegion): TextLayoutInput {
	// Mirrors exactly what AnnotationOverlay itself computes: box px = size%
	// of the container, scaleFactor 1 (preview), padding 8 (p-2).
	return {
		content: annotation.content,
		fontSize: annotation.style.fontSize,
		fontFamily: annotation.style.fontFamily,
		fontWeight: annotation.style.fontWeight,
		fontStyle: annotation.style.fontStyle,
		boxWidth: (annotation.size.width / 100) * CONTAINER_WIDTH,
		boxHeight: (annotation.size.height / 100) * CONTAINER_HEIGHT,
		padding: 8,
		scaleFactor: 1,
	};
}

function renderedLineTexts(container: HTMLElement): string[] {
	return Array.from(container.querySelectorAll('[data-testid="annotation-text-line"]')).map(
		(el) => el.textContent ?? "",
	);
}

describe("AnnotationOverlay (real component) vs layoutText()", () => {
	it("renders one element per layoutText() line, with matching text, for wrapped text", () => {
		const annotation = buildAnnotation(
			"The quick brown fox jumps over the lazy dog near the riverbank",
		);
		const { container } = renderOverlay(annotation);

		const rendered = renderedLineTexts(container);
		const expected = layoutText(equivalentLayoutInput(annotation)).lines.map((l) => l.text);

		expect(rendered.length).toBeGreaterThan(1); // sanity: this fixture must actually wrap
		expect(rendered).toEqual(expected);
	});

	it("matches layoutText() for a single short line (no wrap)", () => {
		const annotation = buildAnnotation("Hello world", {}, { width: 90, height: 30 });
		const { container } = renderOverlay(annotation);

		const rendered = renderedLineTexts(container);
		const expected = layoutText(equivalentLayoutInput(annotation)).lines.map((l) => l.text);

		expect(rendered).toEqual(["Hello world"]);
		expect(rendered).toEqual(expected);
	});

	it("matches layoutText() for CJK text wrapped per character", () => {
		const annotation = buildAnnotation(
			"これは日本語のテキストです。長い文章を折り返しテストします。",
			{},
			{ width: 20, height: 40 },
		);
		const { container } = renderOverlay(annotation);

		const rendered = renderedLineTexts(container);
		const expected = layoutText(equivalentLayoutInput(annotation)).lines.map((l) => l.text);

		expect(rendered.length).toBeGreaterThan(1);
		expect(rendered).toEqual(expected);
	});

	it("matches layoutText() across explicit newlines mixed with wrapping", () => {
		const annotation = buildAnnotation(
			"First line\n\nThird line after a blank line, but this one wraps too",
		);
		const { container } = renderOverlay(annotation);

		const rendered = renderedLineTexts(container);
		const expected = layoutText(equivalentLayoutInput(annotation)).lines.map((l) => l.text);

		expect(rendered).toEqual(expected);
	});

	it("re-wires correctly when style/content/size props change (catches stale-prop wiring bugs)", () => {
		const initial = buildAnnotation("short", {}, { width: 90, height: 30 });
		const { container, rerender } = renderOverlay(initial);
		expect(renderedLineTexts(container)).toEqual(["short"]);

		const updated = buildAnnotation(
			"The quick brown fox jumps over the lazy dog near the riverbank",
			{ fontWeight: "bold", textAlign: "center" },
			{ width: 40, height: 30 },
		);
		rerender(
			<AnnotationOverlay
				annotation={updated}
				isSelected={false}
				containerWidth={CONTAINER_WIDTH}
				containerHeight={CONTAINER_HEIGHT}
				onPositionChange={vi.fn()}
				onSizeChange={vi.fn()}
				onClick={vi.fn()}
				zIndex={1}
				isSelectedBoost={false}
				currentTimeMs={0}
			/>,
		);

		const rendered = renderedLineTexts(container);
		const expected = layoutText(equivalentLayoutInput(updated)).lines.map((l) => l.text);
		expect(rendered.length).toBeGreaterThan(1);
		expect(rendered).toEqual(expected);
	});

	it("positions each line's box top at the exact baselineY - ascent computed by layoutText()", () => {
		// Sanity-checks the "wiring" of the zero-leading baseline trick itself:
		// not a re-verification of the vertical-centering formula (that's
		// textLayout.ts's job to get right), just that AnnotationOverlay reads
		// layout.ascent/baselineY into the DOM correctly rather than, say,
		// swapping ascent and descent or forgetting the per-line offset.
		const annotation = buildAnnotation("line one\nline two\nline three");
		const { container } = renderOverlay(annotation);

		const layout = layoutText(equivalentLayoutInput(annotation));
		const lineEls = Array.from(
			container.querySelectorAll<HTMLElement>('[data-testid="annotation-text-line"]'),
		);

		expect(lineEls.length).toBe(layout.lines.length);
		lineEls.forEach((el, i) => {
			const expectedTop = layout.lines[i].baselineY - layout.ascent;
			const actualTop = Number.parseFloat(el.style.top);
			expect(actualTop).toBeCloseTo(expectedTop, 5);
		});
	});

	describe("typewriter reveal — semantic C (sequential across the whole block)", () => {
		// 3 lines x 5 graphemes = 15 total. TEXT_ANIMATION_DURATION_MS is 700ms
		// and typewriter's revealProgress is *linear* in elapsed time (no
		// easing — see annotationTextAnimation.ts), so currentTimeMs maps to a
		// known, exact revealProgress and thus a known, exact grapheme count.
		const content = "AAAAA\nBBBBB\nCCCCC";

		function typewriterAnnotation() {
			return buildAnnotation(content, { textAnimation: "typewriter" }, { width: 90, height: 40 });
		}

		it("reveals only into the first line early on (partially-filled line 1, untouched lines 2-3)", () => {
			// progress = 140/700 = 0.2 -> ceil(15*0.2) = 3 graphemes
			const annotation = typewriterAnnotation();
			const { container } = renderOverlay(annotation, 140);
			expect(renderedLineTexts(container)).toEqual(["AAA", "", ""]);
		});

		it("fills line 1 completely and starts line 2 (fully-revealed + partially-filled + untouched, in one frame)", () => {
			// progress = 280/700 = 0.4 -> ceil(15*0.4) = 6 graphemes:
			// line 1 (5) fully consumed, 1 left over into line 2, line 3 untouched.
			const annotation = typewriterAnnotation();
			const { container } = renderOverlay(annotation, 280);
			expect(renderedLineTexts(container)).toEqual(["AAAAA", "B", ""]);
		});

		it("reveals everything once revealProgress reaches 1", () => {
			const annotation = typewriterAnnotation();
			const { container } = renderOverlay(annotation, TEXT_ANIMATION_DURATION_MS + 1000);
			expect(renderedLineTexts(container)).toEqual(["AAAAA", "BBBBB", "CCCCC"]);
		});

		it("matches applyReveal() directly for an arbitrary mid-reveal progress (wiring check)", () => {
			const annotation = typewriterAnnotation();
			const currentTimeMs = 490; // progress = 0.7 -> ceil(15*0.7) = 11
			const { container } = renderOverlay(annotation, currentTimeMs);

			const layout = layoutText(equivalentLayoutInput(annotation));
			const expected = applyReveal(layout, currentTimeMs / TEXT_ANIMATION_DURATION_MS).map(
				(l) => l.text,
			);
			expect(renderedLineTexts(container)).toEqual(expected);
			expect(expected).toEqual(["AAAAA", "BBBBB", "C"]); // sanity on the hand-derived expectation
		});
	});

	describe("background box geometry", () => {
		function backgroundRectsOf(container: HTMLElement) {
			return Array.from(
				container.querySelectorAll<HTMLElement>('[data-testid="annotation-text-line-background"]'),
			).map((el) => ({
				x: Number.parseFloat(el.style.left),
				y: Number.parseFloat(el.style.top),
				width: Number.parseFloat(el.style.width),
				height: Number.parseFloat(el.style.height),
				borderRadius: Number.parseFloat(el.style.borderRadius),
			}));
		}

		it.each([
			"left",
			"center",
			"right",
		] as const)("matches getLineBackgroundRect() for textAlign=%s", (textAlign) => {
			const annotation = buildAnnotation(
				"Hi\nHello there",
				{ backgroundColor: "#ff0000", textAlign },
				{ width: 60, height: 30 },
			);
			const { container } = renderOverlay(annotation);

			const layout = layoutText(equivalentLayoutInput(annotation));
			const expected = layout.lines.map((line) =>
				getLineBackgroundRect(layout, line, {
					textAlign,
					fontSize: annotation.style.fontSize,
					boxWidth: (annotation.size.width / 100) * CONTAINER_WIDTH,
					padding: 8,
					scaleFactor: 1,
				}),
			);

			const rendered = backgroundRectsOf(container);
			expect(rendered.length).toBe(expected.length);
			rendered.forEach((rect, i) => {
				const exp = expected[i];
				expect(exp).not.toBeNull();
				if (!exp) return;
				// Precision 1 (within 0.05px), not the default 2: real CSS
				// pixel rendering introduces sub-pixel rounding noise (the
				// same class of engine-internal quantization Chunk 1 found
				// for text measurement) well under a visually meaningful
				// threshold, but bigger than an exact-equality check allows.
				expect(rect.x).toBeCloseTo(exp.x, 1);
				expect(rect.y).toBeCloseTo(exp.y, 1);
				expect(rect.width).toBeCloseTo(exp.width, 1);
				expect(rect.height).toBeCloseTo(exp.height, 1);
				expect(rect.borderRadius).toBeCloseTo(exp.borderRadius, 1);
			});
		});

		it("draws no background element for a transparent/unset backgroundColor", () => {
			const annotation = buildAnnotation("Hello world", { backgroundColor: "transparent" });
			const { container } = renderOverlay(annotation);
			expect(backgroundRectsOf(container).length).toBe(0);
		});

		it("tracks the revealed text during typewriter reveal, and draws no background for an untouched line", () => {
			// Same 0.4-progress case as the reveal describe block above: line 1
			// fully revealed, line 2 partially revealed ("B" of "BBBBB"), line 3
			// untouched. Background must exist for lines 1-2 only, and line 2's
			// background must be sized to "B", not the full "BBBBB".
			const annotation = buildAnnotation(
				"AAAAA\nBBBBB\nCCCCC",
				{ backgroundColor: "#00ff00", textAnimation: "typewriter" },
				{ width: 90, height: 40 },
			);
			const { container } = renderOverlay(annotation, 280);

			const rects = backgroundRectsOf(container);
			expect(rects.length).toBe(2); // not 3 — line 3 hasn't been reached

			const layout = layoutText(equivalentLayoutInput(annotation));
			const revealed = applyReveal(layout, 280 / TEXT_ANIMATION_DURATION_MS);
			expect(revealed.map((l) => l.text)).toEqual(["AAAAA", "B", ""]);

			const expectedLine2Rect = getLineBackgroundRect(layout, revealed[1], {
				textAlign: annotation.style.textAlign,
				fontSize: annotation.style.fontSize,
				boxWidth: (annotation.size.width / 100) * CONTAINER_WIDTH,
				padding: 8,
				scaleFactor: 1,
			});
			expect(expectedLine2Rect).not.toBeNull();
			// The partially-revealed line's background is the *second* rendered
			// rect (line 1's is first; line 3 draws none).
			expect(rects[1].width).toBeCloseTo(expectedLine2Rect?.width ?? Number.NaN, 1);
			// And it must be narrower than what a fully-revealed "BBBBB" would be,
			// proving the background is sized to the revealed substring, not the
			// full line.
			const fullLine2Rect = getLineBackgroundRect(layout, layout.lines[1], {
				textAlign: annotation.style.textAlign,
				fontSize: annotation.style.fontSize,
				boxWidth: (annotation.size.width / 100) * CONTAINER_WIDTH,
				padding: 8,
				scaleFactor: 1,
			});
			expect(fullLine2Rect).not.toBeNull();
			expect(rects[1].width).toBeLessThan(fullLine2Rect?.width ?? 0);
		});
	});

	describe("transformOrigin lock-in", () => {
		// Regression lock for a real (sixth) divergence found incidentally by
		// the Chunk 2a rewire, NOT a preview bug the rewire introduced: before
		// 2a, the preview's single text <span> was shrink-to-fit (auto width),
		// so `transformOrigin: "center"` resolved to the *text's own* bounding
		// box center — which, for left/right-aligned text narrower than its
		// box, sits somewhere other than the box's geometric center. Export's
		// canvas transform has always pivoted on the BOX center
		// (`transformOriginX = x + width/2` in annotationRenderer.ts, never
		// touched by this rewire). Splitting the text into fixed-width,
		// non-shrink-to-fit line elements (2a) incidentally moved preview onto
		// export's box-center convention. This test locks that in so a future
		// refactor can't silently reintroduce shrink-to-fit sizing here.
		it("pivots on the annotation box's own center, not the (short, left-aligned) text's bounding box center", () => {
			const annotation = buildAnnotation(
				"Hi", // short text in a wide box: a shrink-to-fit bbox center would
				// sit far to the left of the box's true center, making this a
				// meaningful (not vacuously-true) assertion.
				{ textAlign: "left" },
				{ width: 80, height: 40 },
			);
			const { container } = renderOverlay(annotation);

			const boxRect = container
				.querySelector('[data-testid="annotation-text-box"]')
				?.getBoundingClientRect();
			const blockRect = container
				.querySelector('[data-testid="annotation-text-block"]')
				?.getBoundingClientRect();
			expect(boxRect).toBeDefined();
			expect(blockRect).toBeDefined();
			if (!boxRect || !blockRect) return;

			const boxCenterX = boxRect.left + boxRect.width / 2;
			const boxCenterY = boxRect.top + boxRect.height / 2;
			const blockCenterX = blockRect.left + blockRect.width / 2;
			const blockCenterY = blockRect.top + blockRect.height / 2;

			expect(blockCenterX).toBeCloseTo(boxCenterX, 1);
			expect(blockCenterY).toBeCloseTo(boxCenterY, 1);

			// Sanity: the fixture actually exercises the "short, left-aligned
			// text narrower than its box" case the lock-in above is meant to
			// catch, rather than being trivially true for any input. Checked
			// against layout data, not the line <div>'s own getBoundingClientRect
			// — that div is intentionally full-width (left:0;right:0) so CSS
			// text-align has something to position within; its box, unlike the
			// old shrink-to-fit <span>, is NOT sized to the glyphs, so measuring
			// it here would defeat the point of this sanity check.
			const layout = layoutText(equivalentLayoutInput(annotation));
			expect(layout.lines[0].text).toBe("Hi");
			expect(layout.lines[0].width).toBeLessThan(boxRect.width * 0.3);
		});
	});
});
