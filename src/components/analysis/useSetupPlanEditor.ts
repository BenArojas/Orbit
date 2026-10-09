import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useIbkrReady } from "@/context/GatewayContext";
import { parallaxApi, type SetupPlan, type SetupPlanCreate, type SetupPlanDetail, type SetupPlanTimeframe, type SetupPlanUpdate, type TriggerCondition } from "@/modules/parallax/api";
import { useOrbitAccountContext } from "@/orbit/accountContext";
import { ApiError } from "@/lib/sidecarClient";
import { useNavigationStore } from "@/store/navigation";

export type SetupPlanDraft = {
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

export function validConditions(conditions: TriggerCondition[]): boolean {
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

  const plansQuery = useQuery({
    queryKey: ["parallax", "setup-plans", providerSelectedAccountId, providerSelectedAccountMode, sessionEpoch],
    queryFn: async ({ signal }) => {
      const latest = await refetchAccounts();
      const selected = latest?.accounts.find((account) => account.account_id === latest.selected_account_id);
      if (latest?.selected_account_id !== providerSelectedAccountId ||
        (selected?.is_paper ? "paper" : "live") !== providerSelectedAccountMode) {
        throw new Error("IBKR's selected account changed. Reopen Analysis after refreshing.");
      }
      return parallaxApi.getSetupPlans(signal);
    },
    enabled: ibkrReady && scopeMatches && conid != null,
    retry: false,
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
    plan: detailQuery.data,
    discardChanges: () => { setDraft(baseline); setSaveError(""); setDirty(false); },
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
    plans: (plansQuery.data ?? []).filter((plan) => plan.conid === conid && plan.lifecycle === "active"),
    plansLoading: plansQuery.isLoading,
    plansError: plansQuery.isError,
    retryPlans: () => { void plansQuery.refetch(); },
    selectPlan: (id: number) => {
      if (!save.isPending && conid) useNavigationStore.getState().navigateToAnalysis(conid, undefined, id);
    },
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
      if (save.isPending || (dirty && !window.confirm("Discard unsaved setup plan changes?"))) return;
      setPlanId(null);
      const empty = blankDraft();
      setDraft(empty);
      setBaseline(empty);
      setInvalidPlan(false);
      setLoadError("");
      setSaveError("");
      setDirty(false);
    },
  };
}

export type SetupPlanEditor = ReturnType<typeof useSetupPlanEditor>;
