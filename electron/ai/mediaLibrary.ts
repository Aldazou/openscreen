import fs from "node:fs/promises";
import path from "node:path";
import { app, dialog } from "electron";
import { createId, type MediaAsset, type MediaAssetType } from "../../src/lib/ai/types";

const MEDIA_ROOT = () => path.join(app.getPath("userData"), "media");

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]);
const VIDEO_EXTS = new Set([".mp4", ".webm", ".mov", ".mkv", ".m4v"]);
const AUDIO_EXTS = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"]);

function projectDir(projectId: string): string {
	const safe = projectId.replace(/[^a-zA-Z0-9._-]/g, "_") || "default";
	return path.join(MEDIA_ROOT(), safe);
}

function catalogPath(projectId: string): string {
	return path.join(projectDir(projectId), "catalog.json");
}

async function ensureProjectDir(projectId: string): Promise<string> {
	const dir = projectDir(projectId);
	await fs.mkdir(dir, { recursive: true });
	return dir;
}

async function readCatalog(projectId: string): Promise<MediaAsset[]> {
	const file = catalogPath(projectId);
	try {
		const raw = await fs.readFile(file, "utf-8");
		const parsed = JSON.parse(raw) as { assets?: MediaAsset[] };
		return Array.isArray(parsed.assets) ? parsed.assets : [];
	} catch {
		return [];
	}
}

async function writeCatalog(projectId: string, assets: MediaAsset[]): Promise<void> {
	await ensureProjectDir(projectId);
	await fs.writeFile(
		catalogPath(projectId),
		JSON.stringify({ version: 1, assets }, null, 2),
		"utf-8",
	);
}

function inferType(filePath: string, forced?: MediaAssetType): MediaAssetType {
	if (forced) return forced;
	const ext = path.extname(filePath).toLowerCase();
	if (IMAGE_EXTS.has(ext)) return "ai-image";
	if (VIDEO_EXTS.has(ext)) return "ai-video";
	if (AUDIO_EXTS.has(ext)) return "music";
	return "import";
}

function mimeForExt(filePath: string): string {
	const ext = path.extname(filePath).toLowerCase();
	const map: Record<string, string> = {
		".png": "image/png",
		".jpg": "image/jpeg",
		".jpeg": "image/jpeg",
		".webp": "image/webp",
		".gif": "image/gif",
		".mp4": "video/mp4",
		".webm": "video/webm",
		".mov": "video/quicktime",
		".mp3": "audio/mpeg",
		".wav": "audio/wav",
		".m4a": "audio/mp4",
		".aac": "audio/aac",
		".ogg": "audio/ogg",
	};
	return map[ext] ?? "application/octet-stream";
}

export function getMediaRoot(): string {
	return MEDIA_ROOT();
}

export function isUnderMediaRoot(filePath: string): boolean {
	const resolved = path.resolve(filePath);
	const root = path.resolve(MEDIA_ROOT());
	return resolved === root || resolved.startsWith(root + path.sep);
}

export async function listAssets(projectId: string): Promise<MediaAsset[]> {
	return readCatalog(projectId);
}

export async function importFileToLibrary(options: {
	projectId: string;
	sourcePath: string;
	type?: MediaAssetType;
	prompt?: string;
	provider?: MediaAsset["provider"];
	durationMs?: number;
}): Promise<{ success: boolean; asset?: MediaAsset; error?: string }> {
	const { projectId, sourcePath, prompt, durationMs } = options;
	try {
		await fs.access(sourcePath);
	} catch {
		return { success: false, error: "Source file not found" };
	}

	const dir = await ensureProjectDir(projectId);
	const id = createId("asset");
	const ext = path.extname(sourcePath) || "";
	const destName = `${id}${ext}`;
	const destPath = path.join(dir, destName);
	await fs.copyFile(sourcePath, destPath);

	const asset: MediaAsset = {
		id,
		type: inferType(sourcePath, options.type),
		path: destPath,
		fileName: path.basename(sourcePath),
		mimeType: mimeForExt(sourcePath),
		prompt,
		provider: options.provider ?? "import",
		createdAt: Date.now(),
		durationMs,
	};

	const assets = await readCatalog(projectId);
	assets.unshift(asset);
	await writeCatalog(projectId, assets);
	return { success: true, asset };
}

/** Write in-memory bytes (API generations) into the project media library. */
export async function importBytesToLibrary(options: {
	projectId: string;
	bytes: Buffer | Uint8Array;
	fileName: string;
	mimeType: string;
	type: MediaAssetType;
	provider: MediaAsset["provider"];
	prompt?: string;
	durationMs?: number;
	width?: number;
	height?: number;
}): Promise<{ success: boolean; asset?: MediaAsset; error?: string }> {
	try {
		const dir = await ensureProjectDir(options.projectId);
		const id = createId("asset");
		const ext = path.extname(options.fileName) || mimeExt(options.mimeType);
		const destPath = path.join(dir, `${id}${ext}`);
		await fs.writeFile(destPath, options.bytes);

		const asset: MediaAsset = {
			id,
			type: options.type,
			path: destPath,
			fileName: options.fileName,
			mimeType: options.mimeType,
			prompt: options.prompt,
			provider: options.provider,
			createdAt: Date.now(),
			durationMs: options.durationMs,
			width: options.width,
			height: options.height,
		};

		const assets = await readCatalog(options.projectId);
		assets.unshift(asset);
		await writeCatalog(options.projectId, assets);
		return { success: true, asset };
	} catch (error) {
		return { success: false, error: error instanceof Error ? error.message : String(error) };
	}
}

