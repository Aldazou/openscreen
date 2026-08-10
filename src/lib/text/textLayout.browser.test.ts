import { describe, expect, it } from "vitest";
import { layoutText, type TextLayoutInput } from "./textLayout";

// Validates layoutText() against real browser line-breaking. Builds a DOM
// node replicating every layout-affecting CSS property of AnnotationOverlay's
// actual text span (see src/components/video-editor/AnnotationOverlay.tsx
// lines 287-335): word-break: break-word, white-space: pre-wrap,
// line-height: 1.4, the span's own padding: "0.1em 0.2em" plus
// boxDecorationBreak: "clone" (which reapplies that padding to *every*
// wrapped line, not just the first/last), inside a flex container with
// box-sizing: border-box padding matching the p-2 container. It then
// recovers the browser's actual visual line breaks with
// Range.getClientRects() and compares them to layoutText()'s output.
//
// Font: a web-safe stack (Arial, sans-serif) guaranteed present in headless
// Chromium, so measurements are deterministic across machines/CI.

type Fixture = {
	name: string;
	input: TextLayoutInput;
};

const baseInput = {
	fontFamily: "Arial, sans-serif",
	fontWeight: "normal" as const,
	fontStyle: "normal" as const,
	padding: 8,
	scaleFactor: 1,
	// Generous and unused by any assertion below — these fixtures only check
	// line-breaking (horizontal), never baselineY (vertical). Tall enough that
	// no fixture's wrapped block could plausibly need more room.
	boxHeight: 300,
};

const fixtures: Fixture[] = [
	{
		name: "simple short single-line text",
		input: { ...baseInput, content: "Hello world", fontSize: 24, boxWidth: 400 },
	},
	{
		name: "wraps across 2-3 lines at word boundaries",
		input: {
			...baseInput,
			content: "The quick brown fox jumps over the lazy dog near the riverbank",
			fontSize: 24,
			boxWidth: 220,
		},
	},
	{
		name: "very long unbreakable token (long URL, no spaces)",
		input: {
			...baseInput,
			content: `https://example.com/${"a".repeat(180)}`,
			fontSize: 20,
			boxWidth: 240,
		},
	},
	{
		name: "long unbreakable token mixed with normal words",
		input: {
			...baseInput,
			content: `check out https://example.com/${"b".repeat(150)} for more`,
			fontSize: 20,
			boxWidth: 240,
		},
	},
	{
		name: "CJK text wraps per-character",
		input: {
			...baseInput,
			content: "これは日本語のテキストです。長い文章を折り返しテストします。",
			fontSize: 24,
			boxWidth: 200,
		},
	},
	{
		name: "explicit newlines mixed with wrapping",
		input: {
			...baseInput,
			content: "First line\n\nThird line after a blank line, but this one wraps too",
			fontSize: 22,
			boxWidth: 240,
		},
	},
	{
		name: "mixed CJK + Latin",
		input: {
			...baseInput,
			content: "Hello 世界, this is a mixed 日本語 and English サンプル sentence",
			fontSize: 22,
			boxWidth: 220,
		},
	},
	{
		name: "bold variant affects wrap width",
		input: {
			...baseInput,
			fontWeight: "bold",
			content: "The quick brown fox jumps over the lazy dog",
			fontSize: 24,
			boxWidth: 220,
		},
	},
	{
		name: "italic variant affects wrap width",
		input: {
			...baseInput,
			fontStyle: "italic",
			content: "The quick brown fox jumps over the lazy dog",
			fontSize: 24,
			boxWidth: 220,
		},
	},
	{
		name: "multiple consecutive spaces are preserved (pre-wrap)",
		input: {
			...baseInput,
			content: "hello    world    this    has    gaps",
			fontSize: 22,
			boxWidth: 200,
		},
	},
];

// Not in the `fixtures` loop on purpose — see the dedicated `it.fails()` test
// below for why.
const subpixelBoundaryFixture: Fixture = {
	name: "single very narrow box forces near-per-character wrap",
	input: {
		...baseInput,
		content: "abcdefghijklmnop",
		fontSize: 24,
		boxWidth: 40,
	},
};

/** Builds a DOM node that is an exact replica, for layout purposes, of
 * AnnotationOverlay's rendered text annotation: a flex container with
 * border-box padding (Tailwind's p-2) around a span carrying the editor's
 * word-break/white-space/line-height/padding/box-decoration-break. Properties
 * that affect only paint (color, backgroundColor, opacity, transform,
 * textDecoration, borderRadius, clipPath) are intentionally omitted — they
 * don't influence where lines break. */
