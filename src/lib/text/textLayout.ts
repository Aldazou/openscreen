// Pure, framework-free text layout shared by the annotation preview (DOM) and
// export (canvas) renderers. It exists to keep those two independent renderers
// from drifting apart: both should ask this module where the line breaks are
// instead of hand-rolling their own wrap loop.
//
// It mirrors the browser's `white-space: pre-wrap` + `word-break: break-word`
// behavior:
//  - explicit "\n" in content is a hard line break
//  - lines wrap greedily at whitespace boundaries
//  - CJK runs (Han/Hiragana/Katakana/Hangul) break at every character, since
//    CJK text has no word-separating whitespace
//  - a single token wider than the available width is broken mid-token (this
//    is what `break-word` does in a real browser; a naive greedy-by-token
//    wrap loop does not do this, so long unbroken runs like URLs overflow)
//
// See textLayout.browser.test.ts for the parity check against real browser
// line-breaking (via Range.getClientRects()).
//
// VERTICAL LAYOUT CONVENTION (chosen here, consumed identically by both
// renderers): the whole N-line block is centered as a unit within the
// annotation box — `blockHeight = lines.length * lineHeight`, centered on
// `boxHeight * scaleFactor` — matching what both renderers already did for
// a single line. What used to diverge is *how each line's glyphs sit within
// its line-height slot*: canvas's `textBaseline: "middle"` centers on the
// font's (ascent - descent) midpoint, while the DOM's native line-box
// half-leading centers the *line box*, and — critically — that DOM
// computation used to run on the browser's own aggregate multi-line
// wrapped-span bounding box, a completely separate calculation from
// canvas's manual per-line arithmetic, free to drift further apart as more
// lines made the aggregate box taller.
//
// Fix: compute one explicit `baselineY` per line here, using this module's
// own font-metrics measurement (`fontBoundingBoxAscent`/`Descent`, exposed
// as `ascent`/`descent`), and have both renderers place text at that exact
// y using the alphabetic baseline — canvas via `textBaseline: "alphabetic"`,
// DOM via a zero-leading line box (`height`/`line-height` set to exactly
// `ascent + descent`, positioned so its top is `baselineY - ascent`) rather
// than relying on the browser's own (potentially different) half-leading
// math. Alphabetic was chosen over reproducing "middle"/half-leading
// exactly because it's the one baseline both a 2D canvas context and a
// zero-leading DOM box can hit at the *same* explicit pixel value with no
// implicit, engine-owned centering step left for the two paths to disagree
// on.

export type TextLayoutInput = {
	content: string;
	fontSize: number; // unscaled CSS px
	fontFamily: string;
	fontWeight: "normal" | "bold";
	fontStyle: "normal" | "italic";
	boxWidth: number; // unscaled CSS px, the annotation box width
	boxHeight: number; // unscaled CSS px, the annotation box height
	padding: number; // unscaled CSS px, currently 8 (the box's own p-2)
	scaleFactor: number; // 1 for preview, >1 for export resolution
	/**
	 * The text span's own inline padding, in em (relative to `fontSize`),
	 * matching AnnotationOverlay's `padding: "0.1em 0.2em"`. Because that span
	 * also sets `boxDecorationBreak: "clone"`, this padding is reapplied on
	 * *every* wrapped line (not just the first/last), so `inlinePaddingEm.x`
	 * narrows `availableWidth` uniformly for all lines. Defaults to the
	 * editor's current values; only override for callers that genuinely don't
	 * render that padding.
	 */
	inlinePaddingEm?: { x: number; y: number };
};

const DEFAULT_INLINE_PADDING_EM = { x: 0.2, y: 0.1 };

// Fallback used only if a runtime doesn't populate TextMetrics.fontBoundingBox*
// (all target runtimes here — Chromium via Electron and Playwright — do).
// Roughly typical Latin-font proportions: ascent ~80% of em, descent ~20%.
const FALLBACK_ASCENT_RATIO = 0.8;
const FALLBACK_DESCENT_RATIO = 0.2;

