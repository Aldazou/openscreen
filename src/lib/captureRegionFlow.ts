import { ensureScreenCaptureSource } from "@/lib/ensureCaptureSource";
import { saveUserPreferences } from "@/lib/userPreferences";

type CaptureRegion = { x: number; y: number; width: number; height: number };

export type PickRegionResult =
	| { ok: true }
	| {
			ok: false;
			reason: "canceled" | "permission" | "no-sources" | "error" | "no-api";
			message?: string;
	  };

/** Select a screen source with a capture region and remember it for the next HUD session. */
export async function selectScreenWithRegion(
	screen: ProcessedDesktopSource,
	region: CaptureRegion,
): Promise<void> {
	await window.electronAPI.selectSource({
		...screen,
		captureRegion: region,
	});
	saveUserPreferences({
		lastRecordingSource: { id: screen.id, name: screen.name },
		lastCaptureMode: "region",
	});
}

/**
 * Opens the region picker on a remembered/first screen, then selects that source
 * with the chosen capture region.
 */
export async function pickScreenRegionAndSelect(): Promise<PickRegionResult> {
	if (!window.electronAPI) return { ok: false, reason: "no-api" };

	const ensured = await ensureScreenCaptureSource();
	if (!ensured.ok) {
		return {
			ok: false,
			reason: ensured.reason === "error" ? "error" : ensured.reason,
			message: ensured.message,
		};
	}

	const result = await window.electronAPI.openRegionPicker(ensured.source.display_id);
	if (result.canceled || !result.region) return { ok: false, reason: "canceled" };

	await selectScreenWithRegion(ensured.source, result.region);
	return { ok: true };
}