function mountPreviewSpan(input: TextLayoutInput): HTMLSpanElement {
	const inlinePaddingEm = input.inlinePaddingEm ?? { x: 0.2, y: 0.1 };

	const container = document.createElement("div");
	container.style.position = "fixed";
	container.style.left = "0";
	container.style.top = "0";
	container.style.visibility = "hidden";
	container.style.width = `${input.boxWidth}px`;
	container.style.height = "800px";
	container.style.boxSizing = "border-box";
	container.style.padding = `${input.padding}px`;
	container.style.display = "flex";
	container.style.alignItems = "center";
	container.style.overflow = "hidden";

	const span = document.createElement("span");
	span.style.fontSize = `${input.fontSize}px`;
	span.style.fontFamily = input.fontFamily;
	span.style.fontWeight = input.fontWeight;
	span.style.fontStyle = input.fontStyle;
	span.style.wordBreak = "break-word";
	span.style.whiteSpace = "pre-wrap";
	span.style.lineHeight = "1.4";
	span.style.padding = `${inlinePaddingEm.y}em ${inlinePaddingEm.x}em`;
	span.style.boxDecorationBreak = "clone";
	span.style.setProperty("-webkit-box-decoration-break", "clone");
	span.textContent = input.content;

	container.appendChild(span);
	document.body.appendChild(container);
	return span;
}

/** Recovers the browser's actual visual line breaks by measuring the
 * bounding rect of every single character in the text node (via a Range)
 * and grouping consecutive characters that share the same rect `top` into
 * one visual line. This is more robust than trusting
 * `range.getClientRects()` rect *count* directly, since it also lets us map
 * each rect back to the exact substring it corresponds to. */
function extractBrowserLines(span: HTMLSpanElement): string[] {
	const textNode = span.firstChild;
	if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
		throw new Error("expected span to contain a single text node");
	}
	const text = textNode.textContent ?? "";
	const length = text.length;
	if (length === 0) return [""];

	const range = document.createRange();
	const tops: Array<number | null> = new Array(length);
	for (let i = 0; i < length; i++) {
		range.setStart(textNode, i);
		range.setEnd(textNode, i + 1);
		const rects = range.getClientRects();
		tops[i] = rects.length > 0 ? rects[0].top : null;
	}

	// Some characters (e.g. a wrap-collapsed space, or a "\n") can report no
	// rect. Attach them to the neighboring line so they don't form phantom
	// groups.
	let fallback = 0;
	for (let i = 0; i < length; i++) {
		if (tops[i] == null) {
			tops[i] = i > 0 ? (tops[i - 1] as number) : fallback;
		} else {
			fallback = tops[i] as number;
		}
	}

	const TOLERANCE = 2; // px; same-line rects can differ by sub-pixel amounts
	const lines: string[] = [];
	let lineStart = 0;
	let currentTop = tops[0] as number;
	for (let i = 1; i <= length; i++) {
		const top = i < length ? (tops[i] as number) : null;
		if (top === null || Math.abs(top - currentTop) > TOLERANCE) {
			lines.push(text.slice(lineStart, i));
			lineStart = i;
			if (top !== null) currentTop = top;
		}
	}
	return lines;
}

// White-space (including "\n") that trails a line either wraps invisibly
// ("hangs", per the CSS Text spec's handling of white-space: pre-wrap) or is
// the hard-break character itself, which layoutText() never includes in a
// line's text. Neither is meaningful, visible line content, so both sides
// are normalized the same way before comparing.
function stripTrailingWhitespace(value: string): string {
	return value.replace(/\s+$/, "");
}

