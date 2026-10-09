import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useIbkrReady } from "@/context/GatewayContext";
import { formatTriggerCondition, formatTriggerConditionValue } from "@/components/triggers/formatTriggerCondition";
import { parallaxApi, type RuleEvaluation, type SetupPlan, type SetupPlanDetail } from "@/modules/parallax/api";
import { useAccountStore, useOrbitAccountContext } from "@/orbit/accountContext";
import { useNavigationStore, type TodayPlanFilter } from "@/store/navigation";

type SetupPlanRequestScope = {
  accountId: string;
  accountMode: "paper" | "live";
  selectedAccountId: string;
  sessionEpoch: number;
};

function setupLabel(type: SetupPlan["setup_type"]): string {
  return type === "breakout_retest" ? "Breakout retest" : type === "pullback" ? "Pullback" : "Breakout";
}

function timeValue(value: string): number {
  const qualified = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  return Date.parse(qualified ? value : `${value.replace(" ", "T")}Z`);
}

function formatTime(value: string | null): string {
  if (!value) return "Time unavailable";
  const date = new Date(timeValue(value));
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function hasCurrentRevision(plan: SetupPlan, evaluation: RuleEvaluation): boolean {
  return evaluation.plan_revision === plan.revision &&
    evaluation.rule_id === plan.rule?.id && evaluation.rule_revision === plan.rule?.revision;
}

function isCurrentEvaluation(plan: SetupPlan, evaluation: RuleEvaluation): boolean {
  return plan.lifecycle === "active" && hasCurrentRevision(plan, evaluation);
}

function isUnreviewedMatch(plan: SetupPlan, evaluation: RuleEvaluation): boolean {
  return isCurrentEvaluation(plan, evaluation) && evaluation.reviewed_at == null &&
    (evaluation.outcome === "matched" || evaluation.invalidation_outcome === "matched");
}

function evaluationLabel(plan: SetupPlan, evaluation: RuleEvaluation): string {
  const result = evaluation.outcome === "matched" ? "Waiting condition matched"
    : evaluation.invalidation_outcome === "matched" ? "Invalidation condition matched"
    : evaluation.outcome === "not_matched" ? "No match"
    : evaluation.outcome === "unavailable" ? "Check unavailable" : "Check failed";
  return `${hasCurrentRevision(plan, evaluation) ? "" : "Previous revision · "}${result}`;
}

function monitoringLabel(plan: SetupPlan): string {
  return {
    not_monitored: "Not monitored",
    not_checked: "Awaiting first check",
    healthy: "Monitoring current",
    unavailable: "Monitoring unavailable",
    overdue: "Monitoring overdue",
  }[plan.monitoring_health];
}

function currentMatchEvaluations(plan: SetupPlanDetail): RuleEvaluation[] {
  return plan.unreviewed_matches.filter((evaluation) => isUnreviewedMatch(plan, evaluation));
}

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
  const [open, setOpen] = useState(false);
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
    data.evaluations.forEach((evaluation) => events.push({
      plan: data,
      evaluation,
      at: evaluation.checked_at,
      archived: false,
    }));
    if (data.archived_at) events.push({ plan: data, evaluation: null, at: data.archived_at, archived: true });
    else if (!data.evaluations.length) events.push({ plan: data, evaluation: null, at: data.created_at, archived: false });
  });
  events.sort((left, right) => timeValue(right.at) - timeValue(left.at));

  return (
    <details className="rounded border border-[var(--border)]" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-[var(--text-2)]">Recent activity</summary>
      <div className="border-t border-[var(--border)] px-3 py-2">
        {!scopeReady ? <p role="status" className="text-sm text-[var(--text-3)]">Activity is unavailable until the IBKR account is verified.</p>
          : histories.some((history) => history.isLoading) ? <p role="status" className="text-sm text-[var(--text-3)]">Loading plan history…</p>
          : histories.some((history) => history.isError) && events.length === 0 ? <p role="alert" className="text-sm text-[var(--clr-red)]">Plan history could not be loaded.</p>
          : events.length === 0 ? <p className="text-sm text-[var(--text-3)]">No plan activity yet.</p>
          : <ol className="divide-y divide-[var(--border)]">
            {events.slice(0, 16).map(({ plan, evaluation, at, archived }, index) => {
              const oldRevisionMatch = evaluation && !hasCurrentRevision(plan, evaluation) &&
                (evaluation.outcome === "matched" || evaluation.invalidation_outcome === "matched");
              const status = archived ? "Tracking stopped · history retained"
                : evaluation ? evaluationLabel(plan, evaluation)
                : plan.monitoring_mode === "manual" ? "Manual review plan saved" : "Plan tracking started";
              return <li key={`${plan.id}-${evaluation?.id ?? status}-${index}`} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2 text-sm">
                <span className="min-w-0 text-[var(--text-2)]">
                  <strong className="mr-1 text-[var(--text-1)]">{plan.symbol}</strong>{setupLabel(plan.setup_type)} · {status}
                  {oldRevisionMatch && <span className="ml-1 text-[var(--text-3)]">Not a current match</span>}
                  {evaluation && plan.lifecycle === "archived" && <span className="ml-1 text-[var(--text-3)]">Archived plan history</span>}
                  {evaluation?.reviewed_at && <span className="ml-1 text-[var(--text-3)]">Reviewed</span>}
                </span>
                <time dateTime={at} className="shrink-0 font-data text-xs text-[var(--text-3)]">{formatTime(at)}</time>
              </li>;
            })}
          </ol>}
        {histories.some((history) => history.isError) && events.length > 0 &&
          <p role="status" className="mt-2 text-sm text-[var(--text-3)]">Some plan history could not be loaded.</p>}
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
  const filter = useNavigationStore((state) => state.todayContext.planFilter);
  const selectedPlanId = useNavigationStore((state) => state.todayContext.selectedPlanId);
  const setTodayContext = useNavigationStore((state) => state.setTodayContext);
  const navigateToAnalysis = useNavigationStore((state) => state.navigateToAnalysis);
  const [reviewingPlanId, setReviewingPlanId] = useState<number | null>(null);
  const activeFilterButtonRef = useRef<HTMLButtonElement>(null);
  const queryClient = useQueryClient();
  const accountMismatch = !!selectedAccountId && !!providerSelectedAccountId && selectedAccountId !== providerSelectedAccountId;
  const scopeReady = !!providerSelectedAccountId && selectedAccountId === providerSelectedAccountId &&
    providerSelectedAccountMode !== "unknown" && !providerScopeLoading && !providerScopeError;
  const listKey = ["parallax", "setup-plans", providerSelectedAccountId, providerSelectedAccountMode, sessionEpoch] as const;
  const requestScopeRef = useRef<SetupPlanRequestScope | null>(null);
  requestScopeRef.current = scopeReady && providerSelectedAccountId && selectedAccountId
    ? { accountId: providerSelectedAccountId, accountMode: providerSelectedAccountMode as "paper" | "live", selectedAccountId, sessionEpoch }
    : null;
  const isCurrentRequestScope = (scope: SetupPlanRequestScope) => {
    const current = requestScopeRef.current;
    const selectedAccount = useAccountStore.getState().selectedAccount();
    const selectedMode = selectedAccount ? selectedAccount.is_paper ? "paper" : "live" : "unknown";
    return current?.accountId === scope.accountId && current.accountMode === scope.accountMode &&
      current.selectedAccountId === scope.selectedAccountId && current.sessionEpoch === scope.sessionEpoch &&
      useNavigationStore.getState().namesContext.brokerSessionEpoch === scope.sessionEpoch &&
      useAccountStore.getState().selectedAccountId === scope.selectedAccountId && selectedMode === scope.accountMode;
  };
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
  const detailQuery = useQuery({
    queryKey: ["parallax", "setup-plan", providerSelectedAccountId, providerSelectedAccountMode, sessionEpoch, reviewingPlanId],
    queryFn: ({ signal }) => loadPlan(reviewingPlanId!, signal),
    enabled: ibkrReady && scopeReady && reviewingPlanId !== null,
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnReconnect: "always",
    refetchOnWindowFocus: "always",
  });
  const reviewingPlanIdRef = useRef(reviewingPlanId);
  reviewingPlanIdRef.current = reviewingPlanId;
  const reviewMutation = useMutation({
    mutationFn: ({ id, evaluationIds }: { id: number; evaluationIds: number[]; scope: SetupPlanRequestScope }) => parallaxApi.reviewSetupPlan(id, evaluationIds),
    onSuccess: async (plan, variables) => {
      if (!isCurrentRequestScope(variables.scope)) return;
      queryClient.setQueryData(["parallax", "setup-plan", variables.scope.accountId, variables.scope.accountMode, variables.scope.sessionEpoch, plan.id], plan);
      queryClient.setQueryData<SetupPlan[]>(listKey, (plans) => plans?.map((current) => current.id === plan.id ? { ...current, ...plan } : current));
      await queryClient.invalidateQueries({ queryKey: listKey });
      if (!isCurrentRequestScope(variables.scope)) return;
      if (reviewingPlanIdRef.current === variables.id) setReviewingPlanId(null);
      activeFilterButtonRef.current?.focus();
    },
  });
  const archiveMutation = useMutation({
    mutationFn: ({ id }: { id: number; scope: SetupPlanRequestScope }) => parallaxApi.archiveSetupPlan(id),
    onSuccess: async (plan, variables) => {
      if (!isCurrentRequestScope(variables.scope)) return;
      queryClient.setQueryData(["parallax", "setup-plan", variables.scope.accountId, variables.scope.accountMode, variables.scope.sessionEpoch, plan.id], plan);
      queryClient.setQueryData<SetupPlan[]>(listKey, (plans) => plans?.map((current) => current.id === plan.id ? { ...current, ...plan } : current));
      await queryClient.invalidateQueries({ queryKey: listKey });
      if (!isCurrentRequestScope(variables.scope)) return;
      if (useNavigationStore.getState().todayContext.selectedPlanId === variables.id) setTodayContext({ selectedPlanId: null });
      if (reviewingPlanIdRef.current === variables.id) setReviewingPlanId(null);
      activeFilterButtonRef.current?.focus();
    },
  });
  const plans = query.data ?? [];
  const activePlans = plans.filter((plan) => plan.lifecycle === "active");
  const needsReview = activePlans.filter((plan) => plan.unreviewed_match_count > 0);
  const watching = activePlans.filter((plan) => plan.unreviewed_match_count === 0);
  const visibleReview = filter !== "watching";
  const visibleWatching = filter !== "review";
  const detailMatches = detailQuery.data ? currentMatchEvaluations(detailQuery.data) : [];
  const openAnalysis = (plan: SetupPlan) => {
    setTodayContext({ selectedPlanId: plan.id });
    navigateToAnalysis(plan.conid, plan.symbol, plan.id);
  };
  const stopTracking = (planId: number) => {
    const scope = requestScopeRef.current;
    if (scope && window.confirm("Stop tracking this plan? Automatic monitoring will stop. The plan and its history will be retained.")) archiveMutation.mutate({ id: planId, scope });
  };
  const filterOptions: [TodayPlanFilter, string][] = [["all", "All active"], ["review", "Needs review"], ["watching", "Watching"]];

  return (
    <section aria-label="Tracked setup plans" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-base font-semibold text-[var(--text-1)]">Tracked setups</h2>
        </div>
        <div role="group" aria-label="Filter tracked setups" className="flex gap-1">
          {filterOptions.map(([value, label]) => <button
            key={value}
            type="button"
            ref={filter === value ? activeFilterButtonRef : undefined}
            aria-pressed={filter === value}
            onClick={() => setTodayContext({ planFilter: value })}
            className={`rounded-full border px-2 py-0.5 text-xs ${filter === value ? "border-[var(--clr-cyan)] bg-[var(--bg-3)] text-[var(--clr-cyan)]" : "border-border bg-[var(--bg-1)] text-[var(--text-3)]"}`}
          >{label}</button>)}
        </div>
      </div>
      {!ibkrReady ? <p role="status" className="text-sm text-[var(--text-3)]">Connect to IBKR to load setup plans.</p>
        : providerScopeLoading ? <p role="status" className="text-sm text-[var(--text-3)]">Checking the selected IBKR account…</p>
        : providerScopeError ? <div className="flex items-center justify-between gap-2"><p role="alert" className="text-sm text-[var(--clr-red)]">Could not verify IBKR’s selected account.</p><button type="button" onClick={() => void refetchAccounts().catch(() => {})} className="text-sm underline">Retry</button></div>
        : accountMismatch ? <p role="alert" className="text-sm text-[var(--clr-orange)]">MoonMarket is set to {selectedAccountId}, but IBKR is using {providerSelectedAccountId}. Change the MoonMarket selection to load tracked setups.</p>
        : !providerSelectedAccountId || providerSelectedAccountMode === "unknown" ? <p role="status" className="text-sm text-[var(--text-3)]">No provider-selected IBKR account is available.</p>
        : !scopeReady ? <p role="status" className="text-sm text-[var(--text-3)]">Waiting for the MoonMarket account selection to match IBKR…</p>
        : query.isFetching && !query.data ? <p role="status" className="text-sm text-[var(--text-3)]">Loading tracked setups…</p>
        : query.isError && !query.data ? <div className="flex items-center justify-between gap-2"><p role="alert" className="text-sm text-[var(--clr-red)]">Tracked setups are unavailable.</p><button type="button" onClick={() => void query.refetch()} className="text-sm underline">Retry</button></div>
        : <>
          {query.isError && <p role="status" className="text-sm text-[var(--clr-orange)]">Refresh failed. Showing the last saved plan state.</p>}
          {query.isFetching && query.data && <p role="status" className="text-xs text-[var(--text-3)]">Refreshing saved plan state…</p>}
          {!activePlans.length ? <div className="space-y-2 rounded border border-dashed border-border p-3"><p role="status" className="text-sm text-[var(--text-2)]">No tracked setups yet. Plans saved in Analysis appear here.</p><button type="button" onClick={() => useNavigationStore.getState().navigate("screener")} className="rounded bg-[var(--clr-cyan)] px-3 py-2 text-sm font-semibold text-[var(--bg-0)]">Explore names</button></div>
            : <div className="flex flex-col rounded border border-[var(--border)]">
              {visibleReview && <section aria-label="Needs review">
                <div className="flex items-baseline justify-between gap-2 border-b border-[var(--border)] px-3 py-2">
                  <h3 className="text-sm font-semibold text-[var(--text-1)]">Needs review <span className="ml-1 font-data text-[var(--text-3)]">{needsReview.length}</span></h3>
                  <span className="text-xs text-[var(--text-3)]">A matched condition needs your judgment.</span>
                </div>
                {needsReview.map((plan) => {
                  const latest = plan.latest_evaluation;
                  const isReviewing = reviewingPlanId === plan.id;
                  return <article key={plan.id} aria-current={selectedPlanId === plan.id ? "location" : undefined} className={`border-b border-[var(--border)] p-3 last:border-0 ${selectedPlanId === plan.id ? "bg-[var(--bg-2)]" : ""}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                          <h4 className="text-base font-semibold text-[var(--text-1)]">{plan.symbol}</h4>
                          <span className="text-sm text-[var(--text-3)]">{setupLabel(plan.setup_type)}</span>
                          <span className="rounded border border-[var(--clr-orange)]/40 px-1.5 py-0.5 text-xs text-[var(--clr-orange)]">Needs review</span>
                          <span className="rounded border border-[var(--border)] px-1.5 py-0.5 text-xs text-[var(--text-3)]">{monitoringLabel(plan)}</span>
                        </div>
                        <p className="mt-1 text-sm leading-relaxed text-[var(--text-2)]"><span className="text-[var(--text-3)]">Waiting for</span> {plan.waiting_intention}</p>
                        {plan.monitoring_mode === "manual" ? <p className="mt-1 text-sm text-[var(--text-3)]">Manual review</p>
                          : <p className="mt-1 text-sm text-[var(--text-3)]"><span className="text-[var(--text-2)]">Condition</span> {plan.rule?.conditions.map(formatTriggerCondition).join(" · ") || "Unavailable"}{plan.rule && ` · ${plan.rule.timeframe}`}</p>}
                        {latest && <div className="mt-1 text-sm text-[var(--text-2)]">
                          <p><span className="text-[var(--text-3)]">Latest check</span> {evaluationLabel(plan, latest)} · {formatTime(latest.checked_at)}</p>
                          {latest.failure_message && <p role="status" className="text-xs text-[var(--clr-orange)]">{latest.failure_message}</p>}
                          {latest.evidence_at && <p className="text-xs text-[var(--text-3)]">Latest available candle · {formatTime(latest.evidence_at)} · may be forming</p>}
                          {latest.condition_values.length > 0 && <p className="break-words text-xs text-[var(--text-3)]">{latest.condition_values.map(formatTriggerConditionValue).join(" · ")}</p>}
                        </div>}
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-1">
                        <button type="button" aria-label={`Review chart for ${plan.symbol} ${setupLabel(plan.setup_type)} plan ${plan.id}`} onClick={() => openAnalysis(plan)} className="rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-2)] hover:bg-[var(--bg-3)]">Open chart</button>
                        <button type="button" aria-expanded={isReviewing} onClick={() => { setTodayContext({ selectedPlanId: plan.id }); setReviewingPlanId(isReviewing ? null : plan.id); reviewMutation.reset(); }} className="rounded bg-[var(--clr-cyan)] px-2 py-1 text-xs font-semibold text-[var(--bg-0)]">{isReviewing ? "Close review" : "Review alert"}</button>
                      </div>
                    </div>
                    {isReviewing && <section aria-label={`Review ${plan.symbol} alert`} className="mt-3 rounded border border-[var(--border)] bg-[var(--bg-1)] p-2.5">
                      {detailQuery.isFetching ? <p role="status" className="text-sm text-[var(--text-3)]">Loading matched evidence…</p>
                        : detailQuery.isError ? <div className="flex items-center justify-between gap-2"><p role="alert" className="text-sm text-[var(--clr-red)]">Matched evidence could not be loaded.</p><button type="button" onClick={() => void detailQuery.refetch()} className="text-sm underline">Retry</button></div>
                        : detailQuery.data && detailMatches.length ? <>
                          <p className="text-sm font-medium text-[var(--text-1)]">Review the matched evidence</p>
                          <ul className="mt-1 space-y-1 text-xs text-[var(--text-2)]">
                            {detailMatches.map((evaluation) => <li key={evaluation.id}>
                              {evaluation.condition_values.map(formatTriggerConditionValue).join(" · ") || evaluationLabel(detailQuery.data!, evaluation)}
                              <span className="ml-1 text-[var(--text-3)]">{formatTime(evaluation.evidence_at ?? evaluation.checked_at)}</span>
                            </li>)}
                          </ul>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <button type="button" disabled={reviewMutation.isPending} onClick={() => {
                              const scope = requestScopeRef.current;
                              if (scope) reviewMutation.mutate({ id: plan.id, evaluationIds: detailMatches.map((evaluation) => evaluation.id), scope });
                            }} className="rounded bg-[var(--clr-cyan)] px-2 py-1 text-xs font-semibold text-[var(--bg-0)] disabled:opacity-50">{reviewMutation.isPending ? "Saving…" : "Keep watching"}</button>
                            <button type="button" onClick={() => openAnalysis(plan)} className="rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-2)]">Revise plan</button>
                            <button type="button" disabled={archiveMutation.isPending} onClick={() => stopTracking(plan.id)} className="rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-2)] disabled:opacity-50">Stop tracking</button>
                          </div>
                          {reviewMutation.isError && <div className="mt-2 flex flex-wrap items-center gap-2"><p role="alert" className="text-sm text-[var(--clr-red)]">The review was not saved.</p><button type="button" onClick={() => { void detailQuery.refetch(); void query.refetch(); }} className="text-sm underline">Refresh evidence</button></div>}
                          {archiveMutation.isError && archiveMutation.variables?.id === plan.id && <p role="alert" className="mt-2 text-sm text-[var(--clr-red)]">Tracking could not be stopped. Plan history is unchanged.</p>}
                        </>
                        : detailQuery.data ? <div className="flex flex-wrap items-center justify-between gap-2"><p role="status" className="text-sm text-[var(--text-3)]">No current matched events were found in the loaded plan history.</p><button type="button" onClick={() => void detailQuery.refetch()} className="text-sm underline">Refresh evidence</button></div>
                        : <p role="status" className="text-sm text-[var(--text-3)]">Waiting for matched evidence…</p>}
                    </section>}
                  </article>;
                })}
                {!needsReview.length && <p className="px-3 py-2 text-sm text-[var(--text-3)]">No unreviewed current-revision matches.</p>}
              </section>}
              {visibleWatching && <section aria-label="Watching">
                <div className="flex items-baseline justify-between gap-2 border-b border-[var(--border)] px-3 py-2">
                  <h3 className="text-sm font-semibold text-[var(--text-1)]">Watching <span className="ml-1 font-data text-[var(--text-3)]">{watching.length}</span></h3>
                  <span className="text-xs text-[var(--text-3)]">Active plans without an unreviewed current match.</span>
                </div>
                {watching.map((plan) => {
                  const latest = plan.latest_evaluation;
                  return <article key={plan.id} aria-current={selectedPlanId === plan.id ? "location" : undefined} className={`border-b border-[var(--border)] p-3 last:border-0 ${selectedPlanId === plan.id ? "bg-[var(--bg-2)]" : ""}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                          <h4 className="text-base font-semibold text-[var(--text-1)]">{plan.symbol}</h4>
                          <span className="text-sm text-[var(--text-3)]">{setupLabel(plan.setup_type)}</span>
                          <span className="rounded border border-[var(--border)] px-1.5 py-0.5 text-xs text-[var(--text-2)]">Watching</span>
                          <span className="rounded border border-[var(--border)] px-1.5 py-0.5 text-xs text-[var(--text-3)]">{monitoringLabel(plan)}</span>
                          {plan.monitoring_mode === "manual" && <span className="rounded border border-[var(--border)] px-1.5 py-0.5 text-xs text-[var(--text-2)]">Manual review</span>}
                        </div>
                        <p className="mt-1 text-sm leading-relaxed text-[var(--text-2)]"><span className="text-[var(--text-3)]">Waiting for</span> {plan.waiting_intention}</p>
                        {plan.monitoring_mode === "automatic" && <p className="mt-1 text-sm text-[var(--text-3)]"><span className="text-[var(--text-2)]">Condition</span> {plan.rule?.conditions.map(formatTriggerCondition).join(" · ") || "Unavailable"}{plan.rule && ` · ${plan.rule.timeframe}`}</p>}
                        {plan.monitoring_mode === "manual" ? <p className="mt-1 text-sm text-[var(--text-3)]">Review this plan in Analysis when you are ready.</p>
                          : latest ? <div className="mt-1 text-sm text-[var(--text-2)]">
                            <p><span className="text-[var(--text-3)]">Latest check</span> {evaluationLabel(plan, latest)} · {formatTime(latest.checked_at)}</p>
                            {latest.failure_message && <p role="status" className="text-xs text-[var(--clr-orange)]">{latest.failure_message}</p>}
                          {latest.evidence_at && <p className="text-xs text-[var(--text-3)]">Latest available candle · {formatTime(latest.evidence_at)} · may be forming</p>}
                            {latest.condition_values.length > 0 && <p className="break-words text-xs text-[var(--text-3)]">{latest.condition_values.map(formatTriggerConditionValue).join(" · ")}</p>}
                          </div> : <p className="mt-1 text-sm text-[var(--text-3)]">Awaiting first check.</p>}
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-1">
                        <button type="button" aria-label={`Open ${plan.symbol} ${setupLabel(plan.setup_type)} plan ${plan.id}`} onClick={() => openAnalysis(plan)} className="rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-2)] hover:bg-[var(--bg-3)]">Open chart</button>
                        <button type="button" disabled={archiveMutation.isPending} onClick={() => stopTracking(plan.id)} className="rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-3)] disabled:opacity-50">Stop tracking</button>
                      </div>
                    </div>
                    {archiveMutation.isError && archiveMutation.variables?.id === plan.id && <p role="alert" className="mt-2 text-sm text-[var(--clr-red)]">Tracking could not be stopped. Plan history is unchanged.</p>}
                  </article>;
                })}
                {!watching.length && <p className="px-3 py-2 text-sm text-[var(--text-3)]">No other active plans.</p>}
              </section>}
            </div>}
          <PlanActivity plans={plans} scopeReady={scopeReady} accountId={providerSelectedAccountId} accountMode={providerSelectedAccountMode} sessionEpoch={sessionEpoch} loadPlan={loadPlan} />
        </>}
    </section>
  );
}
