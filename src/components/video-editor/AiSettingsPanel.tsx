import { Check, KeyRound, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AI_PROVIDERS, type AiApiKeyStatus, type AiProviderId } from "@/lib/ai/types";

const PROVIDER_LABELS: Record<AiProviderId, string> = {
	fal: "fal.ai (images & video)",
	elevenlabs: "ElevenLabs (voice & music)",
	heygen: "HeyGen (avatars)",
	openai: "OpenAI (prompt director)",
};

/**
 * BYO API key management for the AI Director. Secrets are stored in the
 * Electron main-process vault — this panel never persists keys in localStorage.
 */
export function AiSettingsPanel() {
	const [statuses, setStatuses] = useState<AiApiKeyStatus[]>([]);
	const [drafts, setDrafts] = useState<Partial<Record<AiProviderId, string>>>({});
	const [busy, setBusy] = useState<AiProviderId | null>(null);
	const [message, setMessage] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		if (!window.electronAPI?.aiGetAllApiKeyStatuses) return;
		const result = await window.electronAPI.aiGetAllApiKeyStatuses();
		if (result.success && result.statuses) {
			setStatuses(result.statuses);
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const handleSave = async (provider: AiProviderId) => {
		const key = drafts[provider]?.trim();
		if (!key) {
			setMessage("Paste an API key first.");
			return;
		}
		setBusy(provider);
		setMessage(null);
		try {
			const result = await window.electronAPI.aiSetApiKey(provider, key);
			if (!result.success) {
				setMessage(result.error || "Failed to save key");
			} else {
				setDrafts((prev) => ({ ...prev, [provider]: "" }));
				setMessage(`${PROVIDER_LABELS[provider]} key saved.`);
				await refresh();
			}
		} finally {
			setBusy(null);
		}
	};

	const handleClear = async (provider: AiProviderId) => {
		setBusy(provider);
		setMessage(null);
		try {
			const result = await window.electronAPI.aiClearApiKey(provider);
			if (!result.success) {
				setMessage(result.error || "Failed to clear key");
			} else {
				setMessage(`${PROVIDER_LABELS[provider]} key cleared.`);
				await refresh();
			}
		} finally {
			setBusy(null);
		}
	};

	return (
		<div className="space-y-4 px-1">
			<div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
				<div className="flex items-center gap-2 text-sm font-medium text-slate-200">
					<KeyRound className="h-4 w-4 text-[#34B27B]" />
					AI API keys
				</div>
				<p className="mt-1.5 text-xs leading-relaxed text-slate-500">
					Bring your own keys for fal, ElevenLabs, OpenAI (prompt director), and HeyGen. Keys are
					encrypted in the app vault and never sent anywhere except those providers. Core recording
					and editing still work offline without keys.
				</p>
			</div>

			{AI_PROVIDERS.map((provider) => {
				const status = statuses.find((s) => s.provider === provider);
				const configured = Boolean(status?.configured);
				return (
					<div
						key={provider}
						className="space-y-2 rounded-lg border border-white/10 bg-black/20 p-3"
					>
						<div className="flex items-center justify-between gap-2">
							<div>
								<div className="text-sm font-medium text-slate-200">
									{PROVIDER_LABELS[provider]}
								</div>
								<div className="mt-0.5 text-[11px] text-slate-500">
									{configured ? (
										<span className="inline-flex items-center gap-1 text-[#34B27B]">
											<Check className="h-3 w-3" />
											Configured
											{status?.hint ? ` (…${status.hint})` : ""}
											{status?.source === "env" ? " via env" : ""}
										</span>
									) : (
										"Not configured"
									)}
								</div>
							</div>
							{configured && status?.source === "vault" && (
								<Button
									type="button"
									variant="ghost"
									size="sm"
									disabled={busy === provider}
									onClick={() => void handleClear(provider)}
									className="h-7 gap-1 px-2 text-xs text-slate-400 hover:text-red-300"
								>
									<Trash2 className="h-3 w-3" />
									Clear
								</Button>
							)}
						</div>
						<div className="flex gap-2">
							<Input
								type="password"
								autoComplete="off"
								spellCheck={false}
								placeholder={configured ? "Replace key…" : "Paste API key"}
								value={drafts[provider] ?? ""}
								onChange={(e) => setDrafts((prev) => ({ ...prev, [provider]: e.target.value }))}
								className="h-8 border-white/10 bg-white/5 text-xs text-slate-200"
							/>
							<Button
								type="button"
								size="sm"
								disabled={busy === provider || !drafts[provider]?.trim()}
								onClick={() => void handleSave(provider)}
								className="h-8 bg-[#34B27B] px-3 text-xs text-white hover:bg-[#2d9e6c]"
							>
								Save
							</Button>
						</div>
					</div>
				);
			})}

			{message && <p className="text-xs text-slate-400">{message}</p>}
		</div>
	);
}
