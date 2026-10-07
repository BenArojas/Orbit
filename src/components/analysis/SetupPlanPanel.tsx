import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useIbkrReady } from "@/context/GatewayContext";
import { parallaxApi, type SetupPlan, type SetupPlanCreate, type SetupPlanDetail, type SetupPlanTimeframe, type SetupPlanUpdate, type TriggerCondition } from "@/modules/parallax/api";
import { useOrbitAccountContext } from "@/orbit/accountContext";
import { ApiError } from "@/lib/sidecarClient";
import { useNavigationStore } from "@/store/navigation";
import { ConditionsList } from "@/components/triggers/ConditionsList";

type SetupPlanDraft = {
  setup_type: SetupPlan["setup_type"];
  waiting_intention: string;
  monitoring_mode: SetupPlan["monitoring_mode"];
  invalidation_reference: string;
  timeframe: SetupPlanTimeframe;
  scan_interval_seconds: number;
  conditions: TriggerCondition[];
};

type SaveToken = {
  accountId: string;
  accountMode: "paper" | "live";
  selectedAccountId: string;
  sessionEpoch: number;
  planId: number | null;
};

const blankDraft = (): SetupPlanDraft => ({
  setup_type: "pullback",
  waiting_intention: "",
  monitoring_mode: "manual",
  invalidation_reference: "",
  timeframe: "1D",
  scan_interval_seconds: 300,
  conditions: [],
});

function draftFromPlan(plan: SetupPlanDetail): SetupPlanDraft {
  return {
    setup_type: plan.setup_type,
    waiting_intention: plan.waiting_intention,
    monitoring_mode: plan.monitoring_mode,
    invalidation_reference: plan.invalidation_reference ?? "",
    timeframe: plan.rule?.timeframe ?? "1D",
    scan_interval_seconds: plan.rule?.scan_interval_seconds ?? 300,
    conditions: plan.rule?.conditions ?? [],
  };
}

function validConditions(conditions: TriggerCondition[]): boolean {
  return conditions.length > 0 && conditions.every((condition) =>
    condition.indicator === "news_candle"
      ? condition.condition === "fires" && !!condition.news_candle_method
      : condition.condition !== "fires" && condition.threshold != null && Number.isFinite(condition.threshold),
  );
}

function sameToken(left: SaveToken | null, right: SaveToken): boolean {
  return !!left && left.accountId === right.accountId && left.accountMode === right.accountMode &&
    left.selectedAccountId === right.selectedAccountId && left.sessionEpoch === right.sessionEpoch && left.planId === right.planId;
}

