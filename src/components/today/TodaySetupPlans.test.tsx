import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TodaySetupPlans } from "./TodaySetupPlans";
import TodayPage from "@/pages/TodayPage";
import { useAccountStore } from "@/orbit/accountContext";
import { useNavigationStore } from "@/store/navigation";

const { api, accountContext } = vi.hoisted(() => ({
  api: { getTriggerRules: vi.fn(), getTriggerHits: vi.fn(), getSetupPlans: vi.fn(), getSetupPlan: vi.fn(), reviewSetupPlan: vi.fn(), archiveSetupPlan: vi.fn() },
  accountContext: {
    selectedAccountId: "DU111",
    providerSelectedAccountId: "DU111",
    providerSelectedAccountMode: "paper",
    providerScopeLoading: false,
    providerScopeError: false,
    refetchAccounts: vi.fn(),
  },
}));

vi.mock("@/modules/parallax/api", () => ({ parallaxApi: api }));
vi.mock("@/context/GatewayContext", () => ({ useIbkrReady: () => true }));
vi.mock("@/orbit/accountContext", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/orbit/accountContext")>(),
  useOrbitAccountContext: () => accountContext,
}));
vi.mock("@/components/dashboard", () => ({ MarketPulse: () => null }));
vi.mock("@/hooks/useWebSocket", () => ({ useWebSocket: () => ({ addHandler: () => () => {} }) }));


function evaluation(id: number, planId: number, planRevision: number, ruleId: number, ruleRevision: number, outcome: "matched" | "failed", reviewedAt: string | null = null) {
  return {
    id, plan_id: planId, plan_revision: planRevision, rule_id: ruleId, rule_revision: ruleRevision,
    outcome, invalidation_outcome: null, invalidation_failure_code: null, invalidation_failure_message: null,
    checked_at: "2026-10-07T10:00:00Z", evidence_at: "2026-10-07T09:59:00Z",
    condition_values: [{ indicator: "close", condition: "above", threshold: 100, actual_value: 105, condition_role: "waiting" as const }],
    failure_code: outcome === "failed" ? "evaluation_failed" : null,
    failure_message: outcome === "failed" ? "Latest check failed" : null,
    reviewed_at: reviewedAt,
  };
}

function automaticPlan(id: number, options: { review?: boolean; oldRevision?: boolean; lifecycle?: "active" | "archived" } = {}) {
  const revision = options.oldRevision ? 2 : 1;
  const ruleId = id + 100;
  const rule = { id: ruleId, revision: 1, enabled: options.lifecycle !== "archived", timeframe: "1D" as const, scan_interval_seconds: 300, conditions: [{ indicator: "close", condition: "above" as const, threshold: 100, news_candle_method: null }], invalidation_condition: null };
  const match = evaluation(id * 10, id, options.oldRevision ? 1 : revision, ruleId, 1, "matched");
  const latest = options.review ? evaluation(id * 10 + 1, id, revision, ruleId, 1, "failed") : options.oldRevision ? null : match;
  return {
    id, account_id: "DU111", account_mode: "paper" as const, conid: id + 1000, symbol: `S${id}`,
    setup_type: "breakout" as const, waiting_intention: `Wait for ${id} to reclaim the level.`,
    monitoring_mode: "automatic" as const, invalidation_reference: "Below the prior low.",
    invalidation_condition: null, rule, lifecycle: options.lifecycle ?? "active" as const,
    revision, created_at: "2026-10-06T10:00:00Z", updated_at: "2026-10-07T10:00:00Z",
    archived_at: options.lifecycle === "archived" ? "2026-10-07T11:00:00Z" : null,
    monitoring_health: options.review ? "unavailable" as const : "healthy" as const,
    monitoring_due_at: null, latest_evaluation: latest,
    unreviewed_match_count: options.review ? 1 : options.oldRevision ? 0 : 0,
    evaluations: options.review ? [latest!, match] : [match],
    unreviewed_matches: options.review ? [match] : [],
    hits: [],
  };
}

function manualPlan(id: number, lifecycle: "active" | "archived" = "active") {
  return {
    ...automaticPlan(id), monitoring_mode: "manual" as const, rule: null,
    monitoring_health: "not_monitored" as const, latest_evaluation: null, unreviewed_match_count: 0,
    lifecycle, archived_at: lifecycle === "archived" ? "2026-10-07T11:00:00Z" : null,
    evaluations: [], unreviewed_matches: [],
  };
}

function asSummary<T extends { evaluations: unknown[]; hits: unknown[] }>(plan: T) {
  const { evaluations: _evaluations, hits: _hits, ...summary } = plan;
  return summary;
}