export type TextLayoutLine = {
	text: string;
	index: number;
	/**
	 * Scaled, relative to the annotation box's own top edge (0 = box top).
	 * The exact y to pass as the second argument to `ctx.fillText()` with
	 * `ctx.textBaseline = "alphabetic"`, or to derive a DOM line box's `top`
	 * from (`top = baselineY - ascent`). See `TextLayout.ascent`/`descent`
	 * and the module-level doc comment for why this exists.
	 */
	baselineY: number;
	/** Scaled rendered width of `text` in `fontString`. Recomputed by
	 * `applyReveal()` for a partially-revealed line, so it always matches
	 * *this* line's actual `text`, not the original unrevealed line. */
	width: number;
};

export type TextAlign = "left" | "center" | "right";

export type TextLayout = {
	lines: TextLayoutLine[];
	lineHeight: number; // scaled
	fontString: string; // canvas-ready font shorthand, e.g. "italic bold 32px Inter"
	availableWidth: number; // scaled
	/**
	 * Font-level (not glyph-level) ascent/descent from the same measurement
	 * context used for wrapping, in scaled px. Combined with `baselineY`,
	 * lets a consumer reproduce this module's vertical layout exactly:
	 * a line's box spans [baselineY - ascent, baselineY + descent].
	 */
	ascent: number;
	descent: number;
};

const LINE_HEIGHT_MULTIPLIER = 1.4;

// Han/Hiragana/Katakana/Hangul code points, to split CJK text at character
// boundaries during wrap (CJK has no word-separating whitespace). Script
// escapes need ES2018+; tsconfig targets ES2020.
const CJK_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

type GraphemeSegmenter = {
	segment(value: string): Iterable<{ segment: string }>;
};

type IntlWithSegmenter = typeof Intl & {
	Segmenter?: new (
		locales?: string | string[],
		options?: { granularity?: "grapheme" },
	) => GraphemeSegmenter;
};

const SegmenterCtor = (Intl as IntlWithSegmenter).Segmenter;
const graphemeSegmenter =
	typeof SegmenterCtor === "function"
		? new SegmenterCtor(undefined, { granularity: "grapheme" })
		: null;

function splitGraphemes(value: string): string[] {
	if (!graphemeSegmenter) return Array.from(value);
	return Array.from(graphemeSegmenter.segment(value), ({ segment }) => segment);
}

// Minimal surface needed for text measurement; satisfied by both
// CanvasRenderingContext2D and OffscreenCanvasRenderingContext2D, without
// pulling either specific lib type into this module's public API.
interface TextMeasurer {
	font: string;
	measureText(text: string): {
		width: number;
		fontBoundingBoxAscent?: number;
		fontBoundingBoxDescent?: number;
	};
}

let measureCtx: TextMeasurer | null = null;

function getMeasureContext(): TextMeasurer {
	if (measureCtx) return measureCtx;

	if (typeof OffscreenCanvas !== "undefined") {
		const ctx = new OffscreenCanvas(1, 1).getContext("2d");
		if (ctx) {
			measureCtx = ctx as unknown as TextMeasurer;
			return measureCtx;
		}
	}

	if (typeof document !== "undefined") {
		const canvas = document.createElement("canvas");
		canvas.width = 1;
		canvas.height = 1;
		const ctx = canvas.getContext("2d");
		if (ctx) {
			measureCtx = ctx;
			return measureCtx;
		}
	}

	throw new Error("textLayout: no 2D canvas context available for text measurement");
}

