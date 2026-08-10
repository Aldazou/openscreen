import { type CSSProperties, type PointerEvent, useEffect, useRef, useState } from "react";
import { Rnd } from "react-rnd";
import { getTextAnimationState } from "@/lib/annotationTextAnimation";
import {
	getBlurOverlayColor,
	getMosaicGridOverlayColor,
	getNormalizedBlurIntensity,
	getNormalizedMosaicBlockSize,
} from "@/lib/blurEffects";
import { applyReveal, getLineBackgroundRect, layoutText } from "@/lib/text/textLayout";
import { cn } from "@/lib/utils";
import { getArrowComponent } from "./ArrowSvgs";
import { type AnnotationRegion, type BlurData, DEFAULT_BLUR_DATA } from "./types";

const FREEHAND_POINT_THRESHOLD = 1;
type PreviewCanvasSource = {
	width: number;
	height: number;
	clientWidth?: number;
	clientHeight?: number;
};

function buildBlurPolygonClipPath(points: Array<{ x: number; y: number }>) {
	if (points.length < 3) return undefined;
	const polygon = points.map((point) => `${point.x}% ${point.y}%`).join(", ");
	return `polygon(${polygon})`;
}

function buildBlurFreehandPath(points: Array<{ x: number; y: number }>, closed = true) {
	if (closed ? points.length < 3 : points.length < 2) return null;
	const [firstPoint, ...rest] = points;
	const path = `M ${firstPoint.x} ${firstPoint.y} ${rest.map((point) => `L ${point.x} ${point.y}`).join(" ")}`;
	return closed ? `${path} Z` : path;
}

interface AnnotationOverlayProps {
	annotation: AnnotationRegion;
	isSelected: boolean;
	containerWidth: number;
	containerHeight: number;
	onPositionChange: (id: string, position: { x: number; y: number }) => void;
	onSizeChange: (id: string, size: { width: number; height: number }) => void;
	onBlurDataChange?: (id: string, blurData: BlurData) => void;
	onBlurDataCommit?: () => void;
	onClick: (id: string) => void;
	zIndex: number;
	isSelectedBoost: boolean; // raise z-index when selected, for easier editing
	previewSourceCanvas?: PreviewCanvasSource | null;
	previewFrameVersion?: number;
	currentTimeMs: number;
}

