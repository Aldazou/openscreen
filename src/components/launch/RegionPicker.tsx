import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type DragRect = { x: number; y: number; width: number; height: number };

/** Match normalizeCaptureCropRegion's 2% minimum so confirm never silently cancels. */
function minRegionPixels(): { minW: number; minH: number } {
	const vw = window.innerWidth || 1;
	const vh = window.innerHeight || 1;
	return {
		minW: Math.max(24, Math.ceil(vw * 0.02)),
		minH: Math.max(24, Math.ceil(vh * 0.02)),
	};
}

/**
 * Full-screen region picker: drag a rectangle, Enter/click Confirm, Esc cancel.
 * Returns a normalized crop (0–1) relative to this overlay window.
 */
export function RegionPicker() {
	const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
	const [rect, setRect] = useState<DragRect | null>(null);
	const [error, setError] = useState<string | null>(null);
	const dragging = useRef(false);
	const { minW, minH } = useMemo(() => minRegionPixels(), []);

	const cancel = useCallback(() => {
		void window.electronAPI.regionPickerComplete({ canceled: true });
	}, []);

	const confirm = useCallback(
		(r: DragRect) => {
			const vw = window.innerWidth || 1;
			const vh = window.innerHeight || 1;
			if (r.width < minW || r.height < minH) {
				setError(`Select a larger region (at least ${minW}×${minH}px)`);
				return;
			}
			setError(null);
			void window.electronAPI.regionPickerComplete({
				canceled: false,
				region: {
					x: r.x / vw,
					y: r.y / vh,
					width: r.width / vw,
					height: r.height / vh,
				},
			});
		},
		[minH, minW],
	);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				cancel();
			} else if (e.key === "Enter" && rect && rect.width >= minW && rect.height >= minH) {
				e.preventDefault();
				confirm(rect);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [cancel, confirm, minH, minW, rect]);

	const onPointerDown = (e: React.PointerEvent) => {
		if ((e.target as HTMLElement).closest("[data-region-picker-chrome]")) return;
		dragging.current = true;
		(e.target as HTMLElement).setPointerCapture?.(e.pointerId);
		setError(null);
		setDragStart({ x: e.clientX, y: e.clientY });
		setRect({ x: e.clientX, y: e.clientY, width: 0, height: 0 });
	};

	const onPointerMove = (e: React.PointerEvent) => {
		if (!dragging.current || !dragStart) return;
		const x = Math.min(dragStart.x, e.clientX);
		const y = Math.min(dragStart.y, e.clientY);
		const width = Math.abs(e.clientX - dragStart.x);
		const height = Math.abs(e.clientY - dragStart.y);
		setRect({ x, y, width, height });
	};

	const onPointerUp = () => {
		dragging.current = false;
	};

	const canConfirm = Boolean(rect && rect.width >= minW && rect.height >= minH);

	return (
		<div
			className="fixed inset-0 cursor-crosshair select-none"
			style={{ background: rect ? "transparent" : "rgba(0,0,0,0.45)" }}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
		>
			<div
				data-region-picker-chrome
				className="pointer-events-none absolute left-1/2 top-8 z-10 -translate-x-1/2 rounded-lg border border-white/15 bg-black/70 px-4 py-2 text-center text-xs text-white/90"
			>
				Drag to select a region · Enter to confirm · Esc to cancel
			</div>

			{rect && rect.width > 0 && rect.height > 0 && (
				<div
					className="pointer-events-none absolute border-2 border-[#34B27B] bg-transparent"
					style={{
						left: rect.x,
						top: rect.y,
						width: rect.width,
						height: rect.height,
						boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)",
					}}
				/>
			)}

			<div
				data-region-picker-chrome
				className="absolute bottom-8 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-2"
				onPointerDown={(e) => e.stopPropagation()}
			>
				{error && (
					<span className="rounded-md border border-red-400/30 bg-black/80 px-3 py-1 text-xs text-red-300">
						{error}
					</span>
				)}
				<div className="flex gap-2">
					<button
						type="button"
						onClick={cancel}
						className="rounded-lg border border-white/15 bg-black/70 px-4 py-2 text-xs text-white/80 hover:bg-black/90"
					>
						Cancel
					</button>
					<button
						type="button"
						disabled={!canConfirm}
						onClick={() => rect && confirm(rect)}
						className="rounded-lg bg-[#34B27B] px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
					>
						Record region
					</button>
				</div>
			</div>
		</div>
	);
}