function tokenizeForWrap(line: string): string[] {
	// Split Latin runs on whitespace (kept as their own tokens) and split CJK
	// runs into individual characters so each is a break opportunity, mirroring
	// the browser's word-break: break-word handling of CJK.
	const tokens: string[] = [];
	let buffer = "";
	const chars = Array.from(line);
	const flushBuffer = () => {
		if (buffer) {
			tokens.push(...buffer.split(/(\s+)/).filter((s) => s.length > 0));
			buffer = "";
		}
	};
	for (const ch of chars) {
		if (CJK_CHAR.test(ch)) {
			flushBuffer();
			tokens.push(ch);
		} else {
			buffer += ch;
		}
	}
	flushBuffer();
	return tokens;
}

/**
 * Splits `text` into the longest grapheme-safe prefix that fits within
 * `availableWidth`, and the remainder. Always consumes at least one
 * grapheme (even if it alone exceeds `availableWidth`) so callers make
 * forward progress instead of looping forever.
 */
function splitToFit(
	text: string,
	availableWidth: number,
	measure: (value: string) => number,
): { fits: string; rest: string } {
	const graphemes = splitGraphemes(text);
	let fits = "";
	let count = 0;
	for (let i = 0; i < graphemes.length; i++) {
		const candidate = fits + graphemes[i];
		if (count === 0 || measure(candidate) <= availableWidth) {
			fits = candidate;
			count = i + 1;
		} else {
			break;
		}
	}
	return { fits, rest: graphemes.slice(count).join("") };
}

// Strips whitespace (spaces/tabs — `rawLine` never contains "\n") from the
// end of a string. Used only on lines that ended at a *soft* wrap point.
function stripTrailingSoftWrapSpace(text: string): string {
	return text.replace(/\s+$/, "");
}

function wrapLine(
	rawLine: string,
	availableWidth: number,
	measure: (value: string) => number,
): string[] {
	if (rawLine === "") return [""];

	const tokens = tokenizeForWrap(rawLine);
	const lines: string[] = [];
	let current = "";

	for (const rawToken of tokens) {
		const test = current + rawToken;
		if (current && measure(test) > availableWidth) {
			lines.push(current);
			current = rawToken.trimStart();
		} else {
			current = test;
		}

		// Force-break within the token if it still doesn't fit on its own line
		// (`word-break: break-word` kicking in on a single unbreakable run,
		// e.g. a long URL). Keeps splitting off full-width chunks until the
		// remainder is short enough to fit, or nothing more can be peeled off.
		while (current && measure(current) > availableWidth) {
			const { fits, rest } = splitToFit(current, availableWidth, measure);
			if (!rest) break;
			lines.push(fits);
			current = rest;
		}
	}

	if (current || lines.length === 0) lines.push(current);

	// A trailing space (or run of whitespace) left dangling on a line only
	// ever happens because it was the token that fit *before* the next word
	// didn't — i.e. it sits exactly at a soft wrap point. Per CSS
	// `white-space: pre-wrap`, that whitespace visually hangs past the line
	// box rather than rendering, so callers (canvas centering/right-align
	// math in particular) must never see it. This does NOT apply to the last
	// line of this raw segment: whitespace there was typed immediately
	// before an explicit "\n" (or the end of content) and is real, visible
	// content that must round-trip unchanged — including a line that is
	// *entirely* whitespace.
	for (let i = 0; i < lines.length - 1; i++) {
		lines[i] = stripTrailingSoftWrapSpace(lines[i]);
	}
	return lines;
}

