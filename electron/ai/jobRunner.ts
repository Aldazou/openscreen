import type { BrowserWindow } from "electron";
import { type AiJob, type AiJobKind, createId, type MediaAsset } from "../../src/lib/ai/types";
import { generateMusic, generateSpeech } from "./elevenlabs";
import { generateImage, generateVideo } from "./fal";
import { createPhotoAvatarFromImage, generateAvatarVideo } from "./heygen";
import { importBytesToLibrary, importFileToLibrary, importUrlToLibrary } from "./mediaLibrary";

const jobs = new Map<string, AiJob>();
const cancelled = new Set<string>();

type JobProgressPayload = {
	job: AiJob;
};

function getTargetWindows(getWindows: () => Array<BrowserWindow | null>): BrowserWindow[] {
	return getWindows().filter((w): w is BrowserWindow => Boolean(w && !w.isDestroyed()));
}

function emitProgress(getWindows: () => Array<BrowserWindow | null>, job: AiJob) {
	const payload: JobProgressPayload = { job };
	for (const win of getTargetWindows(getWindows)) {
		win.webContents.send("ai-job-progress", payload);
	}
}

function updateJob(
	job: AiJob,
	patch: Partial<AiJob>,
	getWindows: () => Array<BrowserWindow | null>,
): AiJob {
	const next: AiJob = { ...job, ...patch, updatedAt: Date.now() };
	jobs.set(next.id, next);
	emitProgress(getWindows, next);
	return next;
}

function isCancelled(jobId: string): boolean {
	return cancelled.has(jobId);
}

