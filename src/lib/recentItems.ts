/** Recent projects / recordings helpers for the editor empty state. */

export interface RecentProjectEntry {
	path: string;
	name: string;
	openedAt: number;
}

export interface RecentRecordingEntry {
	path: string;
	name: string;
	modifiedAt: number;
}

const MAX_RECENT_PROJECTS = 8;

export function projectNameFromPath(filePath: string): string {
	const base = filePath.split(/[/\\]/).pop() || filePath;
	return base.replace(/\.openscreen$/i, "") || base;
}

export function pushRecentProject(
	existing: RecentProjectEntry[],
	filePath: string,
	openedAt = Date.now(),
): RecentProjectEntry[] {
	const normalized = filePath.trim();
	if (!normalized) return existing;
	const entry: RecentProjectEntry = {
		path: normalized,
		name: projectNameFromPath(normalized),
		openedAt,
	};
	return [entry, ...existing.filter((p) => p.path !== normalized)].slice(0, MAX_RECENT_PROJECTS);
}

export function isVideoFileName(fileName: string): boolean {
	return /\.(mp4|mov|webm|mkv|avi|m4v|wmv)$/i.test(fileName);
}
