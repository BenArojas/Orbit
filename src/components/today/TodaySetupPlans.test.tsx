import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TodaySetupPlans } from "./TodaySetupPlans";
import TodayPage from "@/pages/TodayPage";
import { useAccountStore } from "@/orbit/accountContext";
import { useNavigationStore } from "@/store/navigation";
import { SetupPlanPanel } from "@/components/analysis/SetupPlanPanel";
import { useSetupPlanEditor } from "@/components/analysis/useSetupPlanEditor";

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
    todayContext: { ...state.todayContext, view: "plans", alertsScrollTop: 0, watchingOpen: false, planHistoryOpen: false, alertHistoryOpen: false, selectedPlanId: null, scrollTop: 0 },
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

function PlanAnalysis() {
  const context = useNavigationStore((state) => state.analysisContext);
  const editor = useSetupPlanEditor(context.conid);
  return <SetupPlanPanel conid={context.conid} symbol={editor.plan?.symbol ?? ""} editor={editor} />;
}
function ReviewHarness() {
  return useNavigationStore((state) => state.activeScreen) === "analysis" ? <PlanAnalysis /> : <TodaySetupPlans />;
}

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
    act(() => useNavigationStore.getState().setTodayContext({ watchingOpen: true }));
    expect(await screen.findByText("S30")).toBeTruthy();
    expect(api.getSetupPlans).toHaveBeenCalledTimes(2);
    view.unmount();
  });

  it("reviews the exact plan in Analysis, returns to Watching, and preserves edits, archive history and reconnect state", async () => {
    const alert = automaticPlan(21, { review: true }), other = automaticPlan(25, { review: true });
    const manual = manualPlan(22), old = automaticPlan(23, { oldRevision: true });
    const reviewed = { ...alert, unreviewed_match_count: 0, unreviewed_matches: [], evaluations: alert.evaluations.map((item) => ({ ...item, reviewed_at: "2026-10-07T11:00:00Z" })) };
    const archived = manualPlan(22, "archived");
    let plans = [alert, other, manual, old];
    api.getSetupPlans.mockImplementation(async () => plans.map(asSummary));
    api.getSetupPlan.mockImplementation(async (id: number) => id === 21 ? alert : id === 25 ? other : id === 22 ? manual : old);
    api.reviewSetupPlan.mockRejectedValueOnce(new Error("Review was not saved")).mockImplementation(async () => { plans = [reviewed, other, manual, old]; return reviewed; });
    api.archiveSetupPlan.mockRejectedValueOnce(new Error("Tracking could not be stopped")).mockImplementation(async () => { plans = [reviewed, other, archived, old]; return archived; });
    render(<ReviewHarness />, { wrapper: wrapper() });
    await screen.findByRole("button", { name: "Open S21 Breakout plan 21" });
    expect(screen.queryByRole("group", { name: "Filter tracked setups" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open S22 Breakout plan 22" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open S21 Breakout plan 21" }));
    expect(useNavigationStore.getState().analysisContext).toMatchObject({ returnTo: "today", setupPlanId: 21, conid: 1021 });
    await screen.findByRole("button", { name: "Keep watching" });
    expect(api.reviewSetupPlan).not.toHaveBeenCalled();
    expect(screen.getByText(/Monitoring unavailable/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep watching" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Keep watching" }));
    await waitFor(() => expect(useNavigationStore.getState().activeScreen).toBe("today"));
    expect(api.reviewSetupPlan).toHaveBeenLastCalledWith(21, [210]);
    expect(await screen.findByRole("button", { name: "Open S21 Breakout plan 21" })).toBeTruthy();
    expect(useNavigationStore.getState().todayContext.watchingOpen).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Open S25 Breakout plan 25" }));
    await screen.findByRole("button", { name: "Keep watching" });
    fireEvent.click(screen.getByText("More"));
    fireEvent.click(screen.getByRole("button", { name: "Edit plan" }));
    expect(screen.getByLabelText("What are you waiting for?")).toHaveValue(other.waiting_intention);
    fireEvent.click(screen.getByRole("button", { name: "Cancel editing" }));
    act(() => useNavigationStore.getState().navigate("today"));

    fireEvent.click(await screen.findByRole("button", { name: "Open S22 Breakout plan 22" }));
    await screen.findByText("Manual review · no automatic condition.");
    fireEvent.click(screen.getByText("More"));
    fireEvent.click(screen.getByRole("button", { name: "Stop tracking" }));
    const archiveDialog = await screen.findByRole("dialog");
    fireEvent.click(within(archiveDialog).getByRole("button", { name: "Cancel" }));
    expect(api.archiveSetupPlan).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Stop tracking" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Stop tracking" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Stop tracking" }));
    await waitFor(() => expect(useNavigationStore.getState().activeScreen).toBe("today"));
    expect(screen.queryByRole("button", { name: "Open S22 Breakout plan 22" })).toBeNull();
    api.getSetupPlan.mockImplementation(async (id: number) => id === 22 ? archived : id === 23 ? old : id === 25 ? other : reviewed);
    fireEvent.click(screen.getByText("History"));
    await screen.findByText("Not a current match");
    await screen.findByText(/Tracking stopped/);
    api.getSetupPlans.mockResolvedValue([asSummary(automaticPlan(29))]);
    act(() => useNavigationStore.getState().resetNamesBrokerContext());
    expect(await screen.findByRole("button", { name: "Open S29 Breakout plan 29" })).toBeTruthy();
  });

  it("ignores delayed review and archive responses after the session or opened plan changes", async () => {
    const first = automaticPlan(31, { review: true }), second = automaticPlan(32, { review: true }), third = automaticPlan(33, { review: true });
    let resolveReview!: (plan: ReturnType<typeof automaticPlan>) => void;
    let resolveArchive!: (plan: ReturnType<typeof automaticPlan>) => void;
    api.getSetupPlans.mockResolvedValue([first, second, third].map(asSummary));
    api.getSetupPlan.mockImplementation(async (id: number) => id === 31 ? first : id === 32 ? second : third);
    api.reviewSetupPlan.mockImplementation(() => new Promise((resolve) => { resolveReview = resolve; }));
    api.archiveSetupPlan.mockImplementation(() => new Promise((resolve) => { resolveArchive = resolve; }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 60_000 } } });
    render(<ReviewHarness />, { wrapper: wrapper(client) });
    fireEvent.click(await screen.findByRole("button", { name: "Open S31 Breakout plan 31" }));
    fireEvent.click(await screen.findByRole("button", { name: "Keep watching" }));
    await waitFor(() => expect(api.reviewSetupPlan).toHaveBeenCalledWith(31, [310]));
    act(() => { useNavigationStore.getState().resetNamesBrokerContext(); useNavigationStore.getState().navigate("today"); });
    fireEvent.click(await screen.findByRole("button", { name: "Open S32 Breakout plan 32" }));
    await screen.findByRole("button", { name: "Keep watching" });
    await act(async () => { resolveReview(automaticPlan(31)); });
    expect(useNavigationStore.getState().analysisContext.setupPlanId).toBe(32);
    expect(client.getQueryData<ReturnType<typeof automaticPlan>>(["parallax", "setup-plan", "DU111", "paper", 0, 31])?.unreviewed_match_count).toBe(1);
    fireEvent.click(screen.getByText("More"));
    fireEvent.click(screen.getByRole("button", { name: "Stop tracking" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Stop tracking" }));
    await waitFor(() => expect(api.archiveSetupPlan).toHaveBeenCalledWith(32));
    act(() => { useNavigationStore.getState().resetNamesBrokerContext(); useNavigationStore.getState().navigateToAnalysis(1033, "S33", 33); });
    await screen.findByRole("heading", { name: "S33" });
    await act(async () => { resolveArchive(automaticPlan(32, { review: true, lifecycle: "archived" })); });
    expect(useNavigationStore.getState().analysisContext.setupPlanId).toBe(33);
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
  act(() => useNavigationStore.getState().setTodayContext({ watchingOpen: true }));
  await screen.findByText("S52");
  expect(api.getTriggerRules).not.toHaveBeenCalled();
  expect(screen.queryByText("Setups firing")).toBeNull();
  fireEvent.click(screen.getByText("History"));
  await screen.findByText(/Tracking stopped/);
  const events = screen.getByRole("list").querySelectorAll("li");
  expect(events[0].textContent).toContain("S51");
  expect(events[1].textContent).toContain("S52");
  expect(events[0].textContent).toContain(new Date("2026-10-08T14:00:00Z").toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }));
  fireEvent.click(screen.getByRole("tab", { name: "Quick alerts" }));
  await waitFor(() => expect(api.getTriggerRules).toHaveBeenCalled());
  expect(api.getTriggerHits).toHaveBeenCalled();
  expect(screen.queryByText("S52")).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "Tracked plans" }));
  expect(await screen.findByText("S52")).toBeTruthy();
});
