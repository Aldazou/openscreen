import { type AnnotationRegion, type ArrowDirection } from "@/components/video-editor/types";
import { getTextAnimationState } from "@/lib/annotationTextAnimation";
import {
	applyMosaicToImageData,
	getBlurOverlayColor,
	getNormalizedBlurIntensity,
	getNormalizedMosaicBlockSize,
	normalizeBlurType,
} from "@/lib/blurEffects";
import { applyReveal, getLineBackgroundRect, layoutText } from "@/lib/text/textLayout";
import { decodeImageAnnotation, frameAtElapsed } from "./animatedImage";

let blurScratchCanvas: HTMLCanvasElement | null = null;
let blurScratchCtx: CanvasRenderingContext2D | null = null;

// SVG path data for each arrow direction
const ARROW_PATHS: Record<ArrowDirection, string[]> = {
	up: ["M 50 20 L 50 80", "M 50 20 L 35 35", "M 50 20 L 65 35"],
	down: ["M 50 20 L 50 80", "M 50 80 L 35 65", "M 50 80 L 65 65"],
	left: ["M 80 50 L 20 50", "M 20 50 L 35 35", "M 20 50 L 35 65"],
	right: ["M 20 50 L 80 50", "M 80 50 L 65 35", "M 80 50 L 65 65"],
	"up-right": ["M 25 75 L 75 25", "M 75 25 L 60 30", "M 75 25 L 70 40"],
	"up-left": ["M 75 75 L 25 25", "M 25 25 L 40 30", "M 25 25 L 30 40"],
	"down-right": ["M 25 25 L 75 75", "M 75 75 L 70 60", "M 75 75 L 60 70"],
	"down-left": ["M 75 25 L 25 75", "M 25 75 L 30 60", "M 25 75 L 40 70"],
};

function parseSvgPath(
	pathString: string,
	scaleX: number,
	scaleY: number,
): Array<{ cmd: string; args: number[] }> {
	const commands: Array<{ cmd: string; args: number[] }> = [];
	const parts = pathString.trim().split(/\s+/);

	let i = 0;
	while (i < parts.length) {
		const cmd = parts[i];
		if (cmd === "M" || cmd === "L") {
			const x = parseFloat(parts[i + 1]) * scaleX;
			const y = parseFloat(parts[i + 2]) * scaleY;
			commands.push({ cmd, args: [x, y] });
			i += 3;
		} else {
			i++;
		}
	}

	return commands;
}

function renderArrow(
	ctx: CanvasRenderingContext2D,
	direction: ArrowDirection,
	color: string,
	strokeWidth: number,
	x: number,
	y: number,
	width: number,
	height: number,
	_scaleFactor: number,
) {
	const paths = ARROW_PATHS[direction];
	if (!paths) return;

	ctx.save();
	ctx.translate(x, y);

	const padding = 8 * _scaleFactor;
	const availableWidth = Math.max(0, width - padding * 2);
	const availableHeight = Math.max(0, height - padding * 2);

	const scale = Math.min(availableWidth / 100, availableHeight / 100);

	const offsetX = padding + (availableWidth - 100 * scale) / 2;
	const offsetY = padding + (availableHeight - 100 * scale) / 2;

	ctx.translate(offsetX, offsetY);

	ctx.shadowColor = "rgba(0, 0, 0, 0.3)";
	ctx.shadowBlur = 8 * scale;
	ctx.shadowOffsetX = 0;
	ctx.shadowOffsetY = 4 * scale;

	ctx.strokeStyle = color;
	ctx.lineWidth = strokeWidth * scale;
	ctx.lineCap = "round";
	ctx.lineJoin = "round";

	// One shape so shadows/strokes don't overlap
	ctx.beginPath();

	for (const pathString of paths) {
		const commands = parseSvgPath(pathString, scale, scale);

		for (const { cmd, args } of commands) {
			if (cmd === "M") {
				ctx.moveTo(args[0], args[1]);
			} else if (cmd === "L") {
				ctx.lineTo(args[0], args[1]);
			}
		}
	}

	ctx.stroke();

	ctx.restore();
}

