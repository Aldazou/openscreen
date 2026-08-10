import { Crop } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MdCheck } from "react-icons/md";
import { useScopedT } from "@/contexts/I18nContext";
import { selectScreenWithRegion } from "@/lib/captureRegionFlow";
import { loadUserPreferences, saveUserPreferences } from "@/lib/userPreferences";
import { Button } from "../ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import styles from "./SourceSelector.module.css";

interface DesktopSource {
	id: string;
	name: string;
	thumbnail: string | null;
	display_id: string;
	appIcon: string | null;
}

export function SourceSelector() {
	const t = useScopedT("launch");
	const tc = useScopedT("common");
	const initialTab = useMemo(() => {
		const tab = new URLSearchParams(window.location.search).get("tab");
		return tab === "windows" ? "windows" : "screens";
	}, []);
	const [activeTab, setActiveTab] = useState<"screens" | "windows">(initialTab);
	const [sources, setSources] = useState<DesktopSource[]>([]);
	const [selectedSource, setSelectedSource] = useState<DesktopSource | null>(null);
	const [loading, setLoading] = useState(true);
	const [loadFailed, setLoadFailed] = useState(false);

	const fetchSources = useCallback(async () => {
		setLoading(true);
		setLoadFailed(false);
		try {
			const rawSources = await window.electronAPI.getSources({
				types: ["screen", "window"],
				thumbnailSize: { width: 320, height: 180 },
				fetchWindowIcons: true,
			});
			const mapped = rawSources.map((source) => ({
				id: source.id,
				name:
					source.id.startsWith("window:") && source.name.includes(" — ")
						? source.name.split(" — ")[1] || source.name
						: source.name,
				thumbnail: source.thumbnail,
				display_id: source.display_id,
				appIcon: source.appIcon,
			}));
			setSources(mapped);
			setSelectedSource((current) => {
				if (current && mapped.some((source) => source.id === current.id)) {
					return current;
				}
				const remembered = loadUserPreferences().lastRecordingSource;
				if (!remembered) return null;
				const byId = mapped.find((source) => source.id === remembered.id);
				if (byId) return byId;
				// Window ids churn across launches; fall back to same-kind name match.
				return (
					mapped.find(
						(source) =>
							source.name === remembered.name &&
							source.id.split(":")[0] === remembered.id.split(":")[0],
					) ?? null
				);
			});
		} catch (error) {
			console.error("Error loading sources:", error);
			setSources([]);
			setSelectedSource(null);
			setLoadFailed(true);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void fetchSources();
	}, [fetchSources]);

	const screenSources = sources.filter((s) => s.id.startsWith("screen:"));
	const windowSources = sources.filter((s) => s.id.startsWith("window:"));
	const hasNoSources = !loading && sources.length === 0;

	const rememberSource = (source: DesktopSource) => {
		saveUserPreferences({
			lastRecordingSource: { id: source.id, name: source.name },
			lastCaptureMode: source.id.startsWith("window:") ? "window" : "screen",
		});
	};

	const handleSourceSelect = (source: DesktopSource) => {
		setSelectedSource(source);
		rememberSource(source);
	};
	const handleShare = async () => {
		if (!selectedSource) return;
		rememberSource(selectedSource);
		await window.electronAPI.selectSource(selectedSource);
	};
	const handleShareRegion = async () => {
		if (!selectedSource || !selectedSource.id.startsWith("screen:")) return;
		const result = await window.electronAPI.openRegionPicker(selectedSource.display_id);
		if (result.canceled || !result.region) return;
		await selectScreenWithRegion(selectedSource, result.region);
	};

	if (loading) {
		return (
			<div
				className={`h-full flex items-center justify-center ${styles.glassContainer}`}
				style={{ minHeight: "100vh" }}
			>
				<div className="text-center">
					<div className="animate-spin duration-500 rounded-[50%] h-6 w-6 border-2 border-b-transparent border-[#34B27B] mx-auto mb-2" />
					<p className="text-xs text-zinc-400">{t("sourceSelector.loading")}</p>
				</div>
			</div>
		);
	}

	if (hasNoSources) {
		return (
			<div
				className={`h-full flex items-center justify-center ${styles.glassContainer}`}
				style={{ minHeight: "100vh" }}
			>
				<div className="max-w-[320px] px-6 text-center">
					<h2 className="text-sm font-semibold text-white">{t("sourceSelector.emptyTitle")}</h2>
					<p className="mt-2 text-xs leading-5 text-zinc-400">
						{loadFailed
							? t("sourceSelector.loadFailedDescription")
							: t("sourceSelector.emptyDescription")}
					</p>
					<Button
						onClick={() => void fetchSources()}
						className="mt-4 h-8 rounded-lg bg-[#34B27B] px-5 text-[11px] font-semibold text-white transition-transform duration-150 hover:bg-[#34B27B]/85 active:scale-95"
					>
						{tc("actions.reload")}
					</Button>
				</div>
			</div>
		);
	}

	const renderSourceCard = (source: DesktopSource) => {
		const isSelected = selectedSource?.id === source.id;
		const sourceKind = source.id.startsWith("screen:") ? "screen" : "window";
		return (
			<div
				key={source.id}
				data-testid="source-selector-card"
				data-source-kind={sourceKind}
				className={`${styles.sourceCard} ${isSelected ? styles.selected : ""} p-1.5`}
				onClick={() => handleSourceSelect(source)}
			>
				<div className="relative mb-1.5 overflow-hidden rounded-lg border border-white/[0.06] bg-black/30">
					<img
						src={source.thumbnail || ""}
						alt={source.name}
						className="w-full aspect-video object-cover"
					/>
					{isSelected && (
						<div className="absolute right-1.5 top-1.5">
							<div className={styles.checkBadge}>
								<MdCheck size={11} className="text-white" />
							</div>
						</div>
					)}
				</div>
				<div className="flex items-center gap-1.5 px-1 pb-0.5">
					{source.appIcon && (
						<img src={source.appIcon} alt="" className={`${styles.icon} flex-shrink-0`} />
					)}
					<div className={`${styles.name} truncate`}>{source.name}</div>
				</div>
			</div>
		);
	};

	return (
		<div className={`min-h-screen flex flex-col ${styles.glassContainer}`}>
			<div className="flex-1 flex flex-col w-full px-3.5 pt-3.5">
				<Tabs
					value={screenSources.length === 0 ? "windows" : activeTab}
					onValueChange={(value) => {
						if (value === "screens" || value === "windows") {
							setActiveTab(value);
						}
					}}
					className="flex-1 flex flex-col"
				>
					<TabsList className="mb-3 grid h-8 grid-cols-2 rounded-xl border border-white/[0.06] bg-white/[0.04] p-0.5">
						<TabsTrigger
							value="screens"
							className="rounded-lg py-1 text-[11px] text-zinc-400 transition-all data-[state=active]:bg-white/[0.12] data-[state=active]:text-white"
						>
							{t("sourceSelector.screens", { count: String(screenSources.length) })}
						</TabsTrigger>
						<TabsTrigger
							value="windows"
							className="rounded-lg py-1 text-[11px] text-zinc-400 transition-all data-[state=active]:bg-white/[0.12] data-[state=active]:text-white"
						>
							{t("sourceSelector.windows", { count: String(windowSources.length) })}
						</TabsTrigger>
					</TabsList>
					<div className="flex-1 min-h-0">
						<TabsContent value="screens" className="h-full mt-0">
							<div
								className={`grid h-[282px] auto-rows-min grid-cols-2 gap-2.5 overflow-y-auto pr-1.5 pt-1 ${styles.sourceGridScroll}`}
							>
								{screenSources.map(renderSourceCard)}
							</div>
						</TabsContent>
						<TabsContent value="windows" className="h-full mt-0">
							<div
								className={`grid h-[282px] auto-rows-min grid-cols-2 gap-2.5 overflow-y-auto pr-1.5 pt-1 ${styles.sourceGridScroll}`}
							>
								{windowSources.map(renderSourceCard)}
							</div>
						</TabsContent>
					</div>
				</Tabs>
			</div>
			<div className="flex justify-center gap-2 border-t border-white/[0.06] p-3">
				<Button
					data-testid="source-selector-cancel-button"
					variant="ghost"
					onClick={() => window.close()}
					className="h-8 rounded-lg px-5 text-[11px] text-zinc-400 transition-transform duration-150 hover:bg-white/5 hover:text-white active:scale-95"
				>
					{tc("actions.cancel")}
				</Button>
				<Button
					data-testid="source-selector-region-button"
					variant="ghost"
					onClick={() => void handleShareRegion()}
					disabled={!selectedSource?.id.startsWith("screen:")}
					className="h-8 gap-1.5 rounded-lg border border-[#34B27B]/50 bg-[#34B27B]/10 px-4 text-[11px] font-semibold text-[#34B27B] transition-transform duration-150 hover:bg-[#34B27B]/20 hover:text-[#4ade80] active:scale-95 disabled:opacity-30"
				>
					<Crop className="h-3.5 w-3.5" />
					{t("sourceSelector.recordRegion")}
				</Button>
				<Button
					data-testid="source-selector-share-button"
					onClick={handleShare}
					disabled={!selectedSource}
					className="h-8 rounded-lg bg-[#34B27B] px-5 text-[11px] font-semibold text-white transition-transform duration-150 hover:bg-[#34B27B]/85 active:scale-95 disabled:bg-zinc-700 disabled:opacity-30"
				>
					{tc("actions.share")}
				</Button>
			</div>
		</div>
	);
}
