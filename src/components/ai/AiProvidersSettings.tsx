import { useEffect, useState } from "react";
import { Cloud, Cpu } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AI_PROVIDERS_QUERY_KEY, parallaxApi } from "@/modules/parallax/api";
import type { AIProviderStatus } from "@/modules/parallax/api";
import { useAiStore } from "@/store";

function ProviderCard({ provider }: { provider: AIProviderStatus }) {
  const Icon = provider.kind === "local" ? Cpu : Cloud;
  const status = provider.enabled ? "Enabled" : "Disabled";
  const [keyDraft, setKeyDraft] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);
  const updateProviderStatus = useAiStore((state) => state.updateProviderStatus);
  const queryClient = useQueryClient();

  const saveKey = useMutation({
    mutationFn: () =>
      parallaxApi.aiSaveProviderKey(provider.provider_name, { api_key: keyDraft }),
    onSuccess: (updated) => {
      setKeyDraft("");
      setKeyError(null);
      updateProviderStatus(updated);
      void queryClient.invalidateQueries({ queryKey: AI_PROVIDERS_QUERY_KEY });
    },
    onError: (error) => {
      setKeyDraft("");
      setKeyError(error instanceof Error ? error.message : "OS keychain is unavailable.");
    },
  });

  const deleteKey = useMutation({
    mutationFn: () => parallaxApi.aiDeleteProviderKey(provider.provider_name),
    onSuccess: (updated) => {
      setKeyError(null);
      updateProviderStatus(updated);
      void queryClient.invalidateQueries({ queryKey: AI_PROVIDERS_QUERY_KEY });
    },
    onError: (error) => {
      setKeyError(error instanceof Error ? error.message : "OS keychain is unavailable.");
    },
  });

  return (
    <div className="border-b border-border py-3 last:border-0">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-[var(--bg-3)] text-[var(--text-3)]">
            <Icon size={14} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-[12px] font-medium text-[var(--text-1)]">
                {provider.display_name}
              </p>
              <span className="rounded border border-border px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[var(--text-3)]">
                {provider.kind === "local" ? "Local" : "Cloud"}
              </span>
            </div>
            <p className="mt-0.5 text-[10px] text-[var(--text-3)]">
              {provider.selected_model || (provider.kind === "local" ? "Selected in AI panel" : "OS keychain protected")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {provider.has_key ? (
            <span className="rounded-md border border-[var(--clr-cyan)] px-2 py-1 text-[10px] text-[var(--clr-cyan)]">
              Key saved
            </span>
          ) : null}
          <span
            className={`rounded-md border px-2 py-1 text-[10px] ${
              provider.enabled
                ? "border-[var(--clr-green)] text-[var(--clr-green)]"
                : "border-border text-[var(--text-3)]"
            }`}
          >
            {status}
          </span>
        </div>
      </div>

      {provider.kind === "cloud" ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 pl-9">
          {provider.has_key ? (
            <button
              type="button"
              onClick={() => deleteKey.mutate()}
              className="rounded-md border border-border px-2 py-1.5 text-[10px] text-[var(--text-2)] hover:border-[var(--clr-cyan)] hover:text-[var(--text-1)]"
            >
              Remove key
            </button>
          ) : (
            <>
              <label className="sr-only" htmlFor={`ai-key-${provider.provider_name}`}>
                {provider.display_name} API key
              </label>
              <input
                id={`ai-key-${provider.provider_name}`}
                aria-label={`${provider.display_name} API key`}
                type="password"
                value={keyDraft}
                onChange={(event) => setKeyDraft(event.target.value)}
                className="min-w-[220px] flex-1 rounded-md border border-border bg-[var(--bg-3)] px-2 py-1.5 text-[11px] text-[var(--text-1)] focus:outline-none focus:ring-1 focus:ring-[var(--clr-cyan)]"
              />
              <button
                type="button"
                disabled={!keyDraft || saveKey.isPending}
                onClick={() => saveKey.mutate()}
                aria-label={`Save ${provider.display_name} key`}
                className="rounded-md border border-border px-2 py-1.5 text-[10px] text-[var(--text-2)] hover:border-[var(--clr-cyan)] hover:text-[var(--text-1)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Save key
              </button>
            </>
          )}
          {keyError ? (
            <p className="w-full text-[10px] text-[var(--clr-red)]">{keyError}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default function AiProvidersSettings() {
  const { providers, setProvidersStatus } = useAiStore();

  const providersQuery = useQuery({
    queryKey: AI_PROVIDERS_QUERY_KEY,
    queryFn: () => parallaxApi.aiProviders(),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (providersQuery.data) {
      setProvidersStatus(providersQuery.data);
    }
  }, [providersQuery.data, setProvidersStatus]);

  const loading = providersQuery.isLoading;

  return (
    <div className="py-2">
      <div className="border-b border-border pb-3">
        <p className="text-[12px] font-medium text-[var(--text-1)]">Provider Status</p>
        <p className="mt-0.5 text-[10px] leading-snug text-[var(--text-3)]">
          Cloud providers require a key saved in the OS keychain. Local Ollama remains available.
        </p>
      </div>

      <div className="py-1">
        {loading && providers.length === 0 ? (
          <p className="py-3 text-[10px] text-[var(--text-3)]">Loading providers…</p>
        ) : (
          providers.map((provider) => (
            <ProviderCard key={provider.provider_name} provider={provider} />
          ))
        )}
      </div>

    </div>
  );
}