function mimeExt(mime: string): string {
	const map: Record<string, string> = {
		"image/png": ".png",
		"image/jpeg": ".jpg",
		"image/webp": ".webp",
		"video/mp4": ".mp4",
		"video/webm": ".webm",
		"audio/mpeg": ".mp3",
		"audio/mp3": ".mp3",
		"audio/wav": ".wav",
	};
	return map[mime] ?? ".bin";
}

export async function importUrlToLibrary(options: {
	projectId: string;
	url: string;
	type?: MediaAssetType;
	prompt?: string;
}): Promise<{ success: boolean; asset?: MediaAsset; error?: string }> {
	const { projectId, url, prompt } = options;
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return { success: false, error: "Invalid URL" };
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		return { success: false, error: "Only http(s) URLs are supported" };
	}

	const response = await fetch(url);
	if (!response.ok) {
		return { success: false, error: `Download failed (${response.status})` };
	}

	const contentType = response.headers.get("content-type") || "";
	let ext = path.extname(parsed.pathname);
	if (!ext) {
		if (contentType.includes("png")) ext = ".png";
		else if (contentType.includes("jpeg") || contentType.includes("jpg")) ext = ".jpg";
		else if (contentType.includes("webp")) ext = ".webp";
		else if (contentType.includes("mp4")) ext = ".mp4";
		else if (contentType.includes("webm")) ext = ".webm";
		else if (contentType.includes("mpeg") || contentType.includes("mp3")) ext = ".mp3";
		else if (contentType.includes("wav")) ext = ".wav";
		else ext = ".bin";
	}

	const dir = await ensureProjectDir(projectId);
	const id = createId("asset");
	const destPath = path.join(dir, `${id}${ext}`);
	const buffer = Buffer.from(await response.arrayBuffer());
	await fs.writeFile(destPath, buffer);

	let type: MediaAssetType = options.type ?? "import";
	if (!options.type) {
		if (contentType.startsWith("image/") || IMAGE_EXTS.has(ext)) type = "ai-image";
		else if (contentType.startsWith("video/") || VIDEO_EXTS.has(ext)) type = "ai-video";
		else if (contentType.startsWith("audio/") || AUDIO_EXTS.has(ext)) type = "music";
	}

	const asset: MediaAsset = {
		id,
		type,
		path: destPath,
		fileName: path.basename(parsed.pathname) || `${id}${ext}`,
		mimeType: contentType.split(";")[0]?.trim() || mimeForExt(destPath),
		prompt,
		provider: "import",
		createdAt: Date.now(),
	};

	const assets = await readCatalog(projectId);
	assets.unshift(asset);
	await writeCatalog(projectId, assets);
	return { success: true, asset };
}

export async function deleteAsset(
	projectId: string,
	assetId: string,
): Promise<{ success: boolean; error?: string }> {
	const assets = await readCatalog(projectId);
	const asset = assets.find((a) => a.id === assetId);
	if (!asset) return { success: false, error: "Asset not found" };

	const next = assets.filter((a) => a.id !== assetId);
	await writeCatalog(projectId, next);
	try {
		if (isUnderMediaRoot(asset.path)) {
			await fs.unlink(asset.path);
		}
	} catch {
		// Catalog is source of truth; ignore missing files.
	}
	return { success: true };
}

export async function openImportFilePicker(): Promise<{
	canceled: boolean;
	success: boolean;
	path?: string;
	error?: string;
}> {
	const result = await dialog.showOpenDialog({
		title: "Import media into library",
		properties: ["openFile"],
		filters: [
			{
				name: "Media",
				extensions: [
					"png",
					"jpg",
					"jpeg",
					"webp",
					"gif",
					"mp4",
					"webm",
					"mov",
					"mp3",
					"wav",
					"m4a",
					"aac",
					"ogg",
				],
			},
		],
	});
	if (result.canceled || result.filePaths.length === 0) {
		return { canceled: true, success: false };
	}
	return { canceled: false, success: true, path: result.filePaths[0] };
}

export async function openPhotoAvatarPicker(): Promise<{
	canceled: boolean;
	success: boolean;
	path?: string;
	error?: string;
}> {
	const result = await dialog.showOpenDialog({
		title: "Choose a portrait photo for HeyGen",
		properties: ["openFile"],
		filters: [
			{
				name: "Images",
				extensions: ["png", "jpg", "jpeg", "webp"],
			},
		],
	});
	if (result.canceled || result.filePaths.length === 0) {
		return { canceled: true, success: false };
	}
	return { canceled: false, success: true, path: result.filePaths[0] };
}
