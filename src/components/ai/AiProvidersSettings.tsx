import { useEffect, useState } from "react";
import { Cloud, Cpu } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { parallaxApi } from "@/modules/parallax/api";
import type { AIRoutingPolicyUpdate, AIProviderStatus } from "@/modules/parallax/api";
import { useAiStore } from "@/store";

function ProviderCard({ provider }: { provider: AIProviderStatus }) {
  const Icon = provider.kind === "local" ? Cpu : Cloud;
  const status = provider.enabled ? "Enabled" : "Disabled";

  return (
    <div className="flex items-center justify-between gap-3 border-b border-border py-3 last:border-0">
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
            {provider.selected_model || (provider.kind === "local" ? "Selected in AI panel" : "Key storage required")}
          </p>
        </div>
      </div>
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
  );
}

export default function AiProvidersSettings() {
  const {
    providers,
    routingMode,
    localFallbackEnabled,
    perCallCostCapUsd,
    monthlyCostCapUsd,
    setProvidersStatus,
    setRoutingPolicy,
  } = useAiStore();

  const providersQuery = useQuery({
    queryKey: ["ai", "providers", "settings"],
    queryFn: () => parallaxApi.aiProviders(),
    staleTime: 30_000,
  });

  const routingPolicyQuery = useQuery({
    queryKey: ["ai", "routing-policy"],
    queryFn: () => parallaxApi.aiRoutingPolicy(),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (providersQuery.data) {
      setProvidersStatus(providersQuery.data);
    }
  }, [providersQuery.data, setProvidersStatus]);

  useEffect(() => {
    if (routingPolicyQuery.data) {
      setRoutingPolicy(routingPolicyQuery.data);
    }
  }, [routingPolicyQuery.data, setRoutingPolicy]);

  const updatePolicy = useMutation({
    mutationFn: (policy: AIRoutingPolicyUpdate) =>
      parallaxApi.aiUpdateRoutingPolicy(policy),
    onSuccess: (policy) => {
      setRoutingPolicy(policy);
    },
  });

  const [perCallDraft, setPerCallDraft] = useState(String(perCallCostCapUsd));
  const [monthlyDraft, setMonthlyDraft] = useState(String(monthlyCostCapUsd));

  useEffect(() => {
    setPerCallDraft(String(perCallCostCapUsd));
  }, [perCallCostCapUsd]);

  useEffect(() => {
    setMonthlyDraft(String(monthlyCostCapUsd));
  }, [monthlyCostCapUsd]);

  function savePolicy(patch: Partial<AIRoutingPolicyUpdate>) {
    const current = useAiStore.getState();
    updatePolicy.mutate({
      routing_mode: current.routingMode,
      local_fallback_enabled: current.localFallbackEnabled,
      per_call_cost_cap_usd: current.perCallCostCapUsd,
      monthly_cost_cap_usd: current.monthlyCostCapUsd,
      ...patch,
    });
  }

  function parseDraftCost(value: string, fallback: number) {
    const next = Number(value);
    return Number.isFinite(next) ? next : fallback;
  }

  const loading = providersQuery.isLoading || routingPolicyQuery.isLoading;

  return (
    <div className="py-2">
      <div className="border-b border-border pb-3">
        <p className="text-[12px] font-medium text-[var(--text-1)]">Provider Status</p>
        <p className="mt-0.5 text-[10px] leading-snug text-[var(--text-3)]">
          Cloud providers stay disabled until OS keychain storage is added. Local Ollama remains available.
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

      {loading ? null : (
        <div className="border-t border-border pt-4">
          <div className="flex items-center justify-between gap-6 border-b border-border py-3">
            <div className="min-w-0 flex-1">
              <label htmlFor="ai-routing-mode" className="text-[12px] font-medium text-[var(--text-1)]">
                Routing mode
              </label>
              <p className="mt-0.5 text-[10px] text-[var(--text-3)]">
                Routing preference is saved while AI execution remains local-only.
              </p>
            </div>
            <select
              id="ai-routing-mode"
              aria-label="Routing mode"
              value={routingMode}
              onChange={(event) =>
                savePolicy({ routing_mode: event.target.value as AIRoutingPolicyUpdate["routing_mode"] })
              }
              className="min-w-[150px] rounded-md border border-border bg-[var(--bg-3)] px-3 py-1.5 text-[11px] text-[var(--text-1)] focus:outline-none focus:ring-1 focus:ring-[var(--clr-cyan)]"
            >
              <option value="local_only">Local only</option>
              <option value="cloud_manual" disabled>Cloud manual</option>
              <option value="hybrid_auto" disabled>Hybrid auto</option>
              <option value="cloud_with_local_fallback" disabled>Cloud with fallback</option>
            </select>
          </div>

          <div className="flex items-center justify-between gap-6 border-b border-border py-3">
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium text-[var(--text-1)]">Local fallback</p>
              <p className="mt-0.5 text-[10px] text-[var(--text-3)]">
                Keep local analysis available when cloud routing is unavailable.
              </p>
            </div>
            <button
              role="switch"
              aria-checked={localFallbackEnabled}
              aria-label="Local fallback"
              onClick={() => savePolicy({ local_fallback_enabled: !localFallbackEnabled })}
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors focus:outline-none focus:ring-1 focus:ring-[var(--clr-cyan)] ${
                localFallbackEnabled
                  ? "border-[var(--clr-cyan)] bg-[var(--clr-cyan)]"
                  : "border-border bg-[var(--bg-4)]"
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
                  localFallbackEnabled ? "translate-x-[18px]" : "translate-x-[2px]"
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between gap-6 border-b border-border py-3">
            <div className="min-w-0 flex-1">
              <label htmlFor="ai-per-call-cap" className="text-[12px] font-medium text-[var(--text-1)]">
                Per-call cost cap
              </label>
              <p className="mt-0.5 text-[10px] text-[var(--text-3)]">
                Stored for future cloud calls; not enforced while local-only.
              </p>
            </div>
            <input
              id="ai-per-call-cap"
              aria-label="Per-call cost cap"
              type="number"
              min="0"
              step="0.1"
              value={perCallDraft}
              onChange={(event) => {
                const nextDraft = event.target.value;
                setPerCallDraft(nextDraft);
                useAiStore.setState({
                  perCallCostCapUsd: parseDraftCost(nextDraft, perCallCostCapUsd),
                });
              }}
              onBlur={() =>
                savePolicy({
                  per_call_cost_cap_usd: parseDraftCost(perCallDraft, perCallCostCapUsd),
                })
              }
              className="w-[90px] rounded-md border border-border bg-[var(--bg-3)] px-2 py-1.5 text-right font-data text-[11px] text-[var(--text-1)] focus:outline-none focus:ring-1 focus:ring-[var(--clr-cyan)]"
            />
          </div>

          <div className="flex items-center justify-between gap-6 py-3">
            <div className="min-w-0 flex-1">
              <label htmlFor="ai-monthly-cap" className="text-[12px] font-medium text-[var(--text-1)]">
                Monthly cost cap
              </label>
              <p className="mt-0.5 text-[10px] text-[var(--text-3)]">
                Stored locally and used by later cloud-cost enforcement.
              </p>
            </div>
            <input
              id="ai-monthly-cap"
              aria-label="Monthly cost cap"
              type="number"
              min="0"
              step="1"
              value={monthlyDraft}
              onChange={(event) => {
                const nextDraft = event.target.value;
                setMonthlyDraft(nextDraft);
                useAiStore.setState({
                  monthlyCostCapUsd: parseDraftCost(nextDraft, monthlyCostCapUsd),
                });
              }}
              onBlur={() =>
                savePolicy({
                  monthly_cost_cap_usd: parseDraftCost(monthlyDraft, monthlyCostCapUsd),
                })
              }
              className="w-[90px] rounded-md border border-border bg-[var(--bg-3)] px-2 py-1.5 text-right font-data text-[11px] text-[var(--text-1)] focus:outline-none focus:ring-1 focus:ring-[var(--clr-cyan)]"
            />
          </div>
        </div>
      )}
    </div>
  );
}