export function listJobs(): AiJob[] {
	return [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export function getJob(jobId: string): AiJob | null {
	return jobs.get(jobId) ?? null;
}

export function cancelJob(jobId: string): { success: boolean; error?: string } {
	const job = jobs.get(jobId);
	if (!job) return { success: false, error: "Job not found" };
	if (job.status === "done" || job.status === "failed" || job.status === "cancelled") {
		return { success: true };
	}
	cancelled.add(jobId);
	jobs.set(jobId, {
		...job,
		status: "cancelled",
		message: "Cancelled",
		updatedAt: Date.now(),
	});
	return { success: true };
}

function createJob(kind: AiJobKind, getWindows: () => Array<BrowserWindow | null>): AiJob {
	const job: AiJob = {
		id: createId("job"),
		kind,
		status: "queued",
		progress: 0,
		message: "Queued",
		createdAt: Date.now(),
		updatedAt: Date.now(),
	};
	jobs.set(job.id, job);
	emitProgress(getWindows, job);
	return job;
}

export async function enqueueImportJob(
	options: {
		kind: "import-file" | "import-url";
		projectId: string;
		sourcePath?: string;
		url?: string;
		prompt?: string;
	},
	getWindows: () => Array<BrowserWindow | null>,
): Promise<{ success: boolean; job?: AiJob; asset?: MediaAsset; error?: string }> {
	const job = createJob(options.kind, getWindows);
	updateJob(job, { status: "running", progress: 10, message: "Importing…" }, getWindows);

	try {
		if (isCancelled(job.id)) throw new Error("Cancelled");

		updateJob(job, { progress: 40, message: "Copying media…" }, getWindows);

		let result: { success: boolean; asset?: MediaAsset; error?: string };
		if (options.kind === "import-file") {
			if (!options.sourcePath) throw new Error("sourcePath is required for import-file");
			result = await importFileToLibrary({
				projectId: options.projectId,
				sourcePath: options.sourcePath,
				prompt: options.prompt,
			});
		} else {
			if (!options.url) throw new Error("url is required for import-url");
			result = await importUrlToLibrary({
				projectId: options.projectId,
				url: options.url,
				prompt: options.prompt,
			});
		}

		if (isCancelled(job.id)) throw new Error("Cancelled");
		if (!result.success || !result.asset) {
			throw new Error(result.error || "Import failed");
		}

		const done = updateJob(
			job,
			{
				status: "done",
				progress: 100,
				message: "Imported",
				resultAssetId: result.asset.id,
			},
			getWindows,
		);
		return { success: true, job: done, asset: result.asset };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const status = message === "Cancelled" ? "cancelled" : "failed";
		updateJob(job, { status, progress: 100, error: message, message }, getWindows);
		return { success: false, job: jobs.get(job.id), error: message };
	} finally {
		cancelled.delete(job.id);
	}
}

export async function enqueueGenerateTtsJob(
	options: { projectId: string; text: string; voiceId?: string },
	getWindows: () => Array<BrowserWindow | null>,
): Promise<{ success: boolean; job?: AiJob; asset?: MediaAsset; error?: string }> {
	const job = createJob("generate-tts", getWindows);
	updateJob(job, { status: "running", progress: 15, message: "Generating voice…" }, getWindows);

	try {
		if (isCancelled(job.id)) throw new Error("Cancelled");
		const speech = await generateSpeech({ text: options.text, voiceId: options.voiceId });
		if (isCancelled(job.id)) throw new Error("Cancelled");

		updateJob(job, { progress: 80, message: "Saving to library…" }, getWindows);
		const result = await importBytesToLibrary({
			projectId: options.projectId,
			bytes: speech.bytes,
			fileName: `voiceover-${Date.now()}.mp3`,
			mimeType: speech.mimeType,
			type: "tts",
			provider: "elevenlabs",
			prompt: options.text.slice(0, 200),
			durationMs: Math.max(1000, Math.round((options.text.split(/\s+/).length / 2.5) * 1000)),
		});
		if (!result.success || !result.asset) throw new Error(result.error || "Failed to save TTS");

		const done = updateJob(
			job,
			{ status: "done", progress: 100, message: "Voice ready", resultAssetId: result.asset.id },
			getWindows,
		);
		return { success: true, job: done, asset: result.asset };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const status = message === "Cancelled" ? "cancelled" : "failed";
		updateJob(job, { status, progress: 100, error: message, message }, getWindows);
		return { success: false, job: jobs.get(job.id), error: message };
	} finally {
		cancelled.delete(job.id);
	}
}

export async function enqueueGenerateMusicJob(
	options: { projectId: string; prompt: string; lengthMs?: number },
	getWindows: () => Array<BrowserWindow | null>,
): Promise<{ success: boolean; job?: AiJob; asset?: MediaAsset; error?: string }> {
	const job = createJob("generate-music", getWindows);
	updateJob(job, { status: "running", progress: 15, message: "Composing music…" }, getWindows);

	try {
		if (isCancelled(job.id)) throw new Error("Cancelled");
		const music = await generateMusic({ prompt: options.prompt, lengthMs: options.lengthMs });
		if (isCancelled(job.id)) throw new Error("Cancelled");

		updateJob(job, { progress: 80, message: "Saving to library…" }, getWindows);
		const result = await importBytesToLibrary({
			projectId: options.projectId,
			bytes: music.bytes,
			fileName: `music-${Date.now()}.mp3`,
			mimeType: music.mimeType,
			type: "music",
			provider: "elevenlabs",
			prompt: options.prompt,
			durationMs: music.durationMs,
		});
		if (!result.success || !result.asset) throw new Error(result.error || "Failed to save music");

		const done = updateJob(
			job,
			{ status: "done", progress: 100, message: "Music ready", resultAssetId: result.asset.id },
			getWindows,
		);
		return { success: true, job: done, asset: result.asset };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const status = message === "Cancelled" ? "cancelled" : "failed";
		updateJob(job, { status, progress: 100, error: message, message }, getWindows);
		return { success: false, job: jobs.get(job.id), error: message };
	} finally {
		cancelled.delete(job.id);
	}
}

export async function enqueueGenerateImageJob(
	options: { projectId: string; prompt: string },
	getWindows: () => Array<BrowserWindow | null>,
): Promise<{ success: boolean; job?: AiJob; asset?: MediaAsset; error?: string }> {
	const job = createJob("generate-image", getWindows);
	updateJob(job, { status: "running", progress: 10, message: "Generating image…" }, getWindows);

	try {
		const image = await generateImage({
			prompt: options.prompt,
			onProgress: (message, progress) => updateJob(job, { message, progress }, getWindows),
			isCancelled: () => isCancelled(job.id),
		});
		if (isCancelled(job.id)) throw new Error("Cancelled");

		updateJob(job, { progress: 95, message: "Saving to library…" }, getWindows);
		const ext = image.mimeType.includes("jpeg") ? "jpg" : "png";
		const result = await importBytesToLibrary({
			projectId: options.projectId,
			bytes: image.bytes,
			fileName: `image-${Date.now()}.${ext}`,
			mimeType: image.mimeType,
			type: "ai-image",
			provider: "fal",
			prompt: options.prompt,
			width: image.width,
			height: image.height,
		});
		if (!result.success || !result.asset) throw new Error(result.error || "Failed to save image");

		const done = updateJob(
			job,
			{ status: "done", progress: 100, message: "Image ready", resultAssetId: result.asset.id },
			getWindows,
		);
		return { success: true, job: done, asset: result.asset };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const status = message === "Cancelled" ? "cancelled" : "failed";
		updateJob(job, { status, progress: 100, error: message, message }, getWindows);
		return { success: false, job: jobs.get(job.id), error: message };
	} finally {
		cancelled.delete(job.id);
	}
}

export async function enqueueGenerateVideoJob(
	options: { projectId: string; prompt: string; durationSec?: 5 | 10 },
	getWindows: () => Array<BrowserWindow | null>,
): Promise<{ success: boolean; job?: AiJob; asset?: MediaAsset; error?: string }> {
	const job = createJob("generate-video", getWindows);
	updateJob(job, { status: "running", progress: 5, message: "Generating video…" }, getWindows);

	try {
		const video = await generateVideo({
			prompt: options.prompt,
			durationSec: options.durationSec,
			onProgress: (message, progress) => updateJob(job, { message, progress }, getWindows),
			isCancelled: () => isCancelled(job.id),
		});
		if (isCancelled(job.id)) throw new Error("Cancelled");

		updateJob(job, { progress: 95, message: "Saving to library…" }, getWindows);
		const result = await importBytesToLibrary({
			projectId: options.projectId,
			bytes: video.bytes,
			fileName: `video-${Date.now()}.mp4`,
			mimeType: video.mimeType,
			type: "ai-video",
			provider: "fal",
			prompt: options.prompt,
			durationMs: video.durationMs,
		});
		if (!result.success || !result.asset) throw new Error(result.error || "Failed to save video");

		const done = updateJob(
			job,
			{ status: "done", progress: 100, message: "Video ready", resultAssetId: result.asset.id },
			getWindows,
		);
		return { success: true, job: done, asset: result.asset };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const status = message === "Cancelled" ? "cancelled" : "failed";
		updateJob(job, { status, progress: 100, error: message, message }, getWindows);
		return { success: false, job: jobs.get(job.id), error: message };
	} finally {
		cancelled.delete(job.id);
	}
}

export async function enqueueCreatePhotoAvatarJob(
	options: { imagePath: string; name?: string },
	getWindows: () => Array<BrowserWindow | null>,
): Promise<{
	success: boolean;
	job?: AiJob;
	avatar?: import("../../src/lib/ai/types").HeyGenAvatar & { talkingPhotoId?: string };
	error?: string;
}> {
	const job = createJob("create-photo-avatar", getWindows);
	updateJob(job, { status: "running", progress: 5, message: "Creating photo avatar…" }, getWindows);

	try {
		const avatar = await createPhotoAvatarFromImage({
			imagePath: options.imagePath,
			name: options.name,
			onProgress: (message, progress) => updateJob(job, { message, progress }, getWindows),
			isCancelled: () => isCancelled(job.id),
		});
		if (isCancelled(job.id)) throw new Error("Cancelled");

		const done = updateJob(
			job,
			{ status: "done", progress: 100, message: "Photo avatar ready" },
			getWindows,
		);
		return { success: true, job: done, avatar };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const status = message === "Cancelled" ? "cancelled" : "failed";
		updateJob(job, { status, progress: 100, error: message, message }, getWindows);
		return { success: false, job: jobs.get(job.id), error: message };
	} finally {
		cancelled.delete(job.id);
	}
}

export async function enqueueGenerateAvatarJob(
	options: {
		projectId: string;
		script: string;
		avatarId?: string;
		talkingPhotoId?: string;
		voiceId?: string;
		/** When set, upload this portrait first then render. */
		photoPath?: string;
	},
	getWindows: () => Array<BrowserWindow | null>,
): Promise<{ success: boolean; job?: AiJob; asset?: MediaAsset; error?: string }> {
	const job = createJob("generate-avatar", getWindows);
	updateJob(job, { status: "running", progress: 5, message: "Generating avatar…" }, getWindows);

	try {
		let avatarId = options.avatarId;
		let talkingPhotoId = options.talkingPhotoId;

		if (options.photoPath) {
			updateJob(job, { progress: 8, message: "Creating photo avatar…" }, getWindows);
			const photo = await createPhotoAvatarFromImage({
				imagePath: options.photoPath,
				onProgress: (message, progress) =>
					updateJob(job, { message, progress: Math.min(40, progress * 0.4) }, getWindows),
				isCancelled: () => isCancelled(job.id),
			});
			if (isCancelled(job.id)) throw new Error("Cancelled");
			avatarId = photo.talkingPhotoId ? undefined : photo.avatarId;
			talkingPhotoId = photo.talkingPhotoId;
		}

		const video = await generateAvatarVideo({
			script: options.script,
			avatarId,
			talkingPhotoId,
			voiceId: options.voiceId,
			onProgress: (message, progress) =>
				updateJob(
					job,
					{
						message,
						progress: options.photoPath ? 40 + progress * 0.55 : progress,
					},
					getWindows,
				),
			isCancelled: () => isCancelled(job.id),
		});
		if (isCancelled(job.id)) throw new Error("Cancelled");

		updateJob(job, { progress: 95, message: "Saving to library…" }, getWindows);
		const result = await importBytesToLibrary({
			projectId: options.projectId,
			bytes: video.bytes,
			fileName: `avatar-${Date.now()}.mp4`,
			mimeType: video.mimeType,
			type: "ai-video",
			provider: "heygen",
			prompt: options.script.slice(0, 200),
			durationMs: video.durationMs,
			width: 1280,
			height: 720,
		});
		if (!result.success || !result.asset) throw new Error(result.error || "Failed to save avatar");

		const done = updateJob(
			job,
			{ status: "done", progress: 100, message: "Avatar ready", resultAssetId: result.asset.id },
			getWindows,
		);
		return { success: true, job: done, asset: result.asset };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const status = message === "Cancelled" ? "cancelled" : "failed";
		updateJob(job, { status, progress: 100, error: message, message }, getWindows);
		return { success: false, job: jobs.get(job.id), error: message };
	} finally {
		cancelled.delete(job.id);
	}
}