export function layoutText(input: TextLayoutInput): TextLayout {
	const {
		content,
		fontSize,
		fontFamily,
		fontWeight,
		fontStyle,
		boxWidth,
		boxHeight,
		padding,
		scaleFactor,
	} = input;
	const inlinePaddingEm = input.inlinePaddingEm ?? DEFAULT_INLINE_PADDING_EM;

	const scaledFontSize = fontSize * scaleFactor;
	const fontString = `${fontStyle} ${fontWeight} ${scaledFontSize}px ${fontFamily}`;
	// `lineHeight` intentionally does not factor in `inlinePaddingEm.y`: CSS
	// `line-height` governs line-box stacking on its own, and inline padding
	// (even with box-decoration-break: clone) doesn't push lines apart in
	// normal flow — it only extends each line's decorated background/border
	// box visually. If a future consumer needs the padded visual extent of a
	// line (e.g. to size a highlight background), that's a rendering concern
	// for that consumer, not this module's line-break math.
	const lineHeight = scaledFontSize * LINE_HEIGHT_MULTIPLIER;
	const containerAvailableWidth = (boxWidth - padding * 2) * scaleFactor;
	const inlineHorizontalPadding = 2 * inlinePaddingEm.x * scaledFontSize;
	const availableWidth = Math.max(0, containerAvailableWidth - inlineHorizontalPadding);

	const ctx = getMeasureContext();
	ctx.font = fontString;
	const measure = (value: string) => ctx.measureText(value).width;

	// Font-level ascent/descent (not glyph-specific — any non-empty probe
	// string works; `fontBoundingBox*` reflects the font's own metrics, not
	// the particular characters measured).
	const probeMetrics = ctx.measureText("Hxg");
	const ascent = probeMetrics.fontBoundingBoxAscent ?? scaledFontSize * FALLBACK_ASCENT_RATIO;
	const descent = probeMetrics.fontBoundingBoxDescent ?? scaledFontSize * FALLBACK_DESCENT_RATIO;

	const rawLines = content.split("\n");
	const wrappedTexts: string[] = [];
	for (const rawLine of rawLines) {
		wrappedTexts.push(...wrapLine(rawLine, availableWidth, measure));
	}

	// Center the whole block within the box (vertical padding is intentionally
	// not subtracted here: centering a smaller block within a symmetrically
	// padded region lands on the exact same center line as centering it
	// within the unpadded region — the padding only ever matters for
	// overflow/clipping, never for where the center sits).
	const blockHeight = wrappedTexts.length * lineHeight;
	const blockTop = (boxHeight * scaleFactor - blockHeight) / 2;
	const firstLineCenterY = blockTop + lineHeight / 2;

	const lines: TextLayoutLine[] = wrappedTexts.map((text, index) => {
		const lineCenterY = firstLineCenterY + index * lineHeight;
		const baselineY = lineCenterY + (ascent - descent) / 2;
		return { text, index, baselineY, width: measure(text) };
	});

	return { lines, lineHeight, fontString, availableWidth, ascent, descent };
}

// TYPEWRITER REVEAL — semantic C: graphemes reveal sequentially across the
// *whole block*, in reading order — line 1 completes before line 2 begins.
// This replaces two prior, mutually-inconsistent approximations: the preview
// used to clip the entire (multi-line) span with a single CSS clip-path
// percentage inset (a pixel wipe, moving all lines in lockstep); export used
// to reveal each line to the *same fraction* of its own grapheme count in
// parallel (so a short line and a long line finished at the same instant,
// which doesn't read as typing). Neither treated the block as one sequence.
//
// Implemented once, here, as a pure function of a single global grapheme
// index — `ceil(totalGraphemes * revealProgress)` — allocated across lines
// in order. Both renderers call this and render the returned (possibly
// truncated) lines directly; neither needs its own clipping or slicing math.
export function applyReveal(layout: TextLayout, revealProgress: number): TextLayoutLine[] {
	const clamped = Math.min(1, Math.max(0, revealProgress));
	if (clamped >= 1) return layout.lines;

	const ctx = getMeasureContext();
	ctx.font = layout.fontString;
	const measure = (value: string) => ctx.measureText(value).width;

	const graphemesPerLine = layout.lines.map((line) => splitGraphemes(line.text));
	const totalGraphemes = graphemesPerLine.reduce((sum, g) => sum + g.length, 0);
	let remaining = Math.ceil(totalGraphemes * clamped);

	return layout.lines.map((line, index) => {
		const graphemes = graphemesPerLine[index];
		if (remaining <= 0) {
			// Not reached yet: no text, and (via width: 0) no background — see
			// getLineBackgroundRect(), which also treats an empty line as "no
			// background to draw" via its own `!line.text` check.
			return { ...line, text: "", width: 0 };
		}
		if (remaining >= graphemes.length) {
			remaining -= graphemes.length;
			return line; // fully visible already; text/width unchanged
		}
		const visibleText = graphemes.slice(0, remaining).join("");
		remaining = 0;
		return { ...line, text: visibleText, width: measure(visibleText) };
	});
}

