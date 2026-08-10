import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { BrowserWindow } from "electron";

const require = createRequire(import.meta.url);

type NativeShareModule = {
	canShare: () => boolean;
	share: (
		options: { title?: string; files?: string[] },
		browserWindow?: BrowserWindow,
	) => Promise<{ method: "native" | "cancelled" }>;
};

function loadNativeShare(): NativeShareModule | null {
	try {
		return require("electron-native-share") as NativeShareModule;
	} catch {
		return null;
	}
}

/** Whether the native OS share sheet is available (macOS / Windows). */
export async function canShareExportedFile(): Promise<boolean> {
	const mod = loadNativeShare();
	return Boolean(mod?.canShare());
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

	const mod = loadNativeShare();
	if (!mod?.canShare()) {
		return {
			success: false,
			available: false,
			error: "Sharing is not available on this platform",
		};
	}

	try {
		const result = await mod.share(
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
