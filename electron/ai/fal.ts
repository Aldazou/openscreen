import { getApiKey } from "./vault";

const QUEUE_BASE = "https://queue.fal.run";

const IMAGE_MODEL = "fal-ai/flux/dev";
const VIDEO_MODEL = "fal-ai/kling-video/v2.5-turbo/pro/text-to-video";

function requireKey(): string {
	const key = getApiKey("fal");
	if (!key) {
		throw new Error("fal API key not configured. Add it in AI settings.");
	}
	return key;
}

function authHeaders(key: string): HeadersInit {
	return {
		Authorization: `Key ${key}`,
		"Content-Type": "application/json",
	};
}

async function readError(response: Response): Promise<string> {
	try {
		const text = await response.text();
		try {
			const json = JSON.parse(text) as { detail?: string; error?: string; message?: string };
			return json.detail || json.error || json.message || text.slice(0, 240);
		} catch {
			return text.slice(0, 240) || `HTTP ${response.status}`;
		}
	} catch {
		return `HTTP ${response.status}`;
	}
}

async function sleep(ms: number) {
	await new Promise((r) => setTimeout(r, ms));
}

type QueueSubmitResponse = {
	request_id: string;
	status_url?: string;
	response_url?: string;
};

type QueueStatusResponse = {
	status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
	response_url?: string;
	error?: string;
};

async function submitAndWait<T>(
	modelId: string,
	input: Record<string, unknown>,
	onProgress?: (message: string, progress: number) => void,
	isCancelled?: () => boolean,
): Promise<T> {
	const key = requireKey();
	onProgress?.("Submitting to fal…", 15);

	const submit = await fetch(`${QUEUE_BASE}/${modelId}`, {
		method: "POST",
		headers: authHeaders(key),
		body: JSON.stringify(input),
	});
	if (!submit.ok) {
		throw new Error(await readError(submit));
	}
	const submitted = (await submit.json()) as QueueSubmitResponse;
	const requestId = submitted.request_id;
	if (!requestId) {
		throw new Error("fal did not return a request_id");
	}

	const statusUrl = submitted.status_url || `${QUEUE_BASE}/${modelId}/requests/${requestId}/status`;
	const resultUrl = submitted.response_url || `${QUEUE_BASE}/${modelId}/requests/${requestId}`;

	let attempts = 0;
	const maxAttempts = 180; // ~6 minutes at 2s
	while (attempts < maxAttempts) {
		if (isCancelled?.()) {
			throw new Error("Cancelled");
		}
		attempts += 1;
		const progress = Math.min(90, 20 + attempts);
		onProgress?.(`Generating… (${attempts})`, progress);

		const statusRes = await fetch(statusUrl, { headers: authHeaders(key) });
		if (!statusRes.ok) {
			throw new Error(await readError(statusRes));
		}
		const status = (await statusRes.json()) as QueueStatusResponse;

		if (status.status === "COMPLETED") {
			onProgress?.("Downloading result…", 92);
			const resultRes = await fetch(status.response_url || resultUrl, {
				headers: authHeaders(key),
			});
			if (!resultRes.ok) {
				throw new Error(await readError(resultRes));
			}
			return (await resultRes.json()) as T;
		}

		if (status.status === "FAILED") {
			throw new Error(status.error || "fal generation failed");
		}

		await sleep(2000);
	}

	throw new Error("fal generation timed out");
}

async function downloadUrl(url: string): Promise<Buffer> {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to download fal asset (${response.status})`);
	}
	return Buffer.from(await response.arrayBuffer());
}

export async function generateImage(options: {
	prompt: string;
	onProgress?: (message: string, progress: number) => void;
	isCancelled?: () => boolean;
}): Promise<{ bytes: Buffer; mimeType: string; width?: number; height?: number; url: string }> {
	const prompt = options.prompt.trim();
	if (!prompt) throw new Error("Image prompt is empty");

	const result = await submitAndWait<{
		images?: Array<{ url: string; width?: number; height?: number; content_type?: string }>;
	}>(
		IMAGE_MODEL,
		{
			prompt,
			image_size: "landscape_16_9",
			num_images: 1,
		},
		options.onProgress,
		options.isCancelled,
	);

	const image = result.images?.[0];
	if (!image?.url) {
		throw new Error("fal returned no image");
	}
	const bytes = await downloadUrl(image.url);
	return {
		bytes,
		mimeType: image.content_type || "image/png",
		width: image.width,
		height: image.height,
		url: image.url,
	};
}

export async function generateVideo(options: {
	prompt: string;
	durationSec?: 5 | 10;
	onProgress?: (message: string, progress: number) => void;
	isCancelled?: () => boolean;
}): Promise<{ bytes: Buffer; mimeType: string; durationMs: number; url: string }> {
	const prompt = options.prompt.trim();
	if (!prompt) throw new Error("Video prompt is empty");

	const duration = options.durationSec === 10 ? "10" : "5";
	// Prefer turbo standard; if model id fails, callers see the error and can retry.
	const result = await submitAndWait<{
		video?: { url: string; content_type?: string };
	}>(
		VIDEO_MODEL,
		{
			prompt,
			duration,
			aspect_ratio: "16:9",
		},
		options.onProgress,
		options.isCancelled,
	);

	const video = result.video;
	if (!video?.url) {
		throw new Error("fal returned no video");
	}
	const bytes = await downloadUrl(video.url);
	return {
		bytes,
		mimeType: video.content_type || "video/mp4",
		durationMs: Number(duration) * 1000,
		url: video.url,
	};
}