// BACKGROUND BOX — the highlight rectangle behind a line of text when
// `style.backgroundColor` is set. Was two independent implementations:
// export hand-rolled a `roundRect` per line; preview used
// `background-color` + `padding: "0.1em 0.2em"` +
// `box-decoration-break: clone` on the (single, wrapped) text span, which
// implicitly cloned the highlight onto every wrapped line. Both used the
// same padding/radius *ratios* (0.1em / 0.2em / 4px), just applied through
// different mechanisms — reconciled here into one geometry formula both
// renderers evaluate identically.
export type LineBackgroundRect = {
	x: number; // scaled, relative to the annotation box's own top-left
	y: number; // scaled, relative to the annotation box's own top-left
	width: number; // scaled
	height: number; // scaled
	borderRadius: number; // scaled
};

const BACKGROUND_VERTICAL_PADDING_EM = 0.1;
const BACKGROUND_HORIZONTAL_PADDING_EM = 0.2;
const BACKGROUND_BORDER_RADIUS_PX = 4; // unscaled

/**
 * Computes the highlight rectangle for one line, or `null` if the line has
 * no text to highlight (in particular: a not-yet-revealed line under
 * `applyReveal()` — "a line not yet reached draws no background at all").
 *
 * Always sized/positioned from `line`'s *own* `text`/`width` — so during an
 * active reveal, the background tracks the revealed substring exactly (grows
 * as it grows, matching where the revealed glyphs actually sit for the
 * current alignment) rather than being pinned to where the *full* line would
 * eventually sit. That's a deliberate simplification versus the pre-2b
 * export code, which anchored center/right-aligned backgrounds to the full
 * (unrevealed) line's position while only sizing them to the revealed
 * width — a mismatch that was never visually verified for that combination.
 * Self-consistent instead: when nothing is being revealed (the overwhelming
 * common case, `revealProgress >= 1`), `line.width` already equals the full
 * line's width, so this produces byte-for-byte the same rectangle the old
 * per-line `roundRect` math did.
 */
export function getLineBackgroundRect(
	layout: TextLayout,
	line: TextLayoutLine,
	options: {
		textAlign: TextAlign;
		fontSize: number; // unscaled
		boxWidth: number; // unscaled
		padding: number; // unscaled, the box's own container padding
		scaleFactor: number;
	},
): LineBackgroundRect | null {
	if (!line.text) return null;

	const { textAlign, fontSize, boxWidth, padding, scaleFactor } = options;
	const scaledFontSize = fontSize * scaleFactor;
	const verticalPadding = scaledFontSize * BACKGROUND_VERTICAL_PADDING_EM;
	const horizontalPadding = scaledFontSize * BACKGROUND_HORIZONTAL_PADDING_EM;
	const containerPadding = padding * scaleFactor;
	const boxWidthScaled = boxWidth * scaleFactor;

	const width = line.width + horizontalPadding * 2;
	const height = layout.lineHeight + verticalPadding * 2;

	let x: number;
	if (textAlign === "center") {
		x = boxWidthScaled / 2 - line.width / 2 - horizontalPadding;
	} else if (textAlign === "right") {
		x = boxWidthScaled - containerPadding - line.width - horizontalPadding;
	} else {
		x = containerPadding - horizontalPadding;
	}

	const lineCenterY = line.baselineY - (layout.ascent - layout.descent) / 2;
	const y = lineCenterY - height / 2;

	return { x, y, width, height, borderRadius: BACKGROUND_BORDER_RADIUS_PX * scaleFactor };
}