function drawBlurPath(
	ctx: CanvasRenderingContext2D,
	annotation: AnnotationRegion,
	x: number,
	y: number,
	width: number,
	height: number,
) {
	const shape = annotation.blurData?.shape || "rectangle";
	if (shape === "rectangle") {
		ctx.beginPath();
		ctx.rect(x, y, width, height);
		return;
	}

	if (shape === "oval") {
		ctx.beginPath();
		ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
		return;
	}

	const points = annotation.blurData?.freehandPoints;
	if (shape === "freehand" && points && points.length >= 3) {
		ctx.beginPath();
		ctx.moveTo(x + (points[0].x / 100) * width, y + (points[0].y / 100) * height);
		for (let i = 1; i < points.length; i++) {
			ctx.lineTo(x + (points[i].x / 100) * width, y + (points[i].y / 100) * height);
		}
		ctx.closePath();
		return;
	}

	ctx.beginPath();
	ctx.rect(x, y, width, height);
}

function renderBlur(
	ctx: CanvasRenderingContext2D,
	annotation: AnnotationRegion,
	x: number,
	y: number,
	width: number,
	height: number,
	scaleFactor: number,
) {
	const canvas = ctx.canvas;
	const blurType = normalizeBlurType(annotation.blurData?.type);

	const blurRadius = Math.max(
		1,
		Math.round(getNormalizedBlurIntensity(annotation.blurData) * scaleFactor),
	);
	const samplePadding =
		blurType === "mosaic"
			? Math.max(0, Math.ceil(getNormalizedMosaicBlockSize(annotation.blurData, scaleFactor)))
			: Math.max(2, Math.ceil(blurRadius * 2));
	const sx = Math.max(0, Math.floor(x) - samplePadding);
	const sy = Math.max(0, Math.floor(y) - samplePadding);
	const ex = Math.min(canvas.width, Math.ceil(x + width) + samplePadding);
	const ey = Math.min(canvas.height, Math.ceil(y + height) + samplePadding);
	const sw = Math.max(0, ex - sx);
	const sh = Math.max(0, ey - sy);
	if (sw <= 0 || sh <= 0) return;

	if (!blurScratchCanvas || !blurScratchCtx) {
		blurScratchCanvas = document.createElement("canvas");
		blurScratchCtx = blurScratchCanvas.getContext("2d");
	}
	if (!blurScratchCanvas || !blurScratchCtx) return;

	blurScratchCanvas.width = sw;
	blurScratchCanvas.height = sh;
	blurScratchCtx.clearRect(0, 0, sw, sh);
	blurScratchCtx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

	if (blurType === "mosaic") {
		const imageData = blurScratchCtx.getImageData(0, 0, sw, sh);
		applyMosaicToImageData(
			imageData,
			getNormalizedMosaicBlockSize(annotation.blurData, scaleFactor),
		);
		blurScratchCtx.putImageData(imageData, 0, 0);
	}

	ctx.save();
	drawBlurPath(ctx, annotation, x, y, width, height);
	ctx.clip();
	ctx.filter = blurType === "mosaic" ? "none" : `blur(${blurRadius}px)`;
	ctx.drawImage(blurScratchCanvas, sx, sy);
	ctx.filter = "none";
	ctx.fillStyle = getBlurOverlayColor(annotation.blurData);
	ctx.fillRect(sx, sy, sw, sh);
	ctx.restore();
}