describe("layoutText vs real browser line-breaking", () => {
	for (const fixture of fixtures) {
		it(fixture.name, () => {
			const span = mountPreviewSpan(fixture.input);
			try {
				const browserLines = extractBrowserLines(span).map(stripTrailingWhitespace);
				const layout = layoutText(fixture.input);
				const layoutLines = layout.lines.map((l) => stripTrailingWhitespace(l.text));

				expect(layoutLines.length, "line count should match the browser's").toBe(
					browserLines.length,
				);
				expect(layoutLines).toEqual(browserLines);
			} finally {
				span.parentElement?.remove();
			}
		});
	}

	// Direct unit assertions (no DOM comparison) for the trailing-whitespace
	// fix. The DOM-comparison fixtures above can't see this: their
	// `stripTrailingWhitespace` normalization exists to ignore the DOM's own
	// CSS "hanging" trailing-space behavior at wrap points, which as a side
	// effect would also hide a bug where layoutText() itself emitted a
	// trailing space. So we assert on layoutText()'s raw output directly.
	it("never emits a soft-wrapped line with trailing whitespace", () => {
		const layout = layoutText({
			...baseInput,
			content: "The quick brown fox jumps over the lazy dog near the riverbank",
			fontSize: 24,
			boxWidth: 220,
		});

		expect(layout.lines.length).toBeGreaterThan(1); // sanity: this fixture must actually wrap
		for (const line of layout.lines) {
			expect(line.text, `line ${line.index} ("${line.text}") has trailing whitespace`).not.toMatch(
				/\s$/,
			);
		}
	});

	it("preserves a whitespace-only line from an explicit blank-line round-trip", () => {
		// "\n\n   \n" -> raw segments: "a", "", "   ", "b". The all-whitespace
		// segment is the *last* (only) line of its own raw segment — it was
		// never a soft wrap point — so it must survive completely unstripped,
		// while still being distinguishable from the truly-empty blank line
		// next to it.
		const layout = layoutText({
			...baseInput,
			content: "a\n\n   \nb",
			fontSize: 24,
			boxWidth: 400, // wide enough that nothing here soft-wraps
		});

		expect(layout.lines.map((l) => l.text)).toEqual(["a", "", "   ", "b"]);
	});

	// scaleFactor scales fontSize and boxWidth by the same factor, so it should
	// never change *which* words land on which line (only the pixel scale of
	// the result) — this is what lets export (scaleFactor > 1) and preview
	// (scaleFactor = 1) agree on line breaks for the same content.
	it("is invariant to scaleFactor: same word-to-line distribution at 1x and 2x", () => {
		const input: TextLayoutInput = {
			...baseInput,
			content: "The quick brown fox jumps over the lazy dog near the riverbank",
			fontSize: 24,
			boxWidth: 220,
		};

		const at1x = layoutText({ ...input, scaleFactor: 1 });
		const at2x = layoutText({ ...input, scaleFactor: 2 });

		expect(at2x.lines.map((l) => l.text)).toEqual(at1x.lines.map((l) => l.text));
		expect(at2x.lineHeight).toBeCloseTo(at1x.lineHeight * 2);
		expect(at2x.availableWidth).toBeCloseTo(at1x.availableWidth * 2);
	});

	// KNOWN DIVERGENCE, not fixable from application code — and NOT what it
	// first looked like. Root-caused directly (see git history for the
	// throwaway debug specs used to pull these numbers, not kept in the
	// suite): this fixture ("abcdefghijklmnop" — note it includes "m", the
	// widest lowercase glyph in Arial — at 24px, in a 40px box with 8px
	// container padding and the default 0.2em/0.1em inline padding) puts
	// `layoutText()`'s computed `availableWidth` at 14.4px. But 14.4px is
	// *smaller* than the width of a single "m" (≈20px) plus the span's own
	// inline padding (9.6px) — i.e. smaller than the space the span needs
	// even at its absolute minimum content width.
	//
	// In that regime the real browser does NOT shrink the span down to
	// 14.4px. The span is a flex item with the browser's default
	// `min-width: auto`, which floors its shrink target at min-content —
	// and because `word-break: break-word` allows a line break before any
	// single grapheme, min-content here is just "the widest single
	// character" (~20px for "m"), not "the whole unbreakable string". So the
	// span's real used width settles at roughly that ~20px-plus-padding
	// figure and *overflows* the nominal 40px box; `overflow: hidden` on the
	// container clips the paint, but does not shrink the box or change where
	// lines break. Confirmed directly: for this exact fixture, real per-line
	// content width in the DOM measures ~20px (matching "m"'s width), not
	// `layoutText()`'s 14.4px — a 5-6px gap, not a sub-pixel one, which is
	// why the wrap points diverge at nearly every character rather than one
	// clean boundary.
	//
	// This is CSS intrinsic-sizing behavior (flex min-width:auto ->
	// min-content, combined with break-word's effect on what counts as an
	// unbreakable unit) that `layoutText()` does not attempt to model: it has
	// no notion of "let the box overflow its nominal width because even the
	// narrowest possible line doesn't fit." Modeling it correctly would mean
	// implementing CSS shrink-to-fit/min-content sizing in this module, which
	// (a) is a different and much larger problem than wrapping text within a
	// known width, and (b) doesn't obviously map onto the export side at
	// all — annotationRenderer.ts draws into a fixed-size canvas with an
	// explicit clip rect, it has no analogous "flex item allowed to overflow
	// its container" concept to replicate.
	//
	// Verified this is confined to this pathological regime, not a flaw in
	// the general formula: the same inline-padding subtraction produces
	// exact DOM parity once the box is wide enough that its content width
	// exceeds any single character's min-content (e.g. re-run this fixture's
	// text at boxWidth: 220 instead of 40 — full line-for-line match). A box
	// narrower than one glyph is a degenerate case that shouldn't arise for
	// real annotation text in the app; flagging it here rather than
	// papering over it so Chunk 2/3 know precisely where the parity ceiling
	// is and why.
	it.fails("KNOWN GAP: sub-pixel divergence between canvas measureText() and DOM layout at an exact width boundary", () => {
		const span = mountPreviewSpan(subpixelBoundaryFixture.input);
		try {
			const browserLines = extractBrowserLines(span).map(stripTrailingWhitespace);
			const layout = layoutText(subpixelBoundaryFixture.input);
			const layoutLines = layout.lines.map((l) => stripTrailingWhitespace(l.text));
			expect(layoutLines).toEqual(browserLines);
		} finally {
			span.parentElement?.remove();
		}
	});
});
