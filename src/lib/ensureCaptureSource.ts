import { loadUserPreferences, saveUserPreferences } from "@/lib/userPreferences";

export type EnsureCaptureResult =
	| { ok: true; source: ProcessedDesktopSource }
	| {
			ok: false;
			reason: "no-api" | "permission" | "no-sources" | "error";
			message?: string;
	  };

function matchRememberedScreen(
	sources: ProcessedDesktopSource[],
	remembered: { id: string; name: string } | null,
): ProcessedDesktopSource | undefined {
	if (!remembered) return undefined;
	const byId = sources.find((source) => source.id === remembered.id);
	if (byId) return byId;
	return sources.find(
		(source) => source.name === remembered.name && source.id.startsWith("screen:"),
	);
}

/**
 * Ensures a screen capture source is selected so Record can start.
 * Restores the remembered screen when possible, otherwise the first screen.
 */
export async function ensureScreenCaptureSource(): Promise<EnsureCaptureResult> {
	if (!window.electronAPI) return { ok: false, reason: "no-api" };

	const access = await window.electronAPI.requestScreenAccess();
	if (!access.granted && access.status !== "not-determined") {
		return { ok: false, reason: "permission" };
	}

	let sources: ProcessedDesktopSource[];
	try {
		sources = await window.electronAPI.getSources({
			types: ["screen"],
			thumbnailSize: { width: 0, height: 0 },
		});
	} catch (error) {
		return {
			ok: false,
			reason: "error",
			message: error instanceof Error ? error.message : String(error),
		};
	}

	if (sources.length === 0) {
		// Empty list usually means Screen Recording is denied/not yet effective.
		const status = await window.electronAPI.requestScreenAccess();
		if (!status.granted) return { ok: false, reason: "permission" };
		return { ok: false, reason: "no-sources" };
	}

	const remembered = loadUserPreferences().lastRecordingSource;
	const screen =
		matchRememberedScreen(sources, remembered) ??
		sources.find((source) => source.id.startsWith("screen:")) ??
		sources[0];

	await window.electronAPI.selectSource(screen);
	saveUserPreferences({
		lastRecordingSource: { id: screen.id, name: screen.name },
	});

	return { ok: true, source: screen };
}
