import type { BrowserWindow } from "electron";
import { ipcMain } from "electron";
import type { AiProviderId, DirectorTurnRequest } from "../../src/lib/ai/types";
import { AI_PROVIDERS } from "../../src/lib/ai/types";
import { runDirectorTurn } from "../ai/director";
import { listVoices } from "../ai/elevenlabs";
import { listAvatars, listHeyGenVoices } from "../ai/heygen";
import {
	cancelJob,
	enqueueCreatePhotoAvatarJob,
	enqueueGenerateAvatarJob,
	enqueueGenerateImageJob,
	enqueueGenerateMusicJob,
	enqueueGenerateTtsJob,
	enqueueGenerateVideoJob,
	enqueueImportJob,
	getJob,
	listJobs,
} from "../ai/jobRunner";
import {
	deleteAsset,
	getMediaRoot,
	importFileToLibrary,
	isUnderMediaRoot,
	listAssets,
	openImportFilePicker,
	openPhotoAvatarPicker,
} from "../ai/mediaLibrary";
import { clearApiKey, getAllApiKeyStatuses, getApiKeyStatus, setApiKey } from "../ai/vault";

export interface AiIpcContext {
	getWindows: () => Array<BrowserWindow | null>;
	approveFilePath: (filePath: string) => void;
	addAllowedReadDir: (dirPath: string) => void;
}

function isProvider(value: unknown): value is AiProviderId {
	return typeof value === "string" && (AI_PROVIDERS as readonly string[]).includes(value);
}

