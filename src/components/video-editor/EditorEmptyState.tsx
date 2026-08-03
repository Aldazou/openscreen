import { AlertCircle, Clapperboard, Film, FolderOpen, History, Upload, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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
		const result = await window.electronAPI.openVideoFilePicker();
		if (result.canceled || !result.success || !result.path) return;
		await openVideoPath(result.path);
	}, [openVideoPath]);

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

	return (
		<div
			className="relative flex h-full w-full flex-col items-center justify-center bg-[#09090b]"
			onDragOver={handleDragOver}
			onDragLeave={handleDragLeave}
			onDrop={handleDrop}
		>
			{isDraggingOver && (
				<div className="pointer-events-none absolute inset-0 z-50 flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-[#34B27B] bg-[#34B27B]/10">
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

			<div className="relative flex w-full max-w-lg flex-col items-center gap-8 px-6 text-center">
				<img
					src="./openscreen.png"
					alt=""
					aria-hidden="true"
					className="h-16 w-16 rounded-2xl opacity-90"
				/>

				<div className="flex flex-col gap-2">
					<h2 className="text-xl font-semibold text-slate-200">{te("emptyState.title")}</h2>
					<p className="max-w-sm text-sm leading-relaxed text-slate-500">
						{te("emptyState.description")}
					</p>
				</div>

				<div className="flex w-full max-w-xs flex-col gap-3">
					<button
						type="button"
						onClick={() => void handleRecord()}
						className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-[#34B27B] px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-[#2d9e6c] active:bg-[#27885c] outline-none focus-visible:ring-2 focus-visible:ring-[#34B27B] focus-visible:ring-offset-2 focus-visible:ring-offset-[#09090b]"
					>
						<Clapperboard className="h-4 w-4" />
						{te("emptyState.recordButton")}
					</button>
					<button
						type="button"
						onClick={() => void handleImportVideo()}
						className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-slate-300 transition-colors hover:bg-white/10 outline-none focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-2 focus-visible:ring-offset-[#09090b]"
					>
						<Film className="h-4 w-4" />
						{te("emptyState.importVideoButton")}
					</button>
					<button
						type="button"
						onClick={() => void handleLoadProject()}
						className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-slate-300 transition-colors hover:bg-white/10 outline-none focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-2 focus-visible:ring-offset-[#09090b]"
					>
						<FolderOpen className="h-4 w-4" />
						{te("emptyState.loadProjectButton")}
					</button>
				</div>

				{(recentProjects.length > 0 || recentRecordings.length > 0) && (
					<div className="w-full space-y-4 text-left">
						{recentProjects.length > 0 && (
							<div>
								<div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
									<History className="h-3 w-3" />
									{te("emptyState.recentProjects")}
								</div>
								<ul className="space-y-1">
									{recentProjects.slice(0, 5).map((project) => (
										<li key={project.path}>
											<button
												type="button"
												onClick={() => void handleOpenRecentProject(project.path)}
												className="w-full truncate rounded-lg px-3 py-2 text-left text-xs text-slate-300 hover:bg-white/5"
												title={project.path}
											>
												{project.name}
											</button>
										</li>
									))}
								</ul>
							</div>
						)}
						{recentRecordings.length > 0 && (
							<div>
								<div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
									<Film className="h-3 w-3" />
									{te("emptyState.recentRecordings")}
								</div>
								<ul className="space-y-1">
									{recentRecordings.slice(0, 5).map((recording) => (
										<li key={recording.path}>
											<button
												type="button"
												onClick={() => void openVideoPath(recording.path)}
												className="w-full truncate rounded-lg px-3 py-2 text-left text-xs text-slate-300 hover:bg-white/5"
												title={recording.path}
											>
												{recording.name}
											</button>
										</li>
									))}
								</ul>
							</div>
						)}
					</div>
				)}

				<div className="flex flex-col items-center gap-2">
					<p className="text-xs text-slate-600">{te("emptyState.supportedFormats")}</p>
					<div className="mt-2 flex items-center gap-1.5 text-xs text-slate-700">
						<Upload className="h-3 w-3" />
						<span>{te("emptyState.dragDropHint")}</span>
					</div>
					<div className="mt-2">
						<GettingStartedGuide />
					</div>
				</div>
			</div>
		</div>
	);
}