function wrapper(client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })) {
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  api.getSetupPlans.mockResolvedValue([]);
  api.getTriggerRules.mockResolvedValue([]);
  api.getTriggerHits.mockResolvedValue([]);
  accountContext.refetchAccounts.mockResolvedValue({ selected_account_id: "DU111", accounts: [{ account_id: "DU111", is_paper: true }] });
  useNavigationStore.setState((state) => ({
    activeScreen: "today",
    namesContext: { ...state.namesContext, brokerSessionEpoch: 0 },
    analysisContext: { returnTo: "screener", setupPlanId: null, conid: null },
    todayContext: { ...state.todayContext, view: "plans", alertsScrollTop: 0, planFilter: "all", hitFilter: { kind: "all" }, selectedPlanId: null, scrollTop: 0 },
    analysisDraftDirty: false,
  }));
  useAccountStore.setState({
    accounts: [{ account_id: "DU111", is_paper: true } as never],
    selectedAccountId: "DU111",
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  focusManager.setFocused(undefined);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.values(api).forEach((mock) => mock.mockReset());
  accountContext.refetchAccounts.mockReset();
});

describe("Today setup plans", () => {
  it("refreshes persisted plan state while Today remains mounted", async () => {
    const active = automaticPlan(30);
    api.getSetupPlans.mockResolvedValueOnce([]).mockResolvedValue([asSummary(active)]);
    focusManager.setFocused(true);
    const interval = vi.spyOn(globalThis, "setInterval");
    const view = render(<TodaySetupPlans />, { wrapper: wrapper() });
    await screen.findByText(/No tracked setups yet/);
    expect(api.getSetupPlans).toHaveBeenCalledTimes(1);

    const refresh = interval.mock.calls.find(([, delay]) => delay === 30_000)?.[0];
    expect(refresh).toBeDefined();
    act(() => refresh?.());
    expect(await screen.findByText("S30")).toBeTruthy();
    expect(api.getSetupPlans).toHaveBeenCalledTimes(2);
    view.unmount();
  });

  it("keeps review, archive, revision, reconnect, and navigation state tied to persisted plans", async () => {
    const alert = automaticPlan(21, { review: true });
    const revisedAlert = automaticPlan(25, { review: true });
    const manual = manualPlan(22);
    const old = automaticPlan(23, { oldRevision: true });
    const reviewed = automaticPlan(21, { review: true });
    reviewed.unreviewed_match_count = 0;
    reviewed.evaluations.find((item) => item.outcome === "matched")!.reviewed_at = "2026-10-07T11:00:00Z";
    const archivedManual = manualPlan(22, "archived");
    const initial = [alert, revisedAlert, manual, old].map(asSummary);
    api.getSetupPlans.mockResolvedValueOnce(initial).mockResolvedValueOnce([asSummary(reviewed), asSummary(revisedAlert), asSummary(manual), asSummary(old)]).mockResolvedValue([asSummary(revisedAlert), asSummary(archivedManual), asSummary(old)]);
    api.getSetupPlan.mockImplementation(async (id: number) => id === 21 ? alert : id === 25 ? revisedAlert : id === 22 ? archivedManual : old);
    api.reviewSetupPlan.mockRejectedValueOnce(new Error("review unavailable")).mockResolvedValue(reviewed);
    api.archiveSetupPlan.mockRejectedValueOnce(new Error("archive unavailable")).mockResolvedValue(archivedManual);
    const Wrapper = wrapper();
    const view = render(<TodaySetupPlans />, { wrapper: Wrapper });

    await screen.findByText("S21");
    expect(screen.getAllByText(/Check failed/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Monitoring unavailable").length).toBeGreaterThan(0);
    expect(screen.getByText("Manual review")).toBeTruthy();
    expect(screen.getByText("Review this plan in Analysis when you are ready.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Review chart for S21 Breakout plan 21" }));
    expect(useNavigationStore.getState().analysisContext).toMatchObject({ returnTo: "today", setupPlanId: 21, conid: 1021 });
    expect(api.reviewSetupPlan).not.toHaveBeenCalled();
    act(() => useNavigationStore.getState().navigate("today"));

    fireEvent.click(screen.getAllByRole("button", { name: "Review alert" })[0]);
    await screen.findByRole("button", { name: "Keep watching" });
    fireEvent.click(screen.getByRole("button", { name: "Keep watching" }));
    expect(await screen.findByText("The review was not saved.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep watching" }));
    await waitFor(() => expect(api.reviewSetupPlan).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(within(screen.getByRole("region", { name: "Watching" })).getByText("S21")).toBeTruthy());
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "All active" }));

    const revisedRow = screen.getByText("S25").closest("article")!;
    fireEvent.click(within(revisedRow).getByRole("button", { name: "Review alert" }));
    await screen.findByRole("button", { name: "Revise plan" });
    fireEvent.click(screen.getByRole("button", { name: "Revise plan" }));
    expect(useNavigationStore.getState().analysisContext).toMatchObject({ returnTo: "today", setupPlanId: 25, conid: 1025 });
    expect(api.reviewSetupPlan).toHaveBeenCalledTimes(2);
    act(() => useNavigationStore.getState().navigate("today"));

    fireEvent.click(screen.getByRole("button", { name: "Watching" }));
    const manualRow = screen.getByText("S22").closest("article")!;
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    fireEvent.click(within(manualRow).getByRole("button", { name: "Stop tracking" }));
    expect(api.archiveSetupPlan).not.toHaveBeenCalled();
    fireEvent.click(within(manualRow).getByRole("button", { name: "Stop tracking" }));
    expect(await screen.findByText("Tracking could not be stopped. Plan history is unchanged.")).toBeTruthy();
    fireEvent.click(within(screen.getByText("S22").closest("article")!).getByRole("button", { name: "Stop tracking" }));
    await waitFor(() => expect(api.archiveSetupPlan).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(within(screen.getByRole("region", { name: "Watching" })).queryByText("S22")).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Watching" }));

    fireEvent.click(screen.getByText("Recent activity"));
    await screen.findByText("Not a current match");

    act(() => {
      useNavigationStore.getState().setTodayContext({ planFilter: "watching" });
      useNavigationStore.getState().setTodayContext({ selectedPlanId: 25 });
    });
    view.unmount();
    const remounted = render(<TodaySetupPlans />, { wrapper: wrapper() });
    expect(screen.getByRole("button", { name: "Watching" }).getAttribute("aria-pressed")).toBe("true");
    expect(useNavigationStore.getState().todayContext.selectedPlanId).toBe(25);
    await waitFor(() => expect(within(screen.getByRole("region", { name: "Watching" })).getByText("S23")).toBeTruthy());

    const callsBeforeReconnect = api.getSetupPlans.mock.calls.length;
    api.getSetupPlans.mockResolvedValueOnce([asSummary(automaticPlan(29))]);
    act(() => useNavigationStore.setState((state) => ({ namesContext: { ...state.namesContext, brokerSessionEpoch: state.namesContext.brokerSessionEpoch + 1 } })));
    await waitFor(() => {
      expect(api.getSetupPlans.mock.calls.length).toBeGreaterThan(callsBeforeReconnect);
      expect(within(screen.getByRole("region", { name: "Watching" })).getByText("S29")).toBeTruthy();
    });
    remounted.unmount();
  });

  it("ignores delayed review and archive completions from an older session scope", async () => {
    const first = automaticPlan(31, { review: true });
    const second = automaticPlan(32, { review: true });
    const third = automaticPlan(33, { review: true });
    const reviewed = automaticPlan(31);
    const archived = automaticPlan(32, { review: true, lifecycle: "archived" });
    let resolveReview!: (plan: ReturnType<typeof automaticPlan>) => void;
    let resolveArchive!: (plan: ReturnType<typeof automaticPlan>) => void;
    api.getSetupPlans.mockResolvedValue([asSummary(first), asSummary(second), asSummary(third)]);
    api.getSetupPlan.mockImplementation(async (id: number) => id === 31 ? first : id === 32 ? second : third);
    api.reviewSetupPlan.mockImplementation(() => new Promise((resolve) => { resolveReview = resolve; }));
    api.archiveSetupPlan.mockImplementation(() => new Promise((resolve) => { resolveArchive = resolve; }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 60_000 } } });
    render(<TodaySetupPlans />, { wrapper: wrapper(client) });
    await screen.findByText("S31");
    const firstRow = screen.getByText("S31").closest("article")!;
    fireEvent.click(within(firstRow).getByRole("button", { name: "Review alert" }));
    await screen.findByRole("button", { name: "Keep watching" });
    fireEvent.click(screen.getByRole("button", { name: "Keep watching" }));
    await waitFor(() => expect(api.reviewSetupPlan).toHaveBeenCalledWith(31, [310]));

    act(() => useNavigationStore.setState((state) => ({ namesContext: { ...state.namesContext, brokerSessionEpoch: state.namesContext.brokerSessionEpoch + 1 } })));
    await waitFor(() => expect(screen.getByText("S32")).toBeTruthy());
    const secondRow = screen.getByText("S32").closest("article")!;
    fireEvent.click(within(secondRow).getByRole("button", { name: "Review alert" }));
    await screen.findByRole("region", { name: "Review S32 alert" });
    const epochZeroDetail = client.getQueryData<ReturnType<typeof automaticPlan>>(["parallax", "setup-plan", "DU111", "paper", 0, 31]);
    expect(epochZeroDetail?.unreviewed_match_count).toBe(1);

    await act(async () => { resolveReview(reviewed); await Promise.resolve(); });
    expect(screen.getByRole("region", { name: "Review S32 alert" })).toBeTruthy();
    expect(client.getQueryData<ReturnType<typeof automaticPlan>>(["parallax", "setup-plan", "DU111", "paper", 0, 31])?.unreviewed_match_count).toBe(1);

    const secondReview = within(screen.getByRole("region", { name: "Review S32 alert" }));
    fireEvent.click(await secondReview.findByRole("button", { name: "Stop tracking" }));
    await waitFor(() => expect(api.archiveSetupPlan).toHaveBeenCalledWith(32));
    act(() => useNavigationStore.setState((state) => ({ namesContext: { ...state.namesContext, brokerSessionEpoch: state.namesContext.brokerSessionEpoch + 1 } })));
    await waitFor(() => expect(screen.getByText("S33")).toBeTruthy());
    const thirdRow = screen.getByText("S33").closest("article")!;
    fireEvent.click(within(thirdRow).getByRole("button", { name: "Review alert" }));
    await screen.findByRole("region", { name: "Review S33 alert" });

    await act(async () => { resolveArchive(archived); await Promise.resolve(); });
    expect(screen.getByRole("region", { name: "Review S33 alert" })).toBeTruthy();
    expect(useNavigationStore.getState().todayContext.selectedPlanId).toBe(33);
    expect(client.getQueryData<ReturnType<typeof automaticPlan>>(["parallax", "setup-plan", "DU111", "paper", 1, 32])?.lifecycle).toBe("active");
  });

  it("restores Today scroll position when the page returns", () => {
    const Wrapper = wrapper();
    const first = render(<TodayPage />, { wrapper: Wrapper });
    const region = screen.getByRole("region", { name: "Today workspace content" });
    region.scrollTop = 420;
    fireEvent.scroll(region);
    expect(useNavigationStore.getState().todayContext.scrollTop).toBe(420);
    first.unmount();

    const callbacks: ResizeObserverCallback[] = [];
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: ResizeObserverCallback) { callbacks.push(callback); }
      observe() {}
      disconnect() {}
    });
    let scrollHeight = 200;
    const restored = render(<TodayPage />, { wrapper: wrapper() });
    const restoredRegion = screen.getByRole("region", { name: "Today workspace content" });
    Object.defineProperties(restoredRegion, {
      scrollHeight: { configurable: true, get: () => scrollHeight },
      clientHeight: { configurable: true, get: () => 400 },
    });
    expect(restoredRegion.scrollTop).toBe(0);
    expect(useNavigationStore.getState().todayContext.scrollTop).toBe(420);
    scrollHeight = 1000;
    act(() => callbacks[callbacks.length - 1]?.([], {} as ResizeObserver));
    expect(restoredRegion.scrollTop).toBe(420);
    restored.unmount();
  });
});


