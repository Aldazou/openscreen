import {
	AlertCircle,
	Clapperboard,
	Crop,
	Film,
	FolderOpen,
	History,
	Upload,
	X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useScopedT } from "@/contexts/I18nContext";
import { isVideoFileName, type RecentRecordingEntry } from "@/lib/recentItems";
import {
	getProjectFolder,
	loadUserPreferences,
	parentDirectoryOf,
	rememberRecentProject,
	saveUserPreferences,
} from "@/lib/userPreferences";
import { nativeBridgeClient } from "@/native";
import styles from "./EditorEmptyState.module.css";
import { GettingStartedGuide } from "./GettingStartedGuide";

interface EditorEmptyStateProps {
	onVideoImported: (videoPath: string) => void;
	/** Called with the loaded project data; handles both button click and drag-drop */
	onProjectOpened: (project: unknown, path: string | null) => void;
}

type DropError = "unsupported-format" | "load-failed" | null;

export function EditorEmptyState({ onVideoImported, onProjectOpened }: EditorEmptyStateProps) {
	const te = useScopedT("editor");
	const tc = useScopedT("common");
	const [isDraggingOver, setIsDraggingOver] = useState(false);
	const [dropError, setDropError] = useState<DropError>(null);
	const [recentProjects, setRecentProjects] = useState(() => loadUserPreferences().recentProjects);
	const [recentRecordings, setRecentRecordings] = useState<RecentRecordingEntry[]>([]);
	// Freeze the last non-null error type so dialog content doesn't snap to the else-branch
	// during the closing animation (same pattern as UnsavedChangesDialog).
	const lastDropErrorRef = useRef<Exclude<DropError, null>>("unsupported-format");
	if (dropError !== null) {
		lastDropErrorRef.current = dropError;
	}

	useEffect(() => {
		void (async () => {
			if (!window.electronAPI?.listRecentRecordings) return;
			const result = await window.electronAPI.listRecentRecordings();
			if (result.success && result.recordings) {
				setRecentRecordings(result.recordings);
			}
		})();
	}, []);

	const openVideoPath = useCallback(
		async (videoPath: string) => {
			const setResult = await nativeBridgeClient.project.setCurrentVideoPath(videoPath);
			if (!setResult.success) {
				setDropError("load-failed");
				return;
			}
			onVideoImported(videoPath);
		},
		[onVideoImported],
	);

	const handleImportVideo = useCallback(async () => {
		try {
			const result = await window.electronAPI.openVideoFilePicker();
			if (result.canceled) return;
			if (!result.success || !result.path) {
				toast.error(te("emptyState.dropErrors.couldNotOpenMessage"));
				return;
			}
			await openVideoPath(result.path);
		} catch (error) {
			console.error("Import video failed:", error);
			toast.error(te("emptyState.dropErrors.couldNotOpenMessage"));
		}
	}, [openVideoPath, te]);

	const handleLoadProject = useCallback(async () => {
		const result = await nativeBridgeClient.project.loadProjectFile(getProjectFolder());
		if (result.canceled || !result.success || !result.project) return;
		if (result.path) {
			const folder = parentDirectoryOf(result.path);
			if (folder) {
				saveUserPreferences({ projectFolder: folder });
			}
			rememberRecentProject(result.path);
			setRecentProjects(loadUserPreferences().recentProjects);
		}
		onProjectOpened(result.project, result.path ?? null);
	}, [onProjectOpened]);

	const handleOpenRecentProject = useCallback(
		async (filePath: string) => {
			const result = await window.electronAPI.loadProjectFileFromPath(filePath);
			if (!result.success || !result.project) {
				setDropError("load-failed");
				return;
			}
			rememberRecentProject(filePath);
			setRecentProjects(loadUserPreferences().recentProjects);
			onProjectOpened(result.project, result.path ?? filePath);
		},
		[onProjectOpened],
	);

	const handleRecord = useCallback(async () => {
		saveUserPreferences({ pendingRegionPick: false });
		await window.electronAPI.startNewRecording();
	}, []);

	const handleRecordRegion = useCallback(async () => {
		saveUserPreferences({ lastCaptureMode: "region", pendingRegionPick: true });
		await window.electronAPI.startNewRecording();
	}, []);

	const handleDragOver = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		if (e.dataTransfer.items.length > 0) {
			setIsDraggingOver(true);
		}
	}, []);

	const handleDragLeave = useCallback((e: React.DragEvent) => {
		if (!e.currentTarget.contains(e.relatedTarget as Node)) {
			setIsDraggingOver(false);
		}
	}, []);

	const handleDrop = useCallback(
		async (e: React.DragEvent) => {
			e.preventDefault();
			setIsDraggingOver(false);

			const files = Array.from(e.dataTransfer.files);
			if (files.length === 0) return;

			const projectFile = files.find((f) => f.name.endsWith(".openscreen"));
			const videoFile = files.find((f) => isVideoFileName(f.name));

			const file = projectFile ?? videoFile;
			if (!file) {
				setDropError("unsupported-format");
				return;
			}

			let filePath: string;
			try {
				filePath = window.electronAPI.getPathForFile(file);
			} catch {
				setDropError("load-failed");
				return;
			}
			if (!filePath) {
				setDropError("load-failed");
				return;
			}

			if (projectFile) {
				let result: Awaited<ReturnType<typeof window.electronAPI.loadProjectFileFromPath>>;
				try {
					result = await window.electronAPI.loadProjectFileFromPath(filePath);
				} catch {
					setDropError("load-failed");
					return;
				}
				if (!result.success || !result.project) {
					setDropError("load-failed");
					return;
				}
				rememberRecentProject(filePath);
				setRecentProjects(loadUserPreferences().recentProjects);
				onProjectOpened(result.project, result.path ?? null);
				return;
			}

			await openVideoPath(filePath);
		},
		[onProjectOpened, openVideoPath],
	);

	const recentItems = [
		...recentProjects.slice(0, 5).map((project) => ({
			key: `project:${project.path}`,
			label: project.name,
			path: project.path,
			kind: "project" as const,
		})),
		...recentRecordings.slice(0, 5).map((recording) => ({
			key: `recording:${recording.path}`,
			label: recording.name,
			path: recording.path,
			kind: "recording" as const,
		})),
	].slice(0, 8);

	return (
		<div
			className={`relative flex h-full w-full flex-col ${styles.home}`}
			onDragOver={handleDragOver}
			onDragLeave={handleDragLeave}
			onDrop={handleDrop}
		>
			{isDraggingOver && (
				<div className="pointer-events-none absolute inset-0 z-50 flex flex-col items-center justify-center border-2 border-dashed border-[#34B27B] bg-[#34B27B]/10">
					<Upload className="mb-3 h-10 w-10 text-[#34B27B]" />
					<p className="text-base font-semibold text-[#34B27B]">{te("emptyState.dropOverlay")}</p>
				</div>
			)}

			<Dialog open={dropError !== null} onOpenChange={(open) => !open && setDropError(null)}>
				<DialogContent className="bg-[#09090b] border-white/10 rounded-2xl max-w-sm p-6 gap-0">
					<DialogHeader className="mb-4">
						<div className="flex items-center gap-3">
							<img
								src="./openscreen.png"
								alt=""
								aria-hidden="true"
								className="w-9 h-9 rounded-xl flex-shrink-0"
							/>
							<DialogTitle className="text-base font-semibold text-slate-200 leading-tight">
								{lastDropErrorRef.current === "unsupported-format"
									? te("emptyState.dropErrors.unsupportedFormatTitle")
									: te("emptyState.dropErrors.couldNotOpenTitle")}
							</DialogTitle>
						</div>
					</DialogHeader>

					<div className="flex flex-col items-center gap-3 mb-6 text-center">
						<div className="flex items-center justify-center w-10 h-10 rounded-full bg-white/5 ring-1 ring-white/10">
							<AlertCircle className="w-5 h-5 text-slate-400 flex-shrink-0" />
						</div>
						<p className="text-sm text-slate-400 leading-relaxed">
							{lastDropErrorRef.current === "unsupported-format"
								? te("emptyState.dropErrors.unsupportedFormatMessage")
								: te("emptyState.dropErrors.couldNotOpenMessage")}
						</p>
					</div>

					<button
						type="button"
						onClick={() => setDropError(null)}
						className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 font-medium text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-2 focus-visible:ring-offset-[#09090b]"
					>
						<X className="w-4 h-4" />
						{tc("actions.close")}
					</button>
				</DialogContent>
			</Dialog>

			{/* First viewport: brand + one headline + CTAs */}
			<section className="relative z-10 flex min-h-full w-full flex-col items-center px-6 pb-16 pt-[18vh]">
				<div className={`flex w-full max-w-md flex-col items-center text-center ${styles.hero}`}>
					<img
						src="./openscreen.png"
						alt="OpenScreen"
						className="mb-5 h-20 w-20 rounded-[1.35rem] shadow-[0_18px_40px_rgba(0,0,0,0.35)]"
					/>
					<p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#34B27B]/90">
						OpenScreen
					</p>
					<h1 className="text-[1.75rem] font-semibold tracking-tight text-white">
						{te("emptyState.title")}
					</h1>
					<p className="mt-2 max-w-sm text-sm leading-relaxed text-zinc-400">
						{te("emptyState.description")}
					</p>
				</div>

				<div className={`mt-8 flex w-full max-w-sm flex-col gap-2.5 ${styles.ctaRow}`}>
					<button
						type="button"
						onClick={() => void handleRecord()}
						className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-[#34B27B] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#2d9e6c] active:bg-[#27885c] outline-none focus-visible:ring-2 focus-visible:ring-[#34B27B] focus-visible:ring-offset-2 focus-visible:ring-offset-[#09090b]"
					>
						<Clapperboard className="h-4 w-4" />
						{te("emptyState.recordButton")}
					</button>
					<div className="grid grid-cols-2 gap-2.5">
						<button
							type="button"
							onClick={() => void handleRecordRegion()}
							className="flex items-center justify-center gap-2 rounded-xl border border-[#34B27B]/35 bg-[#34B27B]/10 px-3 py-2.5 text-sm font-medium text-[#34B27B] transition-colors hover:bg-[#34B27B]/18 outline-none focus-visible:ring-2 focus-visible:ring-[#34B27B]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#09090b]"
						>
							<Crop className="h-4 w-4" />
							{te("emptyState.recordRegionButton")}
						</button>
						<button
							type="button"
							onClick={() => void handleImportVideo()}
							className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/[0.08] outline-none focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-2 focus-visible:ring-offset-[#09090b]"
						>
							<Film className="h-4 w-4" />
							{te("emptyState.importVideoButton")}
						</button>
					</div>
					<button
						type="button"
						onClick={() => void handleLoadProject()}
						className="flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-zinc-500 transition-colors hover:bg-white/[0.04] hover:text-zinc-300"
					>
						<FolderOpen className="h-3.5 w-3.5" />
						{te("emptyState.loadProjectButton")}
					</button>
				</div>

				{recentItems.length > 0 && (
					<div className={`mt-10 w-full max-w-md text-left ${styles.recents}`}>
						<div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
							<History className="h-3 w-3" />
							{te("emptyState.recentLabel")}
						</div>
						<ul className="divide-y divide-white/[0.05] border-y border-white/[0.05]">
							{recentItems.map((item) => (
								<li key={item.key}>
									<button
										type="button"
										onClick={() =>
											void (item.kind === "project"
												? handleOpenRecentProject(item.path)
												: openVideoPath(item.path))
										}
										className="flex w-full items-center justify-between gap-3 px-1 py-2.5 text-left text-sm text-zinc-300 transition-colors hover:text-white"
										title={item.path}
									>
										<span className="truncate">{item.label}</span>
										<span className="shrink-0 text-[10px] uppercase tracking-wide text-zinc-600">
											{item.kind === "project"
												? te("emptyState.recentProjectKind")
												: te("emptyState.recentRecordingKind")}
										</span>
									</button>
								</li>
							))}
						</ul>
					</div>
				)}
			</section>

			{/* Below the fold: drag-drop + getting started */}
			<section className="relative z-10 flex w-full flex-col items-center gap-3 border-t border-white/[0.04] px-6 py-10 text-center">
				<p className="text-xs text-zinc-600">{te("emptyState.supportedFormats")}</p>
				<div className="flex items-center gap-1.5 text-xs text-zinc-600">
					<Upload className="h-3 w-3" />
					<span>{te("emptyState.dragDropHint")}</span>
				</div>
				<div className="mt-2">
					<GettingStartedGuide />
				</div>
			</section>
		</div>
	);
}