export function AnnotationOverlay({
	annotation,
	isSelected,
	containerWidth,
	containerHeight,
	onPositionChange,
	onSizeChange,
	onBlurDataChange,
	onBlurDataCommit,
	onClick,
	zIndex,
	isSelectedBoost,
	previewSourceCanvas,
	previewFrameVersion,
	currentTimeMs,
}: AnnotationOverlayProps) {
	const committedX = (annotation.position.x / 100) * containerWidth;
	const committedY = (annotation.position.y / 100) * containerHeight;
	const committedWidth = (annotation.size.width / 100) * containerWidth;
	const committedHeight = (annotation.size.height / 100) * containerHeight;
	const blurShape = annotation.type === "blur" ? (annotation.blurData?.shape ?? "rectangle") : null;
	const isSelectedFreehandBlur = isSelected && blurShape === "freehand";
	const isDraggingRef = useRef(false);
	const isDrawingFreehandRef = useRef(false);
	const freehandPointsRef = useRef<Array<{ x: number; y: number }>>([]);
	const [isFreehandDrawing, setIsFreehandDrawing] = useState(false);
	const [draftFreehandPoints, setDraftFreehandPoints] = useState<Array<{ x: number; y: number }>>(
		[],
	);
	const [livePointerPoint, setLivePointerPoint] = useState<{ x: number; y: number } | null>(null);
	const mosaicCanvasRef = useRef<HTMLCanvasElement | null>(null);
	const blurType = "mosaic";
	const blurOverlayColor =
		annotation.type === "blur" ? getBlurOverlayColor(annotation.blurData) : "";
	const mosaicGridOverlayColor =
		annotation.type === "blur" ? getMosaicGridOverlayColor(annotation.blurData) : "";
	const [liveRect, setLiveRect] = useState({
		x: committedX,
		y: committedY,
		width: committedWidth,
		height: committedHeight,
	});

	useEffect(() => {
		setLiveRect({
			x: committedX,
			y: committedY,
			width: committedWidth,
			height: committedHeight,
		});
	}, [committedHeight, committedWidth, committedX, committedY]);

	const { x, y, width, height } = liveRect;

	useEffect(() => {
		if (annotation.type !== "blur") {
			return;
		}
		void previewFrameVersion;

		const canvas = mosaicCanvasRef.current;
		const sourceCanvas = previewSourceCanvas;
		if (!canvas || !sourceCanvas) {
			return;
		}

		const sourceWidth = sourceCanvas.width;
		const sourceHeight = sourceCanvas.height;
		const sourceClientWidth = sourceCanvas.clientWidth || containerWidth || sourceWidth;
		const sourceClientHeight = sourceCanvas.clientHeight || containerHeight || sourceHeight;
		if (
			sourceWidth <= 0 ||
			sourceHeight <= 0 ||
			sourceClientWidth <= 0 ||
			sourceClientHeight <= 0
		) {
			return;
		}

		const drawWidth = Math.max(1, Math.round(width));
		const drawHeight = Math.max(1, Math.round(height));
		if (drawWidth <= 0 || drawHeight <= 0) {
			return;
		}

		canvas.width = drawWidth;
		canvas.height = drawHeight;

		const context = canvas.getContext("2d", { willReadFrequently: true });
		if (!context) {
			return;
		}

		const scaleX = sourceWidth / sourceClientWidth;
		const scaleY = sourceHeight / sourceClientHeight;
		const sourceX = Math.max(0, Math.floor(x * scaleX));
		const sourceY = Math.max(0, Math.floor(y * scaleY));
		const sourceSampleWidth = Math.max(1, Math.ceil(drawWidth * scaleX));
		const sourceSampleHeight = Math.max(1, Math.ceil(drawHeight * scaleY));
		const clampedSampleWidth = Math.max(1, Math.min(sourceSampleWidth, sourceWidth - sourceX));
		const clampedSampleHeight = Math.max(1, Math.min(sourceSampleHeight, sourceHeight - sourceY));
		const blockSize = getNormalizedMosaicBlockSize(annotation.blurData);
		const downscaledWidth = Math.max(1, Math.round(drawWidth / blockSize));
		const downscaledHeight = Math.max(1, Math.round(drawHeight / blockSize));
		canvas.width = downscaledWidth;
		canvas.height = downscaledHeight;

		context.clearRect(0, 0, downscaledWidth, downscaledHeight);
		context.imageSmoothingEnabled = true;
		context.drawImage(
			sourceCanvas as CanvasImageSource,
			sourceX,
			sourceY,
			clampedSampleWidth,
			clampedSampleHeight,
			0,
			0,
			downscaledWidth,
			downscaledHeight,
		);
	}, [
		annotation,
		containerHeight,
		containerWidth,
		height,
		previewFrameVersion,
		previewSourceCanvas,
		width,
		x,
		y,
	]);

	const renderArrow = () => {
		const direction = annotation.figureData?.arrowDirection || "right";
		const color = annotation.figureData?.color || "#34B27B";
		const strokeWidth = annotation.figureData?.strokeWidth || 4;

		const ArrowComponent = getArrowComponent(direction);
		return <ArrowComponent color={color} strokeWidth={strokeWidth} />;
	};

	const normalizePoint = (event: PointerEvent<HTMLDivElement>) => {
		const rect = event.currentTarget.getBoundingClientRect();
		const x = ((event.clientX - rect.left) / rect.width) * 100;
		const y = ((event.clientY - rect.top) / rect.height) * 100;
		return {
			x: Math.max(0, Math.min(100, x)),
			y: Math.max(0, Math.min(100, y)),
		};
	};

	const appendFreehandPoint = (point: { x: number; y: number }) => {
		const points = freehandPointsRef.current;
		const lastPoint = points[points.length - 1];
		if (!lastPoint) {
			points.push(point);
			return;
		}
		const dx = point.x - lastPoint.x;
		const dy = point.y - lastPoint.y;
		// Sample freehand points in annotation-space percent units to avoid overly dense paths.
		if (Math.hypot(dx, dy) >= FREEHAND_POINT_THRESHOLD) {
			points.push(point);
		}
	};

	const handleFreehandPointerDown = (event: PointerEvent<HTMLDivElement>) => {
		if (
			!isSelected ||
			annotation.type !== "blur" ||
			annotation.blurData?.shape !== "freehand" ||
			!onBlurDataChange
		) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		event.currentTarget.setPointerCapture(event.pointerId);
		isDrawingFreehandRef.current = true;
		setIsFreehandDrawing(true);
		const point = normalizePoint(event);
		freehandPointsRef.current = [point];
		setDraftFreehandPoints([point]);
		setLivePointerPoint(point);
	};

	const handleFreehandPointerMove = (event: PointerEvent<HTMLDivElement>) => {
		if (!isDrawingFreehandRef.current) return;
		event.preventDefault();
		event.stopPropagation();
		const point = normalizePoint(event);
		setLivePointerPoint(point);
		appendFreehandPoint(point);
		setDraftFreehandPoints([...freehandPointsRef.current]);
	};

	const finishFreehandPointer = (event: PointerEvent<HTMLDivElement>) => {
		if (!isDrawingFreehandRef.current || !onBlurDataChange) return;
		isDrawingFreehandRef.current = false;
		setIsFreehandDrawing(false);
		try {
			event.currentTarget.releasePointerCapture(event.pointerId);
		} catch {
			// no-op if already released
		}
		const points = [...freehandPointsRef.current];
		if (livePointerPoint) {
			const last = points[points.length - 1];
			if (!last || Math.hypot(last.x - livePointerPoint.x, last.y - livePointerPoint.y) > 0.001) {
				points.push(livePointerPoint);
			}
		}
		if (points.length >= 3) {
			const closedPoints = [...points];
			const first = closedPoints[0];
			const last = closedPoints[closedPoints.length - 1];
			if (Math.hypot(last.x - first.x, last.y - first.y) > 0.001) {
				closedPoints.push({ ...first });
			}
			onBlurDataChange(annotation.id, {
				...(annotation.blurData || { ...DEFAULT_BLUR_DATA, shape: "freehand" }),
				shape: "freehand",
				freehandPoints: closedPoints,
			});
			setDraftFreehandPoints(closedPoints);
			onBlurDataCommit?.();
		}
		setLivePointerPoint(null);
	};

	const renderContent = () => {
		switch (annotation.type) {
			case "text": {
				const animationState = getTextAnimationState(annotation, currentTimeMs);
				// scale/translate/opacity below are pre-existing (getTextAnimationState,
				// fade/rise/pop/slide-left/pulse) and out of scope for this rewire —
				// kept bit-for-bit, just relocated from the single wrapped <span> onto
				// the block wrapper below since there's no longer one element that
				// contains all the text.
				//
				// Typewriter reveal is NOT kept bit-for-bit: it moved from a CSS
				// clip-path pixel wipe (parallel across all lines) to semantic C —
				// see applyReveal()'s doc comment in textLayout.ts — per explicit
				// direction. `clipPath`/`WebkitClipPath` are gone entirely; the
				// revealed *text itself* is what's rendered per line below.

				// Pre-compute line breaks and vertical position with the same
				// module the export canvas renderer uses (src/lib/text/textLayout.ts),
				// instead of handing raw content to the browser and trusting its
				// own wrapping — that's what let preview and export drift apart.
				// `scaleFactor: 1` because this is the unscaled preview; `padding: 8`
				// matches the box's own p-2 (applied below via explicit left/right
				// insets rather than a CSS `padding` class — see note below).
				const layout = layoutText({
					content: annotation.content,
					fontSize: annotation.style.fontSize,
					fontFamily: annotation.style.fontFamily,
					fontWeight: annotation.style.fontWeight,
					fontStyle: annotation.style.fontStyle,
					boxWidth: width,
					boxHeight: height,
					padding: 8,
					scaleFactor: 1,
				});
				const revealedLines = applyReveal(layout, animationState.revealProgress);
				const hasBackground =
					!!annotation.style.backgroundColor && annotation.style.backgroundColor !== "transparent";

				return (
					<div
						className="w-full h-full overflow-hidden"
						style={{ position: "relative" }}
						data-testid="annotation-text-box"
					>
						{/*
						 * Animated wrapper spans the FULL box (no padding inset) —
						 * background rects below are positioned in full-box
						 * coordinates via getLineBackgroundRect(), which already
						 * bakes the 8px container padding into its own math (the
						 * same way annotationRenderer.ts's canvas path does via
						 * `x + bgRect.x`). The padded text wrapper nested inside
						 * establishes its own, separate 8px-inset coordinate space
						 * for the text lines — see its own comment below for why
						 * that one can't just reuse full-box coordinates.
						 */}
						<div
							data-testid="annotation-text-block"
							style={{
								position: "absolute",
								left: 0,
								right: 0,
								top: 0,
								bottom: 0,
								opacity: animationState.opacity,
								transform: `translate(${animationState.translateX}px, ${animationState.translateY}px) scale(${animationState.scale})`,
								transformOrigin: "center",
							}}
						>
							{hasBackground &&
								revealedLines.map((line) => {
									const bgRect = getLineBackgroundRect(layout, line, {
										textAlign: annotation.style.textAlign,
										fontSize: annotation.style.fontSize,
										boxWidth: width,
										padding: 8,
										scaleFactor: 1,
									});
									if (!bgRect) return null; // not reached yet: no background
									return (
										<div
											key={`bg-${line.index}`}
											data-testid="annotation-text-line-background"
											style={{
												position: "absolute",
												left: `${bgRect.x}px`,
												top: `${bgRect.y}px`,
												width: `${bgRect.width}px`,
												height: `${bgRect.height}px`,
												borderRadius: `${bgRect.borderRadius}px`,
												backgroundColor: annotation.style.backgroundColor,
											}}
										/>
									);
								})}
							{/*
							 * `p-2`'s 8px is applied here as explicit left/right insets
							 * rather than a CSS `padding` class: an absolutely positioned
							 * descendant's containing block is its ancestor's *padding*
							 * box, so a `padding` class on this element would sit
							 * outside where its abs-positioned line children measure
							 * "0", silently reintroducing the parity gap this rewire
							 * exists to close. (No `top`/`bottom` inset — vertical
							 * centering intentionally ignores padding; see
							 * textLayout.ts's blockTop comment for why that's safe.)
							 */}
							<div style={{ position: "absolute", left: 8, right: 8, top: 0, bottom: 0 }}>
								{revealedLines.map((line) => (
									<div
										key={line.index}
										data-testid="annotation-text-line"
										style={{
											position: "absolute",
											left: 0,
											right: 0,
											// Zero-leading box: height/lineHeight set to exactly
											// ascent+descent so the browser's own half-leading
											// contributes nothing, and the glyph baseline lands
											// at `top + ascent` — i.e. exactly `line.baselineY`.
											// See textLayout.ts's module doc comment.
											top: `${line.baselineY - layout.ascent}px`,
											height: `${layout.ascent + layout.descent}px`,
											lineHeight: `${layout.ascent + layout.descent}px`,
											// Pre-computed lines must never be re-wrapped by the
											// browser — that's the whole point of this rewire.
											whiteSpace: "pre",
											overflow: "hidden",
											textAlign: annotation.style.textAlign,
											// Horizontal-only counterpart of the span's old
											// `padding: "0.1em 0.2em"` (matches textLayout.ts's
											// default inlinePaddingEm.x, which already narrowed
											// availableWidth by this same amount on both sides).
											// The vertical 0.1em is now handled by the separate
											// background rect above (getLineBackgroundRect),
											// which can safely use real padding since it isn't
											// also carrying the baseline-critical zero-leading
											// box trick this element depends on.
											paddingLeft: "0.2em",
											paddingRight: "0.2em",
											color: annotation.style.color,
											fontSize: `${annotation.style.fontSize}px`,
											fontFamily: annotation.style.fontFamily,
											fontWeight: annotation.style.fontWeight,
											fontStyle: annotation.style.fontStyle,
											textDecoration: annotation.style.textDecoration,
										}}
									>
										{line.text}
									</div>
								))}
							</div>
						</div>
					</div>
				);
			}

			case "image":
				if (annotation.content && annotation.content.startsWith("data:image")) {
					return (
						<img
							src={annotation.content}
							alt="Annotation"
							className="w-full h-full object-contain"
							draggable={false}
						/>
					);
				}
				return (
					<div className="w-full h-full flex items-center justify-center text-slate-400 text-sm">
						No image
					</div>
				);

			case "figure":
				if (!annotation.figureData) {
					return (
						<div className="w-full h-full flex items-center justify-center text-slate-400 text-sm">
							No arrow data
						</div>
					);
				}

				return (
					<div className="w-full h-full flex items-center justify-center p-2">{renderArrow()}</div>
				);

			case "blur": {
				const shape = annotation.blurData?.shape ?? "rectangle";
				// Both go through the shared normalizers (src/lib/blurEffects.ts) so
				// preview and export clamp identically — see
				// getNormalizedBlurIntensity/getNormalizedMosaicBlockSize's parity
				// test in blurEffects.test.ts. This used to be inline
				// `Math.max(1, Math.round(annotation.blurData?.intensity ?? DEFAULT_BLUR_INTENSITY))`
				// for intensity — no upper bound — while export already clamped to
				// [MIN_BLUR_INTENSITY, MAX_BLUR_INTENSITY]; an out-of-range value
				// would have rendered a stronger blur in preview than export ships.
				const blurIntensity = Math.max(
					1,
					Math.round(getNormalizedBlurIntensity(annotation.blurData)),
				);
				const blockSize = getNormalizedMosaicBlockSize(annotation.blurData);
				const activeFreehandPoints =
					shape === "freehand"
						? isFreehandDrawing
							? draftFreehandPoints
							: (annotation.blurData?.freehandPoints ?? [])
						: [];
				const drawingPoints =
					isFreehandDrawing && livePointerPoint
						? (() => {
								const last = activeFreehandPoints[activeFreehandPoints.length - 1];
								if (!last) return [livePointerPoint];
								const dx = livePointerPoint.x - last.x;
								const dy = livePointerPoint.y - last.y;
								return Math.hypot(dx, dy) > 0.01
									? [...activeFreehandPoints, livePointerPoint]
									: activeFreehandPoints;
							})()
						: activeFreehandPoints;
				const clipPath =
					shape === "freehand" ? buildBlurPolygonClipPath(activeFreehandPoints) : undefined;
				const freehandPath =
					shape === "freehand"
						? buildBlurFreehandPath(
								isFreehandDrawing ? drawingPoints : activeFreehandPoints,
								!isFreehandDrawing,
							)
						: null;
				const currentPointerPoint = isFreehandDrawing
					? livePointerPoint || drawingPoints[drawingPoints.length - 1] || null
					: null;
				const shapeBorderRadius = shape === "oval" ? "50%" : shape === "rectangle" ? "8px" : "0";
				const shouldShowFreehandBlurFill =
					shape !== "freehand" || (!!clipPath && !isFreehandDrawing);
				const shapeMaskStyle: CSSProperties = {
					borderRadius: shapeBorderRadius,
					clipPath: isFreehandDrawing ? undefined : clipPath,
					WebkitClipPath: isFreehandDrawing ? undefined : clipPath,
				};
				const isFreehandSelected = isSelectedFreehandBlur;
				return (
					<div className="w-full h-full relative">
						<div
							className="absolute inset-0 overflow-hidden"
							style={{
								...shapeMaskStyle,
								isolation: "isolate",
							}}
						>
							<div
								className="absolute inset-0"
								style={{
									...shapeMaskStyle,
									backdropFilter: blurType === "mosaic" ? "none" : `blur(${blurIntensity}px)`,
									WebkitBackdropFilter: blurType === "mosaic" ? "none" : `blur(${blurIntensity}px)`,
									backgroundColor: blurOverlayColor,
									opacity: shouldShowFreehandBlurFill ? 1 : 0,
								}}
							/>
							{blurType === "mosaic" && shouldShowFreehandBlurFill && (
								<canvas
									ref={mosaicCanvasRef}
									className="absolute inset-0 w-full h-full"
									style={{
										...shapeMaskStyle,
										imageRendering: "pixelated",
									}}
								/>
							)}
							{blurType === "mosaic" && shouldShowFreehandBlurFill && (
								<div
									className="absolute inset-0 pointer-events-none"
									style={{
										...shapeMaskStyle,
										backgroundColor: blurOverlayColor,
									}}
								/>
							)}
							{blurType === "mosaic" && (
								<div
									className="absolute inset-0 pointer-events-none"
									style={{
										...shapeMaskStyle,
										backgroundImage: `linear-gradient(${mosaicGridOverlayColor} 1px, transparent 1px), linear-gradient(90deg, ${mosaicGridOverlayColor} 1px, transparent 1px)`,
										backgroundSize: `${blockSize}px ${blockSize}px`,
										mixBlendMode: "screen",
										opacity: 0.35,
									}}
								/>
							)}
							{isSelected && shape !== "freehand" && (
								<div
									className="absolute inset-0 pointer-events-none border-2 border-[#34B27B]/80"
									style={{ borderRadius: shapeBorderRadius }}
								/>
							)}
						</div>
						{isSelected && shape === "freehand" && freehandPath && (
							<svg
								viewBox="0 0 100 100"
								preserveAspectRatio="none"
								className="absolute inset-0 pointer-events-none"
							>
								<path
									d={freehandPath}
									fill="none"
									stroke="#34B27B"
									strokeWidth="0.55"
									strokeLinecap="round"
									strokeLinejoin="round"
								/>
								{currentPointerPoint && (
									<circle
										cx={currentPointerPoint.x}
										cy={currentPointerPoint.y}
										r="0.6"
										fill="#34B27B"
									/>
								)}
							</svg>
						)}
						{isFreehandSelected && (
							<div
								className="absolute inset-0 cursor-crosshair"
								onPointerDown={handleFreehandPointerDown}
								onPointerMove={handleFreehandPointerMove}
								onPointerUp={finishFreehandPointer}
								onPointerCancel={finishFreehandPointer}
							/>
						)}
					</div>
				);
			}

			default:
				return null;
		}
	};

	return (
		<Rnd
			position={{ x, y }}
			size={{ width, height }}
			onDragStart={() => {
				isDraggingRef.current = true;
			}}
			onDrag={(_e, d) => {
				setLiveRect((prev) => ({
					...prev,
					x: d.x,
					y: d.y,
				}));
			}}
			onDragStop={(_e, d) => {
				setLiveRect((prev) => ({
					...prev,
					x: d.x,
					y: d.y,
				}));
				const xPercent = (d.x / containerWidth) * 100;
				const yPercent = (d.y / containerHeight) * 100;
				onPositionChange(annotation.id, { x: xPercent, y: yPercent });

				// Delay clearing so the trailing click doesn't fire onClick
				setTimeout(() => {
					isDraggingRef.current = false;
				}, 100);
			}}
			onResize={(_e, _direction, ref, _delta, position) => {
				setLiveRect({
					x: position.x,
					y: position.y,
					width: ref.offsetWidth,
					height: ref.offsetHeight,
				});
			}}
			onResizeStop={(_e, _direction, ref, _delta, position) => {
				setLiveRect({
					x: position.x,
					y: position.y,
					width: ref.offsetWidth,
					height: ref.offsetHeight,
				});
				const xPercent = (position.x / containerWidth) * 100;
				const yPercent = (position.y / containerHeight) * 100;
				const widthPercent = (ref.offsetWidth / containerWidth) * 100;
				const heightPercent = (ref.offsetHeight / containerHeight) * 100;
				onPositionChange(annotation.id, { x: xPercent, y: yPercent });
				onSizeChange(annotation.id, { width: widthPercent, height: heightPercent });
			}}
			onClick={() => {
				if (isDraggingRef.current) return;
				onClick(annotation.id);
			}}
			bounds="parent"
			className={cn(
				"cursor-move",
				isSelected &&
					annotation.type !== "blur" &&
					"ring-2 ring-[#34B27B] ring-offset-2 ring-offset-transparent",
			)}
			style={{
				zIndex: isSelectedBoost ? zIndex + 1000 : zIndex, // keep the selected annotation on top
				pointerEvents: isSelected ? "auto" : "none",
				border:
					isSelected && annotation.type !== "blur" ? "2px solid rgba(52, 178, 123, 0.8)" : "none",
				backgroundColor:
					isSelected && annotation.type !== "blur" ? "rgba(52, 178, 123, 0.1)" : "transparent",
				boxShadow:
					isSelected && annotation.type !== "blur" ? "0 0 0 1px rgba(52, 178, 123, 0.35)" : "none",
			}}
			enableResizing={isSelected && !isSelectedFreehandBlur}
			disableDragging={!isSelected || isSelectedFreehandBlur}
			resizeHandleStyles={{
				topLeft: {
					width: "12px",
					height: "12px",
					backgroundColor: isSelected ? "white" : "transparent",
					border: isSelected ? "2px solid #34B27B" : "none",
					borderRadius: "50%",
					left: "-6px",
					top: "-6px",
					cursor: "nwse-resize",
				},
				topRight: {
					width: "12px",
					height: "12px",
					backgroundColor: isSelected ? "white" : "transparent",
					border: isSelected ? "2px solid #34B27B" : "none",
					borderRadius: "50%",
					right: "-6px",
					top: "-6px",
					cursor: "nesw-resize",
				},
				bottomLeft: {
					width: "12px",
					height: "12px",
					backgroundColor: isSelected ? "white" : "transparent",
					border: isSelected ? "2px solid #34B27B" : "none",
					borderRadius: "50%",
					left: "-6px",
					bottom: "-6px",
					cursor: "nesw-resize",
				},
				bottomRight: {
					width: "12px",
					height: "12px",
					backgroundColor: isSelected ? "white" : "transparent",
					border: isSelected ? "2px solid #34B27B" : "none",
					borderRadius: "50%",
					right: "-6px",
					bottom: "-6px",
					cursor: "nwse-resize",
				},
			}}
		>
			<div
				className={cn(
					"w-full h-full",
					annotation.type !== "blur" && "rounded-lg",
					annotation.type === "text" && "bg-transparent",
					annotation.type === "image" && "bg-transparent",
					annotation.type === "figure" && "bg-transparent",
					annotation.type === "blur" && "bg-transparent",
					isSelected && annotation.type !== "blur" && "shadow-lg",
				)}
			>
				{renderContent()}
			</div>
		</Rnd>
	);
}