export function registerAiIpcHandlers(context: AiIpcContext): void {
	// Allow reads from the media library root.
	context.addAllowedReadDir(getMediaRoot());

	ipcMain.handle("ai-set-api-key", (_event, provider: unknown, key: unknown) => {
		if (!isProvider(provider) || typeof key !== "string") {
			return { success: false, error: "Invalid arguments" };
		}
		return setApiKey(provider, key);
	});

	ipcMain.handle("ai-clear-api-key", (_event, provider: unknown) => {
		if (!isProvider(provider)) {
			return { success: false, error: "Invalid provider" };
		}
		return clearApiKey(provider);
	});

	ipcMain.handle("ai-get-api-key-status", (_event, provider: unknown) => {
		if (!isProvider(provider)) {
			return { success: false, error: "Invalid provider" };
		}
		return { success: true, status: getApiKeyStatus(provider) };
	});

	ipcMain.handle("ai-get-all-api-key-statuses", () => {
		return { success: true, statuses: getAllApiKeyStatuses() };
	});

	ipcMain.handle("ai-list-assets", async (_event, projectId: unknown) => {
		if (typeof projectId !== "string" || !projectId.trim()) {
			return { success: false, error: "projectId required", assets: [] };
		}
		const assets = await listAssets(projectId.trim());
		for (const asset of assets) {
			context.approveFilePath(asset.path);
		}
		return { success: true, assets };
	});

	ipcMain.handle("ai-open-import-picker", async () => {
		return openImportFilePicker();
	});

	ipcMain.handle(
		"ai-import-file",
		async (
			_event,
			payload: {
				projectId?: string;
				sourcePath?: string;
				prompt?: string;
			},
		) => {
			if (!payload?.projectId || !payload?.sourcePath) {
				return { success: false, error: "projectId and sourcePath required" };
			}
			const result = await importFileToLibrary({
				projectId: payload.projectId,
				sourcePath: payload.sourcePath,
				prompt: payload.prompt,
			});
			if (result.asset) {
				context.approveFilePath(result.asset.path);
			}
			return result;
		},
	);

	ipcMain.handle(
		"ai-delete-asset",
		async (_event, payload: { projectId?: string; assetId?: string }) => {
			if (!payload?.projectId || !payload?.assetId) {
				return { success: false, error: "projectId and assetId required" };
			}
			return deleteAsset(payload.projectId, payload.assetId);
		},
	);

	ipcMain.handle(
		"ai-enqueue-import-job",
		async (
			_event,
			payload: {
				kind?: "import-file" | "import-url";
				projectId?: string;
				sourcePath?: string;
				url?: string;
				prompt?: string;
			},
		) => {
			if (!payload?.projectId || !payload?.kind) {
				return { success: false, error: "projectId and kind required" };
			}
			const result = await enqueueImportJob(
				{
					kind: payload.kind,
					projectId: payload.projectId,
					sourcePath: payload.sourcePath,
					url: payload.url,
					prompt: payload.prompt,
				},
				context.getWindows,
			);
			if (result.asset) {
				context.approveFilePath(result.asset.path);
			}
			return result;
		},
	);

	ipcMain.handle("ai-list-jobs", () => {
		return { success: true, jobs: listJobs() };
	});

	ipcMain.handle("ai-get-job", (_event, jobId: unknown) => {
		if (typeof jobId !== "string") {
			return { success: false, error: "jobId required" };
		}
		const job = getJob(jobId);
		return job ? { success: true, job } : { success: false, error: "Not found" };
	});

	ipcMain.handle("ai-cancel-job", (_event, jobId: unknown) => {
		if (typeof jobId !== "string") {
			return { success: false, error: "jobId required" };
		}
		return cancelJob(jobId);
	});

	ipcMain.handle("ai-is-media-path", (_event, filePath: unknown) => {
		if (typeof filePath !== "string") return { success: false, allowed: false };
		return { success: true, allowed: isUnderMediaRoot(filePath) };
	});

	ipcMain.handle("ai-list-voices", async () => {
		try {
			const voices = await listVoices();
			return { success: true, voices };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
				voices: [],
			};
		}
	});

	ipcMain.handle(
		"ai-generate-tts",
		async (_event, payload: { projectId?: string; text?: string; voiceId?: string }) => {
			if (!payload?.projectId || !payload?.text) {
				return { success: false, error: "projectId and text required" };
			}
			const result = await enqueueGenerateTtsJob(
				{
					projectId: payload.projectId,
					text: payload.text,
					voiceId: payload.voiceId,
				},
				context.getWindows,
			);
			if (result.asset) context.approveFilePath(result.asset.path);
			return result;
		},
	);

	ipcMain.handle(
		"ai-generate-music",
		async (_event, payload: { projectId?: string; prompt?: string; lengthMs?: number }) => {
			if (!payload?.projectId || !payload?.prompt) {
				return { success: false, error: "projectId and prompt required" };
			}
			const result = await enqueueGenerateMusicJob(
				{
					projectId: payload.projectId,
					prompt: payload.prompt,
					lengthMs: payload.lengthMs,
				},
				context.getWindows,
			);
			if (result.asset) context.approveFilePath(result.asset.path);
			return result;
		},
	);

	ipcMain.handle(
		"ai-generate-image",
		async (_event, payload: { projectId?: string; prompt?: string }) => {
			if (!payload?.projectId || !payload?.prompt) {
				return { success: false, error: "projectId and prompt required" };
			}
			const result = await enqueueGenerateImageJob(
				{ projectId: payload.projectId, prompt: payload.prompt },
				context.getWindows,
			);
			if (result.asset) context.approveFilePath(result.asset.path);
			return result;
		},
	);

	ipcMain.handle(
		"ai-generate-video",
		async (_event, payload: { projectId?: string; prompt?: string; durationSec?: 5 | 10 }) => {
			if (!payload?.projectId || !payload?.prompt) {
				return { success: false, error: "projectId and prompt required" };
			}
			const result = await enqueueGenerateVideoJob(
				{
					projectId: payload.projectId,
					prompt: payload.prompt,
					durationSec: payload.durationSec,
				},
				context.getWindows,
			);
			if (result.asset) context.approveFilePath(result.asset.path);
			return result;
		},
	);

	ipcMain.handle("ai-list-avatars", async () => {
		try {
			const avatars = await listAvatars();
			return { success: true, avatars };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
				avatars: [],
			};
		}
	});

	ipcMain.handle("ai-list-heygen-voices", async () => {
		try {
			const voices = await listHeyGenVoices();
			return { success: true, voices };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
				voices: [],
			};
		}
	});

	ipcMain.handle("ai-open-photo-avatar-picker", async () => {
		return openPhotoAvatarPicker();
	});

	ipcMain.handle(
		"ai-create-photo-avatar",
		async (_event, payload: { imagePath?: string; name?: string }) => {
			if (!payload?.imagePath) {
				return { success: false, error: "imagePath required" };
			}
			return enqueueCreatePhotoAvatarJob(
				{ imagePath: payload.imagePath, name: payload.name },
				context.getWindows,
			);
		},
	);

	ipcMain.handle(
		"ai-generate-avatar",
		async (
			_event,
			payload: {
				projectId?: string;
				script?: string;
				avatarId?: string;
				talkingPhotoId?: string;
				voiceId?: string;
				photoPath?: string;
			},
		) => {
			if (!payload?.projectId || !payload?.script) {
				return { success: false, error: "projectId and script required" };
			}
			const result = await enqueueGenerateAvatarJob(
				{
					projectId: payload.projectId,
					script: payload.script,
					avatarId: payload.avatarId,
					talkingPhotoId: payload.talkingPhotoId,
					voiceId: payload.voiceId,
					photoPath: payload.photoPath,
				},
				context.getWindows,
			);
			if (result.asset) context.approveFilePath(result.asset.path);
			return result;
		},
	);

	ipcMain.handle("ai-director-turn", async (_event, payload: unknown) => {
		const request = payload as DirectorTurnRequest | null;
		if (!request || !Array.isArray(request.messages)) {
			return { success: false, error: "messages required" };
		}
		try {
			return await runDirectorTurn(request);
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	});
}
