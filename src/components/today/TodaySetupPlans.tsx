import { useQueries, useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { useIbkrReady } from "@/context/GatewayContext";
import { formatTriggerCondition } from "@/components/triggers/formatTriggerCondition";
import { parallaxApi, type RuleEvaluation, type SetupPlan, type SetupPlanDetail } from "@/modules/parallax/api";
import { useOrbitAccountContext } from "@/orbit/accountContext";
import { useNavigationStore } from "@/store/navigation";
import { evaluationLabel, formatTime, hasCurrentRevision, planGuidance, setupLabel, timeValue } from "./setupPlanPresentation";

function PlanActivity({
  plans,
  scopeReady,
  accountId,
  accountMode,
  sessionEpoch,
  loadPlan,
}: {
  plans: SetupPlan[];
  scopeReady: boolean;
  accountId: string | null;
  accountMode: "paper" | "live" | "unknown";
  sessionEpoch: number;
  loadPlan: (id: number, signal: AbortSignal) => Promise<SetupPlanDetail>;
}) {
  const open = useNavigationStore((state) => state.todayContext.planHistoryOpen ?? false);
  const setTodayContext = useNavigationStore((state) => state.setTodayContext);
  // ponytail: load detail history only on demand; page the API if plan counts grow.
  const histories = useQueries({
    queries: plans.map((plan) => ({
      queryKey: ["parallax", "setup-plan", accountId, accountMode, sessionEpoch, plan.id],
      queryFn: ({ signal }: { signal: AbortSignal }) => loadPlan(plan.id, signal),
      enabled: open && scopeReady,
      staleTime: 0,
      refetchOnMount: "always" as const,
    })),
  });
  const events: { plan: SetupPlanDetail; evaluation: RuleEvaluation | null; at: string; archived: boolean }[] = [];

  if (open) histories.forEach(({ data }) => {
    if (!data) return;
    data.evaluations.filter((evaluation) => evaluation.outcome === "matched" || evaluation.invalidation_outcome === "matched" || evaluation.id === data.latest_evaluation?.id).forEach((evaluation) => events.push({
      plan: data,
      evaluation,
      at: evaluation.checked_at,
      archived: false,
    }));
    if (data.archived_at) events.push({ plan: data, evaluation: null, at: data.archived_at, archived: true });
    else if (!data.evaluations.length) events.push({ plan: data, evaluation: null, at: data.created_at, archived: false });
  });
  events.sort((left, right) => timeValue(right.at) - timeValue(left.at));
  const seen = new Set<string>();
  const grouped = events.filter(({ plan, evaluation, archived }) => {
    const key = `${plan.id}:${evaluation?.plan_revision}:${evaluation?.rule_revision}:${evaluation?.outcome}:${evaluation?.invalidation_outcome}:${!!evaluation?.reviewed_at}:${archived}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });

  return (
    <details open={open} className="workbench-surface workbench-disclosure" onToggle={(event) => { if (event.currentTarget.open !== open) setTodayContext({ planHistoryOpen: event.currentTarget.open }); }}>
      <summary className="cursor-pointer px-3 py-2 text-base font-medium text-[var(--text-2)]">History</summary>
      <div className="border-t border-[var(--border)] px-3 py-2">
        {!scopeReady ? <p role="status" className="text-base text-[var(--text-3)]">Activity is unavailable until the IBKR account is verified.</p>
          : histories.some((history) => history.isLoading) ? <p role="status" className="text-base text-[var(--text-3)]">Loading plan history…</p>
          : histories.some((history) => history.isError) && events.length === 0 ? <p role="alert" className="text-base text-[var(--clr-red)]">Plan history could not be loaded.</p>
          : events.length === 0 ? <p className="text-base text-[var(--text-3)]">No plan activity yet.</p>
          : <ol className="divide-y divide-[var(--border)]">
            {grouped.slice(0, 16).map(({ plan, evaluation, at, archived }, index) => {
              const oldRevisionMatch = evaluation && !hasCurrentRevision(plan, evaluation) &&
                (evaluation.outcome === "matched" || evaluation.invalidation_outcome === "matched");
              const status = archived ? "Tracking stopped · history retained"
                : evaluation ? evaluationLabel(plan, evaluation)
                : plan.monitoring_mode === "manual" ? "Manual review plan saved" : "Plan tracking started";
              return <li key={`${plan.id}-${evaluation?.id ?? status}-${index}`} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2 text-base">
                <span className="min-w-0 text-[var(--text-2)]">
                  <strong className="mr-1 text-[var(--text-1)]">{plan.symbol}</strong>{setupLabel(plan.setup_type)} · {status}
                  {oldRevisionMatch && <span className="ml-1 text-[var(--text-3)]">Not a current match</span>}
                  {evaluation && plan.lifecycle === "archived" && <span className="ml-1 text-[var(--text-3)]">Archived plan history</span>}
                  {evaluation?.reviewed_at && <span className="ml-1 text-[var(--text-3)]">Reviewed</span>}
                </span>
                <time dateTime={at} className="shrink-0 font-data text-[15px] text-[var(--text-3)]">{formatTime(at)}</time>
              </li>;
            })}
          </ol>}
        {histories.some((history) => history.isError) && events.length > 0 &&
          <p role="status" className="mt-2 text-base text-[var(--text-3)]">Some plan history could not be loaded.</p>}
      </div>
    </details>
  );
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
  const selectedPlanId = useNavigationStore((state) => state.todayContext.selectedPlanId);
  const setTodayContext = useNavigationStore((state) => state.setTodayContext);
  const navigateToAnalysis = useNavigationStore((state) => state.navigateToAnalysis);
  const watchingOpen = useNavigationStore((state) => state.todayContext.watchingOpen ?? false);
  const accountMismatch = !!selectedAccountId && !!providerSelectedAccountId && selectedAccountId !== providerSelectedAccountId;
  const scopeReady = !!providerSelectedAccountId && selectedAccountId === providerSelectedAccountId &&
    providerSelectedAccountMode !== "unknown" && !providerScopeLoading && !providerScopeError;
  const listKey = ["parallax", "setup-plans", providerSelectedAccountId, providerSelectedAccountMode, sessionEpoch] as const;
  const query = useQuery({
    queryKey: listKey,
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
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnMount: "always",
    refetchOnReconnect: "always",
    refetchOnWindowFocus: "always",
  });
  const loadPlan = async (id: number, signal: AbortSignal) => {
    const latest = await refetchAccounts();
    const latestSelected = latest?.accounts.find((account) => account.account_id === latest.selected_account_id);
    const latestMode = latestSelected ? latestSelected.is_paper ? "paper" : "live" : "unknown";
    if (latest?.selected_account_id !== providerSelectedAccountId || latestMode !== providerSelectedAccountMode || selectedAccountId !== providerSelectedAccountId) {
      throw new Error("IBKR's selected account changed. Reopen Today after the account context refreshes.");
    }
    return parallaxApi.getSetupPlan(id, signal);
  };
  const plans = query.data ?? [];
  const active = plans.filter((plan) => plan.lifecycle === "active");
  const guided = active.map((plan) => ({ plan, guidance: planGuidance(plan) }));
  const pending = guided.filter(({ guidance }) => guidance.needsAttention)
    .sort((left, right) => left.guidance.priority - right.guidance.priority ||
      timeValue(right.guidance.evidence?.checked_at ?? right.plan.updated_at) - timeValue(left.guidance.evidence?.checked_at ?? left.plan.updated_at));
  const watching = guided.filter(({ guidance }) => !guidance.needsAttention);
  const matchPlans = pending.filter(({ plan }) => plan.unreviewed_match_count > 0).length;
  const monitoringIssues = pending.filter(({ guidance }) => guidance.monitoringIssue).length;
  const row = ({ plan, guidance }: typeof guided[number]) => <button
    key={plan.id} type="button" aria-label={`Open ${plan.symbol} ${setupLabel(plan.setup_type)} plan ${plan.id}`}
    aria-current={selectedPlanId === plan.id ? "location" : undefined}
    onClick={() => { setTodayContext({ selectedPlanId: plan.id }); navigateToAnalysis(plan.conid, plan.symbol, plan.id); }}
    className={`today-plan-row ${selectedPlanId === plan.id ? "today-plan-selected" : ""}`}
  >
    <span className="today-plan-identity">
      <strong className="text-xl font-semibold text-[var(--text-1)]">{plan.symbol}</strong>
      <span className="text-[15px] text-[var(--text-2)]">{setupLabel(plan.setup_type)}{plan.rule && ` · ${plan.rule.timeframe}`}</span>
      <span className="workbench-status" data-tone={guidance.tone}>{guidance.label}</span>
    </span>
    <span className="today-plan-copy">
      <strong className="font-medium text-[var(--text-1)]">{guidance.change}</strong>
      <span className="text-[var(--text-2)]">{guidance.review}</span>
      {guidance.evidence ? <span className="today-plan-evidence">
        {guidance.evidenceText && <span>{guidance.evidenceText} · </span>}
        <span>{guidance.evidenceText ? "Evidence" : "Latest attempt"} </span>
        <time dateTime={guidance.evidenceText ? guidance.evidence.evidence_at ?? guidance.evidence.checked_at : guidance.evidence.checked_at}>{formatTime(guidance.evidenceText ? guidance.evidence.evidence_at ?? guidance.evidence.checked_at : guidance.evidence.checked_at)}</time>
        {guidance.monitoringIssue && !plan.unreviewed_match_count && guidance.evidenceText && <span> · Historical check; current status unknown</span>}
      </span> : plan.rule && <span className="today-plan-evidence">Saved check: {plan.rule.conditions.map(formatTriggerCondition).join(" · ") || "Conditions unavailable"}</span>}
      {guidance.latestNote && <span className="text-[15px] text-[var(--text-2)]">{guidance.latestNote}</span>}
      {guidance.monitoringIssue && plan.unreviewed_match_count > 0 && <span className="text-[15px] text-[var(--clr-orange)]">{guidance.monitoring} · Earlier alert retained; current status unknown</span>}
    </span>
    <ChevronRight size={20} aria-hidden="true" className="today-plan-arrow" />
  </button>;

  return <section aria-label="Tracked setup plans" className="space-y-3 text-base">
    {!ibkrReady ? <p role="status">Connect to IBKR to load setup plans.</p>
      : providerScopeLoading ? <p role="status">Checking the selected IBKR account…</p>
      : providerScopeError ? <div><p role="alert">Could not verify IBKR’s selected account.</p><button type="button" onClick={() => void refetchAccounts().catch(() => {})} className="underline">Retry</button></div>
      : accountMismatch ? <p role="alert" className="text-[var(--clr-orange)]">MoonMarket is set to {selectedAccountId}, but IBKR is using {providerSelectedAccountId}. Change the MoonMarket selection to load tracked setups.</p>
      : !providerSelectedAccountId || providerSelectedAccountMode === "unknown" ? <p role="status">No provider-selected IBKR account is available.</p>
      : !scopeReady ? <p role="status">Waiting for the MoonMarket account selection to match IBKR…</p>
      : query.isLoading ? <p role="status">Loading tracked setups…</p>
      : query.isError && !query.data ? <div><p role="alert">Tracked setups are unavailable.</p><button type="button" onClick={() => void query.refetch()} className="underline">Retry</button></div>
      : <>
        {query.isError && <p role="status" className="text-[var(--clr-orange)]">Refresh failed. Showing the last saved plan state.</p>}
        {!active.length ? <div className="py-4"><h2 className="text-lg font-semibold">No tracked setups yet</h2><p className="mt-2 text-[var(--text-2)]">Choose a name in Names and save your plan in Analysis.</p></div> : <>
          <section aria-label="Needs review">
            <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-lg font-semibold text-[var(--text-1)]">{pending.length ? `Needs your attention · ${pending.length}` : "No unreviewed matches"}</h2>
              {pending.length > 0 && <span className="text-[15px] text-[var(--text-2)]">{matchPlans} {matchPlans === 1 ? "plan with matches" : "plans with matches"} · {monitoringIssues} monitoring {monitoringIssues === 1 ? "issue" : "issues"}</span>}
            </div>
            {pending.length ? <div className="workbench-surface mt-3">{pending.map(row)}</div> : <p className="mt-2 text-[var(--text-2)]">{active.some((plan) => plan.monitoring_mode === "automatic") && !query.isError ? "Automatic checks are current. Your plans remain under Watching." : "Open Watching to review your saved plans."}</p>}
            {pending.length > 0 && <p className="mt-2 text-[15px] text-[var(--text-2)]">Matches use your saved conditions. Review the full plan in Analysis.</p>}
          </section>
          <details open={watchingOpen} onToggle={(event) => { if (event.currentTarget.open !== watchingOpen) setTodayContext({ watchingOpen: event.currentTarget.open }); }} className="workbench-surface workbench-disclosure">
            <summary className="cursor-pointer py-2 text-base font-medium">Watching · {watching.length}</summary><section aria-label="Watching">{watching.map(row)}</section>
          </details>
        </>}
        <PlanActivity plans={plans} scopeReady={scopeReady} accountId={providerSelectedAccountId} accountMode={providerSelectedAccountMode} sessionEpoch={sessionEpoch} loadPlan={loadPlan} />
      </>}
  </section>;
}