function renderText(
	ctx: CanvasRenderingContext2D,
	annotation: AnnotationRegion,
	x: number,
	y: number,
	width: number,
	height: number,
	scaleFactor: number,
	currentTimeMs: number,
) {
	const style = annotation.style;
	const animationState = getTextAnimationState(annotation, currentTimeMs);

	ctx.save();

	const transformOriginX = x + width / 2;
	const transformOriginY = y + height / 2;
	ctx.translate(transformOriginX, transformOriginY);
	ctx.translate(animationState.translateX * scaleFactor, animationState.translateY * scaleFactor);
	ctx.scale(animationState.scale, animationState.scale);
	ctx.translate(-transformOriginX, -transformOriginY);
	ctx.globalAlpha *= animationState.opacity;

	// Clip to box bounds, matching editor's overflow: hidden
	ctx.beginPath();
	ctx.rect(x, y, width, height);
	ctx.clip();

	const fontWeight = style.fontWeight === "bold" ? "bold" : "normal";
	const fontStyle = style.fontStyle === "italic" ? "italic" : "normal";
	const scaledFontSize = style.fontSize * scaleFactor;

	// `x`/`y`/`width`/`height` here are already at export resolution (scaled
	// by `scaleFactor`); layoutText() wants the unscaled preview-CSS-px box
	// dimensions and applies scaleFactor itself, so divide back out. This is
	// an exact round trip: `width` was produced as
	// `(annotation.size.width / 100) * canvasWidth`, and `canvasWidth` is
	// `previewWidth * scaleFactor` — the same box AnnotationOverlay lays out,
	// just at a different resolution.
	const layout = layoutText({
		content: annotation.content,
		fontSize: style.fontSize,
		fontFamily: style.fontFamily,
		fontWeight,
		fontStyle,
		boxWidth: width / scaleFactor,
		boxHeight: height / scaleFactor,
		padding: 8,
		scaleFactor,
	});

	ctx.font = layout.fontString;
	// Alphabetic (not "middle"): see textLayout.ts's module doc comment for
	// why the two renderers now share one explicit baselineY per line rather
	// than each independently centering a line-height box.
	ctx.textBaseline = "alphabetic";

	const containerPadding = 8 * scaleFactor;

	let textX = x;

	if (style.textAlign === "center") {
		textX = x + width / 2;
		ctx.textAlign = "center";
	} else if (style.textAlign === "right") {
		textX = x + width - containerPadding;
		ctx.textAlign = "right";
	} else {
		textX = x + containerPadding;
		ctx.textAlign = "left";
	}

	// Semantic C: graphemes reveal sequentially across the whole block (line 1
	// completes before line 2 begins), computed once as pure data — see
	// applyReveal()'s doc comment in textLayout.ts. Each returned line's
	// `.text`/`.width` already reflect how much of *that* line is currently
	// visible, so nothing below needs its own grapheme-slicing math anymore.
	const revealedLines = applyReveal(layout, animationState.revealProgress);

	revealedLines.forEach((line) => {
		if (!line.text) return; // not reached yet — draws nothing, no background either

		const baselineY = y + line.baselineY;

		const previousAlign = ctx.textAlign;
		let startX = textX;

		if (ctx.textAlign === "center") {
			startX = textX - line.width / 2;
			ctx.textAlign = "left";
		} else if (ctx.textAlign === "right" || ctx.textAlign === "end") {
			startX = textX - line.width;
			ctx.textAlign = "left";
		}

		if (style.backgroundColor && style.backgroundColor !== "transparent") {
			const bgRect = getLineBackgroundRect(layout, line, {
				textAlign: style.textAlign,
				fontSize: style.fontSize,
				boxWidth: width / scaleFactor,
				padding: 8,
				scaleFactor,
			});
			if (bgRect) {
				ctx.fillStyle = style.backgroundColor;
				ctx.beginPath();
				ctx.roundRect(x + bgRect.x, y + bgRect.y, bgRect.width, bgRect.height, bgRect.borderRadius);
				ctx.fill();
			}
		}

		ctx.fillStyle = style.color;
		ctx.fillText(line.text, startX, baselineY);

		if (style.textDecoration === "underline") {
			const lineCenterY = baselineY - (layout.ascent - layout.descent) / 2;
			let underlineX = startX;
			const underlineY = lineCenterY + scaledFontSize * 0.15;

			if (previousAlign === "left" || previousAlign === "start") {
				underlineX = textX;
			}

			ctx.strokeStyle = style.color;
			ctx.lineWidth = Math.max(1, scaledFontSize / 16);
			ctx.beginPath();
			ctx.moveTo(underlineX, underlineY);
			ctx.lineTo(underlineX + line.width, underlineY);
			ctx.stroke();
		}

		ctx.textAlign = previousAlign;
	});

	ctx.restore();
}

