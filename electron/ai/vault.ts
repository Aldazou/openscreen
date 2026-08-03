import fs from "node:fs";
import path from "node:path";
import { app, safeStorage } from "electron";
import type { AiApiKeyStatus, AiProviderId } from "../../src/lib/ai/types";
import { AI_PROVIDERS } from "../../src/lib/ai/types";

const VAULT_FILE = () => path.join(app.getPath("userData"), "ai-vault.bin");

const ENV_KEY_MAP: Record<AiProviderId, string> = {
	fal: "FAL_KEY",
	elevenlabs: "ELEVENLABS_API_KEY",
	heygen: "HEYGEN_API_KEY",
	openai: "OPENAI_API_KEY",
};

type VaultPayload = {
	version: 1;
	keys: Partial<Record<AiProviderId, string>>;
};

function readVaultRaw(): VaultPayload {
	const filePath = VAULT_FILE();
	if (!fs.existsSync(filePath)) {
		return { version: 1, keys: {} };
	}

	try {
		const buf = fs.readFileSync(filePath);
		if (safeStorage.isEncryptionAvailable()) {
			const decrypted = safeStorage.decryptString(buf);
			const parsed = JSON.parse(decrypted) as VaultPayload;
			if (parsed?.version === 1 && parsed.keys && typeof parsed.keys === "object") {
				return parsed;
			}
		} else {
			// Fallback when OS encryption is unavailable (rare / CI): still gated to userData.
			const parsed = JSON.parse(buf.toString("utf-8")) as VaultPayload;
			if (parsed?.version === 1 && parsed.keys && typeof parsed.keys === "object") {
				return parsed;
			}
		}
	} catch (error) {
		console.warn("[ai-vault] Failed to read vault:", error);
	}

	return { version: 1, keys: {} };
}

function writeVault(payload: VaultPayload): void {
	const filePath = VAULT_FILE();
	const json = JSON.stringify(payload);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });

	if (safeStorage.isEncryptionAvailable()) {
		const encrypted = safeStorage.encryptString(json);
		fs.writeFileSync(filePath, encrypted);
		return;
	}

	fs.writeFileSync(filePath, json, "utf-8");
}

function envKey(provider: AiProviderId): string | undefined {
	const value = process.env[ENV_KEY_MAP[provider]]?.trim();
	return value || undefined;
}

function hintFromKey(key: string): string {
	const trimmed = key.trim();
	if (trimmed.length <= 4) return "••••";
	return trimmed.slice(-4);
}

/** Returns the resolved API key (vault wins over env). Never expose to renderer. */
export function getApiKey(provider: AiProviderId): string | null {
	const vault = readVaultRaw();
	const fromVault = vault.keys[provider]?.trim();
	if (fromVault) return fromVault;
	return envKey(provider) ?? null;
}

export function setApiKey(
	provider: AiProviderId,
	key: string,
): { success: boolean; error?: string } {
	if (!AI_PROVIDERS.includes(provider)) {
		return { success: false, error: "Unknown provider" };
	}
	const trimmed = key.trim();
	if (!trimmed) {
		return { success: false, error: "API key is empty" };
	}

	const vault = readVaultRaw();
	vault.keys[provider] = trimmed;
	try {
		writeVault(vault);
		return { success: true };
	} catch (error) {
		return { success: false, error: String(error) };
	}
}

export function clearApiKey(provider: AiProviderId): { success: boolean; error?: string } {
	if (!AI_PROVIDERS.includes(provider)) {
		return { success: false, error: "Unknown provider" };
	}
	const vault = readVaultRaw();
	delete vault.keys[provider];
	try {
		writeVault(vault);
		return { success: true };
	} catch (error) {
		return { success: false, error: String(error) };
	}
}

export function getApiKeyStatus(provider: AiProviderId): AiApiKeyStatus {
	const vault = readVaultRaw();
	const fromVault = vault.keys[provider]?.trim();
	if (fromVault) {
		return {
			provider,
			configured: true,
			hint: hintFromKey(fromVault),
			source: "vault",
		};
	}
	const fromEnv = envKey(provider);
	if (fromEnv) {
		return {
			provider,
			configured: true,
			hint: hintFromKey(fromEnv),
			source: "env",
		};
	}
	return { provider, configured: false, source: "none" };
}

export function getAllApiKeyStatuses(): AiApiKeyStatus[] {
	return AI_PROVIDERS.map(getApiKeyStatus);
}
