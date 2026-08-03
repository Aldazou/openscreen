import fs from "node:fs/promises";
import path from "node:path";
import type { BrowserWindow } from "electron";

/** Whether the native OS share sheet is available (macOS / Windows). */
export async function canShareExportedFile(): Promise<boolean> {
	try {
		const { canShare } = await import("electron-native-share");
		return canShare();
	} catch {
		return false;
	}
}

/**
 * Present the native share sheet for an exported file.
 * Falls back with `available: false` on Linux or when the native addon is missing.
 */
export async function shareExportedFile(
	filePath: string,
	parentWindow: BrowserWindow | null,
): Promise<{ success: boolean; cancelled?: boolean; available?: boolean; error?: string }> {
	const resolved = path.resolve(filePath);
	try {
		await fs.access(resolved);
	} catch {
		return { success: false, error: "File not found" };
	}

	try {
		const { canShare, share } = await import("electron-native-share");
		if (!canShare()) {
			return {
				success: false,
				available: false,
				error: "Sharing is not available on this platform",
			};
		}
		const result = await share(
			{ files: [resolved], title: path.basename(resolved) },
			parentWindow ?? undefined,
		);
		return { success: true, cancelled: result.method === "cancelled" };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (/not available|unsupported|cannot find module/i.test(message)) {
			return { success: false, available: false, error: message };
		}
		return { success: false, error: message };
	}
}