async function renderImage(
	ctx: CanvasRenderingContext2D,
	annotation: AnnotationRegion,
	x: number,
	y: number,
	width: number,
	height: number,
	currentTimeMs: number,
): Promise<void> {
	if (!annotation.content || !annotation.content.startsWith("data:image")) {
		return;
	}

	const decoded = await decodeImageAnnotation(annotation.content);
	// Animate from when the annotation appears, so the same timeline position always
	// exports the same frame.
	const frame = frameAtElapsed(decoded, currentTimeMs - annotation.startMs);
	if (!frame || decoded.width === 0 || decoded.height === 0) return;

	// Contain within bounds, preserving aspect ratio
	const imgAspect = decoded.width / decoded.height;
	const boxAspect = width / height;

	let drawWidth = width;
	let drawHeight = height;
	let drawX = x;
	let drawY = y;

	if (imgAspect > boxAspect) {
		drawHeight = width / imgAspect;
		drawY = y + (height - drawHeight) / 2;
	} else {
		drawWidth = height * imgAspect;
		drawX = x + (width - drawWidth) / 2;
	}

	// The preview's <img> scales with the browser's own (high-quality) resampling. Canvas
	// defaults to "low", which made resized image annotations visibly softer on export.
	const previousQuality = ctx.imageSmoothingQuality;
	ctx.imageSmoothingQuality = "high";
	ctx.drawImage(frame, drawX, drawY, drawWidth, drawHeight);
	ctx.imageSmoothingQuality = previousQuality;
}

export async function renderAnnotations(
	ctx: CanvasRenderingContext2D,
	annotations: AnnotationRegion[],
	canvasWidth: number,
	canvasHeight: number,
	currentTimeMs: number,
	scaleFactor: number = 1.0,
): Promise<void> {
	const activeAnnotations = annotations.filter(
		(ann) => currentTimeMs >= ann.startMs && currentTimeMs < ann.endMs,
	);

	// Lower z-index first so higher draws on top
	const sortedAnnotations = [...activeAnnotations].sort((a, b) => a.zIndex - b.zIndex);

	for (const annotation of sortedAnnotations) {
		const x = (annotation.position.x / 100) * canvasWidth;
		const y = (annotation.position.y / 100) * canvasHeight;
		const width = (annotation.size.width / 100) * canvasWidth;
		const height = (annotation.size.height / 100) * canvasHeight;

		switch (annotation.type) {
			case "text":
				renderText(ctx, annotation, x, y, width, height, scaleFactor, currentTimeMs);
				break;

			case "image":
				await renderImage(ctx, annotation, x, y, width, height, currentTimeMs);
				break;

			case "figure":
				if (annotation.figureData) {
					// Same `|| <default>` fallbacks AnnotationOverlay.tsx's renderArrow()
					// applies (arrowDirection || "right", color || "#34B27B",
					// strokeWidth || 4) — this call site used to pass the raw
					// figureData fields straight through with no fallback. In
					// practice figureData is always populated via
					// `{...DEFAULT_FIGURE_DATA, ...region.figureData}` on
					// create/load, and the stroke-width slider is bounded [1, 6],
					// so a falsy value isn't reachable today; this only guards
					// against future/malformed data silently diverging (export
					// drawing nothing for a falsy arrowDirection, an invisible
					// 0-width stroke, etc.) instead of matching preview's fallback.
					renderArrow(
						ctx,
						annotation.figureData.arrowDirection || "right",
						annotation.figureData.color || "#34B27B",
						annotation.figureData.strokeWidth || 4,
						x,
						y,
						width,
						height,
						scaleFactor,
					);
				}
				break;

			case "blur":
				renderBlur(ctx, annotation, x, y, width, height, scaleFactor);
				break;
		}
	}
}