it("defaults to plans, keeps standalone alerts functional, and sorts SQLite UTC timestamps with qualified evaluations", async () => {
  const archived = manualPlan(51, "archived");
  archived.archived_at = "2026-10-08 14:00:00";
  const checked = automaticPlan(52);
  checked.evaluations[0].checked_at = "2026-10-08T13:59:00Z";
  api.getSetupPlans.mockResolvedValue([asSummary(archived), asSummary(checked)]);
  api.getSetupPlan.mockImplementation(async (id: number) => id === 51 ? archived : checked);
  render(<TodayPage />, { wrapper: wrapper() });
  await screen.findByText("S52");
  expect(api.getTriggerRules).not.toHaveBeenCalled();
  expect(screen.queryByText("Setups firing")).toBeNull();
  fireEvent.click(screen.getByText("Recent activity"));
  await screen.findByText(/Tracking stopped/);
  const events = screen.getByRole("list").querySelectorAll("li");
  expect(events[0].textContent).toContain("S51");
  expect(events[1].textContent).toContain("S52");
  expect(events[0].textContent).toContain(new Date("2026-10-08T14:00:00Z").toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }));
  fireEvent.click(screen.getByRole("button", { name: "Standalone alerts" }));
  await waitFor(() => expect(api.getTriggerRules).toHaveBeenCalled());
  expect(api.getTriggerHits).toHaveBeenCalled();
  expect(screen.queryByText("S52")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Tracked plans" }));
  expect(await screen.findByText("S52")).toBeTruthy();
});