export function useSetupPlanEditor(conid: number | null) {
  const ibkrReady = useIbkrReady();
  const {
    selectedAccountId,
    providerSelectedAccountId,
    providerSelectedAccountMode,
    providerScopeLoading,
    providerScopeError,
    refetchAccounts,
  } = useOrbitAccountContext();
  const planId = useNavigationStore((state) => state.analysisContext.setupPlanId);
  const sessionEpoch = useNavigationStore((state) => state.namesContext.brokerSessionEpoch);
  const setDirty = useNavigationStore((state) => state.setAnalysisDraftDirty);
  const setPlanId = useNavigationStore((state) => state.setAnalysisSetupPlanId);
  const queryClient = useQueryClient();
  const scopeMatches = !!providerSelectedAccountId && selectedAccountId === providerSelectedAccountId &&
    providerSelectedAccountMode !== "unknown" && !providerScopeLoading && !providerScopeError;
  const routeKey = `${providerSelectedAccountId ?? ""}:${providerSelectedAccountMode}:${sessionEpoch}:${planId ?? "new"}:${conid ?? "none"}`;
  const [draft, setDraft] = useState(blankDraft);
  const [baseline, setBaseline] = useState(blankDraft);
  const [loadedKey, setLoadedKey] = useState("");
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [invalidPlan, setInvalidPlan] = useState(false);
  const [savedToken, setSavedToken] = useState<SaveToken | null>(null);
  const controllers = useRef(new Set<AbortController>());
  const tokenRef = useRef<SaveToken | null>(null);
  const mounted = useRef(true);
  const token = scopeMatches && providerSelectedAccountId
    ? { accountId: providerSelectedAccountId, accountMode: providerSelectedAccountMode, selectedAccountId: selectedAccountId!, sessionEpoch, planId }
    : null;
  tokenRef.current = token;

  const detailQuery = useQuery<SetupPlanDetail>({
    queryKey: ["parallax", "setup-plan", providerSelectedAccountId, providerSelectedAccountMode, sessionEpoch, planId],
    queryFn: async ({ signal }) => {
      const latest = await refetchAccounts();
      const latestSelected = latest?.accounts.find((account) => account.account_id === latest.selected_account_id);
      const latestMode = latestSelected ? latestSelected.is_paper ? "paper" : "live" : "unknown";
      if (latest?.selected_account_id !== providerSelectedAccountId || latestMode !== providerSelectedAccountMode || selectedAccountId !== providerSelectedAccountId) {
        throw new Error("IBKR's selected account changed. Reopen this setup after the account context refreshes.");
      }
      return parallaxApi.getSetupPlan(planId!, signal);
    },
    enabled: ibkrReady && scopeMatches && planId != null,
    retry: false,
    staleTime: Infinity,
    refetchOnMount: "always",
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controllers.current.forEach((controller) => controller.abort());
      controllers.current.clear();
      setDirty(false);
    };
  }, [setDirty]);

  useEffect(() => {
    controllers.current.forEach((controller) => controller.abort());
    controllers.current.clear();
    const empty = blankDraft();
    setDraft(empty);
    setBaseline(empty);
    setLoadError("");
    setSaveError("");
    setInvalidPlan(false);
    setLoadedKey(planId == null ? routeKey : "");
  }, [routeKey, planId]);

  useEffect(() => {
    if (planId == null || detailQuery.isFetching) return;
    if (detailQuery.data) {
      if (detailQuery.data.id !== planId || detailQuery.data.account_id !== providerSelectedAccountId ||
        detailQuery.data.account_mode !== providerSelectedAccountMode || detailQuery.data.conid !== conid || detailQuery.data.lifecycle !== "active") {
        setInvalidPlan(true);
        setLoadError("This setup is unavailable for the current stock or IBKR account. Its draft was cleared.");
        setDraft(blankDraft());
        setBaseline(blankDraft());
        setLoadedKey(routeKey);
        return;
      }
      const loaded = draftFromPlan(detailQuery.data);
      setDraft(loaded);
      setBaseline(loaded);
      setLoadError("");
      setInvalidPlan(false);
      setLoadedKey(routeKey);
    } else if (detailQuery.error) {
      const isOwnershipMiss = detailQuery.error instanceof ApiError && detailQuery.error.status === 404;
      setInvalidPlan(isOwnershipMiss);
      setLoadError(isOwnershipMiss
        ? "This setup is unavailable for the current IBKR account. Its draft was cleared."
        : "Could not load this setup. Retry after checking the IBKR session.");
      setDraft(blankDraft());
      setBaseline(blankDraft());
      setLoadedKey(routeKey);
    }
  }, [conid, detailQuery.data, detailQuery.error, detailQuery.isFetching, planId, providerSelectedAccountId, providerSelectedAccountMode, routeKey]);

  const dirty = loadedKey === routeKey && JSON.stringify(draft) !== JSON.stringify(baseline);
  const isValid = !!conid && !!draft.waiting_intention.trim() &&
    (draft.monitoring_mode === "manual" || validConditions(draft.conditions));

  useEffect(() => {
    setDirty(dirty);
  }, [dirty, setDirty]);

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  const save = useMutation<SetupPlanDetail, Error, { planId: number | null; token: SaveToken; draft: SetupPlanDraft }>({
    mutationFn: async ({ planId: targetPlanId, token: submittedToken, draft: submittedDraft }) => {
      if (!ibkrReady || !scopeMatches || !sameToken(tokenRef.current, submittedToken)) {
        throw new Error("The IBKR account or session changed. Reopen this setup before saving.");
      }
      const latest = await refetchAccounts();
      const latestSelected = latest?.accounts.find((account) => account.account_id === latest.selected_account_id);
      const latestMode = latestSelected ? latestSelected.is_paper ? "paper" : "live" : "unknown";
      if (latest?.selected_account_id !== submittedToken.accountId || latestMode !== submittedToken.accountMode ||
        !sameToken(tokenRef.current, submittedToken)) {
        throw new Error("The IBKR account or session changed. Reopen this setup before saving.");
      }
      const common = {
        setup_type: submittedDraft.setup_type,
        waiting_intention: submittedDraft.waiting_intention.trim(),
        monitoring_mode: submittedDraft.monitoring_mode,
        invalidation_reference: submittedDraft.invalidation_reference.trim() || null,
      };
      const body = submittedDraft.monitoring_mode === "automatic"
        ? { ...common, timeframe: submittedDraft.timeframe, scan_interval_seconds: submittedDraft.scan_interval_seconds, conditions: submittedDraft.conditions }
        : common;
      const controller = new AbortController();
      controllers.current.add(controller);
      try {
        return targetPlanId == null
          ? await parallaxApi.createSetupPlan({ conid: conid!, ...body } as SetupPlanCreate, controller.signal)
          : await parallaxApi.updateSetupPlan(targetPlanId, body as SetupPlanUpdate, controller.signal);
      } finally {
        controllers.current.delete(controller);
      }
    },
    onSuccess: (plan, variables) => {
      if (!mounted.current || !sameToken(tokenRef.current, variables.token)) return;
      if (plan.account_id !== variables.token.accountId || plan.account_mode !== variables.token.accountMode) {
        setSaveError("IBKR's selected account changed while saving. Reopen this setup before continuing.");
        return;
      }
      queryClient.setQueryData(
        ["parallax", "setup-plan", variables.token.accountId, variables.token.accountMode, variables.token.sessionEpoch, plan.id],
        plan,
      );
      void queryClient.invalidateQueries({
        queryKey: ["parallax", "setup-plans", variables.token.accountId, variables.token.accountMode, variables.token.sessionEpoch],
      });
      setSaveError("");
      setDirty(false);
      setSavedToken({ ...variables.token, planId: plan.id });
      if (variables.planId == null) {
        setPlanId(plan.id);
      } else {
        const saved = draftFromPlan(plan);
        setDraft(saved);
        setBaseline(saved);
      }
    },
    onError: (error, variables) => {
      if (!mounted.current || !sameToken(tokenRef.current, variables.token)) return;
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (error instanceof ApiError && error.status === 404 && variables.planId != null) {
        setInvalidPlan(true);
        setDraft(blankDraft());
        setBaseline(blankDraft());
        setDirty(false);
        setLoadError("This setup is unavailable for the current IBKR account. Its draft was cleared.");
      }
      setSaveError(error.message || "Could not save this setup.");
    },
  });

  const updateDraft = (patch: Partial<SetupPlanDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setSaveError("");
  };

  const submit = () => {
    if (!token || !scopeMatches || !isValid || loadedKey !== routeKey || invalidPlan || !dirty) return;
    setSaveError("");
    save.mutate({ planId, token, draft });
  };

  const saved = !dirty && !!token && !!savedToken && sameToken(savedToken, token);

  return {
    providerScopeLoading,
    providerScopeError,
    accountMismatch: !!selectedAccountId && !!providerSelectedAccountId && selectedAccountId !== providerSelectedAccountId,
    scopeReady: scopeMatches,
    ibkrReady,
    accountId: providerSelectedAccountId,
    providerSelectedAccountId,
    selectedAccountId,
    retryProviderScope: () => { void refetchAccounts().catch(() => {}); },
    planId,
    draft,
    updateDraft,
    submit,
    contextReady: loadedKey === routeKey,
    isValid,
    dirty,
    saved,
    savePending: save.isPending,
    loadError,
    saveError,
    invalidPlan,
    isLoadingPlan: planId != null && (detailQuery.isLoading || detailQuery.isFetching) && !loadError,
    retryLoad: () => { void detailQuery.refetch(); },
    startNewPlan: () => {
      setPlanId(null);
      setInvalidPlan(false);
      setLoadError("");
      setSaveError("");
      setDirty(false);
    },
  };
}

