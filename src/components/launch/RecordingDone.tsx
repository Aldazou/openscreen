import { Clapperboard, Crop, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { MdBookmark } from "react-icons/md";
import { useScopedT } from "@/contexts/I18nContext";
import styles from "./SourceSelector.module.css";

type DonePayload = {
	path: string;
	markCount: number;
	hasRegion: boolean;
};

/** Post-record handoff: open Studio or start another capture. */
export function RecordingDone() {
	const t = useScopedT("launch");
	const [payload, setPayload] = useState<DonePayload | null>(null);
	const [busy, setBusy] = useState<"continue" | "rerecord" | null>(null);

	useEffect(() => {
		void (async () => {
			if (!window.electronAPI?.getRecordingDonePayload) return;
			const result = await window.electronAPI.getRecordingDonePayload();
			if (result.success && result.payload) {
				setPayload(result.payload);
			}
		})();
	}, []);

	const handleContinue = async () => {
		if (busy) return;
		setBusy("continue");
		try {
			await window.electronAPI.recordingDoneContinue();
		} finally {
			setBusy(null);
		}
	};

	const handleRerecord = async () => {
		if (busy) return;
		setBusy("rerecord");
		try {
			await window.electronAPI.recordingDoneRerecord();
		} finally {
			setBusy(null);
		}
	};

	const fileName = payload?.path ? (payload.path.split(/[/\\]/).filter(Boolean).at(-1) ?? "") : "";

	return (
		<div className={`flex h-full min-h-screen flex-col ${styles.glassContainer}`}>
			<div className="flex flex-1 flex-col items-center justify-center gap-5 px-8 py-7 text-center">
				<img
					src="./openscreen.png"
					alt=""
					aria-hidden="true"
					className="h-12 w-12 rounded-2xl opacity-95"
				/>
				<div className="flex flex-col gap-1.5">
					<h1 className="text-lg font-semibold tracking-tight text-white">
						{t("recordingDone.title")}
					</h1>
					<p className="max-w-[320px] text-xs leading-relaxed text-zinc-400">
						{t("recordingDone.description")}
					</p>
					{fileName ? (
						<p className="mt-1 truncate text-[11px] text-zinc-500" title={payload?.path}>
							{fileName}
						</p>
					) : null}
				</div>

				{(payload?.markCount || payload?.hasRegion) && (
					<div className="flex flex-wrap items-center justify-center gap-2">
						{payload.markCount > 0 && (
							<span className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-zinc-300">
								<MdBookmark size={12} className="text-[#34B27B]" />
								{t("recordingDone.marksChip", { count: String(payload.markCount) })}
							</span>
						)}
						{payload.hasRegion && (
							<span className="inline-flex items-center gap-1 rounded-lg border border-[#34B27B]/30 bg-[#34B27B]/10 px-2.5 py-1 text-[11px] font-medium text-[#34B27B]">
								<Crop className="h-3 w-3" />
								{t("recordingDone.regionChip")}
							</span>
						)}
					</div>
				)}

				<div className="mt-1 flex w-full max-w-[280px] flex-col gap-2">
					<button
						type="button"
						data-testid="recording-done-continue"
						onClick={() => void handleContinue()}
						disabled={busy !== null}
						className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#34B27B] px-4 py-2.5 text-sm font-semibold text-white transition-transform duration-150 hover:bg-[#34B27B]/85 active:scale-[0.98] disabled:opacity-50"
					>
						<Clapperboard className="h-4 w-4" />
						{t("recordingDone.openStudio")}
					</button>
					<button
						type="button"
						data-testid="recording-done-rerecord"
						onClick={() => void handleRerecord()}
						disabled={busy !== null}
						className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-zinc-300 transition-colors duration-150 hover:bg-white/[0.08] hover:text-white disabled:opacity-50"
					>
						<RotateCcw className="h-4 w-4" />
						{t("recordingDone.recordAgain")}
					</button>
				</div>
			</div>
		</div>
	);
}
