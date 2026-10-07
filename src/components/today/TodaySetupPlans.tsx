import { useQuery } from "@tanstack/react-query";
import { useIbkrReady } from "@/context/GatewayContext";
import { parallaxApi, type SetupPlan } from "@/modules/parallax/api";
import { useOrbitAccountContext } from "@/orbit/accountContext";
import { useNavigationStore } from "@/store/navigation";

function setupLabel(type: SetupPlan["setup_type"]): string {
  return type === "breakout_retest" ? "Breakout retest" : type === "pullback" ? "Pullback" : "Breakout";
}

function monitoringLabel(plan: SetupPlan): string {
  if (plan.monitoring_mode === "manual") return "Manual review";
  return {
    not_monitored: "Not monitored",
    not_checked: "Awaiting first check",
    healthy: "Monitoring",
    unavailable: "Check unavailable",
    overdue: "Check overdue",
  }[plan.monitoring_health];
}

export function TodaySetupPlans() {
  const ibkrReady = useIbkrReady();
  const {
    selectedAccountId,
    providerSelectedAccountId,
    providerSelectedAccountMode,
    providerScopeLoading,
    providerScopeError,
    refetchAccounts,
  } = useOrbitAccountContext();
  const sessionEpoch = useNavigationStore((state) => state.namesContext.brokerSessionEpoch);
  const navigateToAnalysis = useNavigationStore((state) => state.navigateToAnalysis);
  const accountMismatch = !!selectedAccountId && !!providerSelectedAccountId && selectedAccountId !== providerSelectedAccountId;
  const scopeReady = !!providerSelectedAccountId && selectedAccountId === providerSelectedAccountId &&
    providerSelectedAccountMode !== "unknown" && !providerScopeLoading && !providerScopeError;
  const query = useQuery({
    queryKey: ["parallax", "setup-plans", providerSelectedAccountId, providerSelectedAccountMode, sessionEpoch],
    queryFn: async ({ signal }) => {
      const latest = await refetchAccounts();
      const latestSelected = latest?.accounts.find((account) => account.account_id === latest.selected_account_id);
      const latestMode = latestSelected ? latestSelected.is_paper ? "paper" : "live" : "unknown";
      if (latest?.selected_account_id !== providerSelectedAccountId || latestMode !== providerSelectedAccountMode || selectedAccountId !== providerSelectedAccountId) {
        throw new Error("IBKR's selected account changed. Refresh the account context before loading tracked setups.");
      }
      return parallaxApi.getSetupPlans(signal);
    },
    enabled: ibkrReady && scopeReady,
    retry: false,
    staleTime: 15_000,
    refetchOnMount: "always",
  });
  const activePlans = (query.data ?? []).filter((plan) => plan.lifecycle === "active");

  return (
    <section aria-label="Tracked setups" className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] font-semibold text-[var(--text-1)]">Tracked setups</h2>
        {scopeReady && query.data && <span className="font-data text-[10px] text-[var(--text-3)]">{activePlans.length}</span>}
      </div>
      {!ibkrReady ? <p role="status" className="text-[10px] text-[var(--text-3)]">Connect to IBKR to load setup plans.</p>
        : providerScopeLoading ? <p role="status" className="text-[10px] text-[var(--text-3)]">Checking the selected IBKR account…</p>
        : providerScopeError ? <div className="flex items-center justify-between gap-2"><p role="alert" className="text-[10px] text-[var(--clr-red)]">Could not verify IBKR’s selected account.</p><button type="button" onClick={() => void refetchAccounts().catch(() => {})} className="text-[10px] underline">Retry</button></div>
        : accountMismatch ? <p role="alert" className="text-[10px] text-[var(--clr-orange)]">MoonMarket is set to {selectedAccountId}, but IBKR is using {providerSelectedAccountId}. Change the MoonMarket selection to load tracked setups.</p>
        : !providerSelectedAccountId || providerSelectedAccountMode === "unknown" ? <p role="status" className="text-[10px] text-[var(--text-3)]">No provider-selected IBKR account is available.</p>
        : !scopeReady ? <p role="status" className="text-[10px] text-[var(--text-3)]">Waiting for the MoonMarket account selection to match IBKR…</p>
        : query.isFetching ? <p role="status" className="text-[10px] text-[var(--text-3)]">Loading tracked setups…</p>
        : query.isError ? <div className="flex items-center justify-between gap-2"><p role="alert" className="text-[10px] text-[var(--clr-red)]">Tracked setups are unavailable.</p><button type="button" onClick={() => void query.refetch()} className="text-[10px] underline">Retry</button></div>
        : !activePlans.length ? <p role="status" className="rounded border border-dashed border-border px-3 py-3 text-[10px] text-[var(--text-3)]">No tracked setups yet. Plans saved in Analysis appear here.</p>
        : <div className="flex flex-col divide-y divide-[var(--border)] rounded border border-[var(--border)]">
          {activePlans.map((plan) => <button key={plan.id} type="button" aria-label={`Open ${plan.symbol} ${setupLabel(plan.setup_type)} plan ${plan.id}`} onClick={() => navigateToAnalysis(plan.conid, plan.symbol, plan.id)} className="flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-[var(--bg-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--clr-cyan)]">
            <span className="min-w-0"><span className="mr-2 font-semibold text-[var(--text-1)]">{plan.symbol}</span><span className="text-[10px] text-[var(--text-3)]">{setupLabel(plan.setup_type)}</span></span>
            <span className="shrink-0 text-[10px] text-[var(--text-2)]">{monitoringLabel(plan)}</span>
          </button>)}
        </div>}
    </section>
  );
}