export type SetupPlanEditor = ReturnType<typeof useSetupPlanEditor>;

export function SetupPlanPanel({
  conid,
  symbol,
  editor,
}: {
  conid: number | null;
  symbol: string;
  editor: SetupPlanEditor;
}) {
  if (!editor.ibkrReady) return <p className="text-xs text-[var(--text-3)]">Connect to IBKR to manage setup plans.</p>;
  if (editor.providerScopeLoading) return <p role="status" className="text-xs text-[var(--text-3)]">Checking the selected IBKR account…</p>;
  if (editor.providerScopeError) return <div className="space-y-2"><p role="alert" className="text-xs text-[var(--clr-red)]">Could not verify IBKR’s selected account.</p><button type="button" onClick={editor.retryProviderScope} className="rounded border border-[var(--border)] px-2 py-1 text-[10px]">Retry</button></div>;
  if (editor.accountMismatch) return <p role="alert" className="text-xs text-[var(--clr-orange)]">MoonMarket is set to {editor.selectedAccountId}, but IBKR is using {editor.providerSelectedAccountId}. Change the MoonMarket selection to view or edit setup plans.</p>;
  if (!editor.accountId) return <p role="status" className="text-xs text-[var(--text-3)]">No provider-selected IBKR account is available.</p>;
  if (!editor.scopeReady) return <p role="status" className="text-xs text-[var(--text-3)]">Waiting for the MoonMarket account selection to match IBKR…</p>;
  if (!editor.contextReady) return <p role="status" className="text-xs text-[var(--text-3)]">Preparing setup plan…</p>;
  if (editor.isLoadingPlan) return <p role="status" className="text-xs text-[var(--text-3)]">Loading setup plan…</p>;
  if (editor.loadError && !editor.invalidPlan) return <div className="space-y-2"><p role="alert" className="text-xs text-[var(--clr-red)]">{editor.loadError}</p><button type="button" onClick={editor.retryLoad} className="rounded border border-[var(--border)] px-2 py-1 text-[10px]">Retry</button></div>;

  return (
    <section aria-label="Setup plan" className="space-y-3 text-[11px]">
      <div className="flex items-baseline justify-between gap-2 border-b border-[var(--border)] pb-2">
        <div>
          <h2 className="font-semibold text-[var(--text-1)]">{editor.planId == null ? "Plan this setup" : `Plan for ${symbol}`}</h2>
          <p className="mt-0.5 text-[10px] text-[var(--text-3)]">{symbol || "Select a stock"}</p>
        </div>
        {editor.invalidPlan && <button type="button" onClick={editor.startNewPlan} className="text-[10px] underline">Start a new plan</button>}
      </div>
      {editor.loadError && editor.invalidPlan && <p role="alert" className="text-[10px] text-[var(--clr-orange)]">{editor.loadError}</p>}
      {!conid ? <p role="status" className="text-xs text-[var(--text-3)]">Open a verified stock in Names to track a setup.</p> : (
        <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); editor.submit(); }}>
          <fieldset disabled={editor.savePending} className="space-y-3 disabled:opacity-70">
            <legend className="sr-only">Setup plan details</legend>
          <label className="block space-y-1">
            <span className="text-[10px] text-[var(--text-3)]">Setup type</span>
            <select value={editor.draft.setup_type} onChange={(event) => editor.updateDraft({ setup_type: event.target.value as SetupPlanDraft["setup_type"] })} className="h-8 w-full rounded border border-[var(--border)] bg-[var(--bg-0)] px-2 text-xs">
              <option value="pullback">Pullback</option>
              <option value="breakout">Breakout</option>
              <option value="breakout_retest">Breakout retest</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-[10px] text-[var(--text-3)]">What are you waiting for?</span>
            <textarea required maxLength={500} rows={3} value={editor.draft.waiting_intention} onChange={(event) => editor.updateDraft({ waiting_intention: event.target.value })} className="w-full resize-y rounded border border-[var(--border)] bg-[var(--bg-0)] px-2 py-1.5 text-xs" placeholder="Describe the price action you want to review." />
          </label>
          {!editor.draft.waiting_intention.trim() && <p role="status" className="text-[10px] text-[var(--text-3)]">Describe what you are waiting for before saving.</p>}
          <label className="block space-y-1">
            <span className="text-[10px] text-[var(--text-3)]">Monitoring mode</span>
            <select value={editor.draft.monitoring_mode} onChange={(event) => editor.updateDraft({ monitoring_mode: event.target.value as SetupPlanDraft["monitoring_mode"] })} className="h-8 w-full rounded border border-[var(--border)] bg-[var(--bg-0)] px-2 text-xs">
              <option value="manual">Manual chart review</option>
              <option value="automatic">Automatic supported rule</option>
            </select>
          </label>
          {editor.draft.monitoring_mode === "automatic" && <div className="space-y-2 rounded border border-[var(--border)] p-2">
            <ConditionsList value={editor.draft.conditions} onChange={(conditions) => editor.updateDraft({ conditions })} />
            {!validConditions(editor.draft.conditions) && <p role="status" className="text-[10px] text-[var(--text-3)]">Add at least one complete supported condition before saving.</p>}
            <label className="block space-y-1">
              <span className="text-[10px] text-[var(--text-3)]">Timeframe</span>
              <select value={editor.draft.timeframe} onChange={(event) => editor.updateDraft({ timeframe: event.target.value as SetupPlanDraft["timeframe"] })} className="h-8 w-full rounded border border-[var(--border)] bg-[var(--bg-0)] px-2 text-xs">
                {["1m", "5m", "15m", "1h", "4h", "1D", "1W", "1M"].map((timeframe) => <option key={timeframe} value={timeframe}>{timeframe}</option>)}
              </select>
            </label>
          </div>}
          <label className="block space-y-1">
            <span className="text-[10px] text-[var(--text-3)]">Invalidation reference</span>
            <input type="text" maxLength={500} value={editor.draft.invalidation_reference} onChange={(event) => editor.updateDraft({ invalidation_reference: event.target.value })} className="h-8 w-full rounded border border-[var(--border)] bg-[var(--bg-0)] px-2 text-xs" placeholder="Optional price or chart reference" />
          </label>
          <p className="text-[10px] leading-relaxed text-[var(--text-3)]">Planning reference only. It is not an order or guaranteed stop fill, and it is not automatically checked.</p>
          {editor.saveError && <p role="alert" className="text-[10px] text-[var(--clr-red)]">Could not save this setup: {editor.saveError}</p>}
          {editor.saved && <div className="flex items-center justify-between gap-2 rounded border border-[var(--clr-green)]/40 bg-[var(--clr-green)]/10 px-2 py-1.5 text-[10px] text-[var(--clr-green)]"><span role="status">Setup saved.</span><button type="button" onClick={() => useNavigationStore.getState().navigate("today")} className="font-semibold underline">Open Today</button></div>}
          <button type="submit" disabled={!editor.isValid || !editor.dirty || editor.invalidPlan || !conid} className="w-full rounded bg-[var(--clr-cyan)] px-3 py-2 text-xs font-semibold text-[var(--bg-0)] disabled:cursor-not-allowed disabled:opacity-50">
            {editor.savePending ? "Saving…" : editor.planId == null ? "Track setup in Today" : "Save plan changes"}
          </button>
          </fieldset>
        </form>
      )}
    </section>
  );
}
