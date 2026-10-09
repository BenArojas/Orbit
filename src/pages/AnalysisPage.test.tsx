import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AnalysisPage from "./AnalysisPage";
import { useChartStore } from "@/store/chart";
import { useCompareStore } from "@/store/compare";
import { useNavigationStore } from "@/store/navigation";
import { TodaySetupPlans } from "@/components/today/TodaySetupPlans";

const { api, navigate, accountContext } = vi.hoisted(() => ({
  api: {
    resolveConid: vi.fn(),
    getSetupPlans: vi.fn(),
    getSetupPlan: vi.fn(),
    createSetupPlan: vi.fn(),
    updateSetupPlan: vi.fn(),
  },
  navigate: vi.fn(),
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
vi.mock("@/orbit/accountContext", () => ({ useOrbitAccountContext: () => accountContext }));
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));
vi.mock("@/hooks/useChartData", () => ({
  useChartData: () => ({ candles: [], indicators: [], fibonacci: null, liveTick: null, isLoading: false, isFetching: false, error: null, loadMore: vi.fn(), isLoadingMore: false, canLoadMore: false }),
}));
vi.mock("@/hooks/useLiveQuotes", () => ({ useLiveQuotes: () => new Map() }));
vi.mock("@/hooks/useInstrument", () => ({ useInstrument: () => ({ companyName: null }) }));
vi.mock("@/hooks/useLockedFibs", () => ({ useLockedFibs: vi.fn() }));
vi.mock("@/components/charts", () => ({
  ChartContainer: () => null,
  SubChartPanel: () => null,
  AtrBadge: () => <span>ATR value</span>,
  DrawingToolbar: () => <div data-testid="drawing-controls">Drawing controls</div>,
  SUB_CHART_BACKEND_NAMES: { rsi: "RSI", macd: "MACD", stoch: "Stochastic", obv: "OBV", adx: "ADX" },
}));
vi.mock("@/components/indicators", () => ({ IndicatorToolbar: () => <div>Indicator controls</div> }));
vi.mock("@/components/analysis/RightSidebar", async () => {
  const { SetupPlanPanel } = await import("@/components/analysis/SetupPlanPanel");
  return { default: ({ activeConid, activeSymbol, setupPlanEditor }: { activeConid: number | null; activeSymbol: string; setupPlanEditor: React.ComponentProps<typeof SetupPlanPanel>["editor"] }) => <div data-testid="right-panel">Panel open<SetupPlanPanel conid={activeConid} symbol={activeSymbol} editor={setupPlanEditor} /></div> };
});
vi.mock("@/components/compare", () => ({ CompareView: () => <div>Compare workspace</div> }));

function AnalysisHarness() {
  const activeScreen = useNavigationStore((state) => state.activeScreen);
  return activeScreen === "analysis"
    ? <AnalysisPage />
    : activeScreen === "today"
      ? <TodaySetupPlans />
      : <button onClick={() => useNavigationStore.getState().navigate("analysis")}>Return to Analysis</button>;
}

function planDetail(id: number, monitoringMode: "manual" | "automatic") {
  return {
    id,
    account_id: "DU111",
    account_mode: "paper" as const,
    conid: 321,
    symbol: "AAA",
    setup_type: "breakout" as const,
    waiting_intention: `Plan ${id} wait intention`,
    monitoring_mode: monitoringMode,
    invalidation_reference: "Below the prior low",
    invalidation_condition: null,
    rule: monitoringMode === "automatic" ? {
      id: id + 100,
      revision: 1,
      enabled: true,
      timeframe: "1D" as const,
      scan_interval_seconds: 300,
      conditions: [{ indicator: "rsi", condition: "below" as const, threshold: 30, news_candle_method: null }],
      invalidation_condition: null,
    } : null,
    lifecycle: "active" as const,
    revision: 1,
    created_at: "2026-10-07T00:00:00Z",
    updated_at: "2026-10-07T00:00:00Z",
    archived_at: null,
    monitoring_health: monitoringMode === "manual" ? "not_monitored" as const : "not_checked" as const,
    monitoring_due_at: null,
    latest_evaluation: null,
    unreviewed_match_count: 0,
    evaluations: [],
    unreviewed_matches: [],
    hits: [],
  };
}

function planSummary(id: number, lifecycle: "active" | "archived" = "active") {
  const { evaluations: _evaluations, hits: _hits, ...summary } = planDetail(id, "automatic");
  return { ...summary, lifecycle, archived_at: lifecycle === "archived" ? "2026-10-07T00:00:00Z" : null };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Object.values(api).forEach((mock) => mock.mockReset());
  navigate.mockReset();
  useCompareStore.getState().exit();
  useChartStore.setState({ rightPanelCollapsed: true, rightPanelVisibilityExplicit: false, rightPanelActiveTab: "fibonacci", fibDrawMode: null });
  localStorage.removeItem("orbit.parallax.analysis-panel");
  useNavigationStore.setState({ activeScreen: "analysis", analysisContext: { returnTo: "screener", setupPlanId: null, conid: 321 }, analysisDraftDirty: false });
  Object.assign(accountContext, {
    selectedAccountId: "DU111",
    providerSelectedAccountId: "DU111",
    providerSelectedAccountMode: "paper",
    providerScopeLoading: false,
    providerScopeError: false,
  });
  accountContext.refetchAccounts.mockReset();
});

beforeEach(() => {
  api.getSetupPlans.mockResolvedValue([]);
  api.getSetupPlan.mockImplementation(async (id: number) => planDetail(id, "manual"));
  accountContext.refetchAccounts.mockResolvedValue({
    selected_account_id: "DU111",
    accounts: [{ account_id: "DU111", label: "Paper", selected: true, is_paper: true }],
  });
});

describe("AnalysisPage hierarchy", () => {
  it("starts collapsed, exposes tools and Watchlists, and preserves explicit panel choices and the Names return path", () => {
    localStorage.removeItem("orbit.parallax.analysis-panel");
    useNavigationStore.setState({
      activeScreen: "analysis",
      namesContext: { ...useNavigationStore.getState().namesContext, mainTab: "discover", discoverTab: "custom", watchlistFilter: "MEGA" },
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><AnalysisHarness /></QueryClientProvider>);

    expect(useChartStore.getState().rightPanelCollapsed).toBe(true);
    expect(screen.getByRole("button", { name: "Back to Names" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Watchlists" })).toBeInTheDocument();
    expect(screen.queryByTestId("right-panel")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Watchlists" }));
    expect(screen.getByTestId("right-panel")).toBeInTheDocument();
    expect(useChartStore.getState().rightPanelActiveTab).toBe("watchlists");
    expect(localStorage.getItem("orbit.parallax.analysis-panel")).toContain('"collapsed":false');
    expect(localStorage.getItem("orbit.parallax.analysis-panel")).toContain('"activeTab":"watchlists"');

    fireEvent.click(screen.getByText("Tools"));
    expect(screen.getByTestId("drawing-controls")).toBeInTheDocument();
    expect(screen.getByText("Indicator controls")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Trade" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Draw Fib" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(screen.getByText("Compare workspace")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "c" });
    expect(screen.getByRole("button", { name: "Back to Names" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to Names" }));
    expect(useNavigationStore.getState().activeScreen).toBe("screener");
    expect(useNavigationStore.getState().namesContext).toMatchObject({ mainTab: "discover", discoverTab: "custom", watchlistFilter: "MEGA" });

    fireEvent.click(screen.getByRole("button", { name: "Return to Analysis" }));
    expect(screen.getByTestId("right-panel")).toBeInTheDocument();
    expect(useChartStore.getState().rightPanelCollapsed).toBe(false);
    expect(useChartStore.getState().rightPanelActiveTab).toBe("watchlists");
    client.clear();
  });

  it("creates manual and automatic plans, preserves edits through Compare/tools, keeps failed edits, and opens the selected Today plan by ID", async () => {
    let failPendingSave: (error: Error) => void = () => {};
    api.createSetupPlan
      .mockResolvedValueOnce(planDetail(31, "manual"))
      .mockResolvedValueOnce(planDetail(32, "automatic"));
    api.getSetupPlan.mockImplementation(async (id: number) => planDetail(id, id === 31 ? "manual" : "automatic"));
    api.updateSetupPlan
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { failPendingSave = reject; }))
      .mockResolvedValueOnce(planDetail(32, "automatic"));
    api.getSetupPlans.mockResolvedValue([planSummary(32), planSummary(33), planSummary(34, "archived")]);

    useNavigationStore.setState({
      activeScreen: "analysis",
      analysisContext: { returnTo: "screener", setupPlanId: null, conid: 321 },
      analysisDraftDirty: false,
    });
    useChartStore.setState({ activeConid: 321, activeSymbol: "AAA" });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={client}><AnalysisHarness /></QueryClientProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Setup" }));
    fireEvent.change(screen.getByLabelText("Setup type"), { target: { value: "breakout" } });
    fireEvent.change(screen.getByLabelText("What are you waiting for?"), { target: { value: "Review acceptance above the range." } });
    fireEvent.change(screen.getByLabelText("Invalidation reference"), { target: { value: "Below the prior low" } });
    fireEvent.click(screen.getByRole("button", { name: "Track setup in Today" }));
    await waitFor(() => expect(api.createSetupPlan).toHaveBeenCalledTimes(1));
    expect(api.createSetupPlan.mock.calls[0][0]).toMatchObject({
      conid: 321,
      setup_type: "breakout",
      waiting_intention: "Review acceptance above the range.",
      monitoring_mode: "manual",
      invalidation_reference: "Below the prior low",
    });
    expect(await screen.findByText("Setup saved.")).toBeInTheDocument();
    await screen.findByRole("button", { name: "Save plan changes" });

    fireEvent.click(screen.getByRole("button", { name: "Back to Names" }));
    fireEvent.click(screen.getByRole("button", { name: "Return to Analysis" }));
    fireEvent.click(screen.getByRole("button", { name: "Setup" }));
    fireEvent.change(screen.getByLabelText("What are you waiting for?"), { target: { value: "Wait for a close above resistance." } });
    fireEvent.change(screen.getByLabelText("Monitoring mode"), { target: { value: "automatic" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Add condition" }));
    expect(screen.getByLabelText("Check timeframe")).toHaveValue("1D");
    fireEvent.click(screen.getByRole("button", { name: "Track setup in Today" }));
    await waitFor(() => expect(api.createSetupPlan).toHaveBeenCalledTimes(2));
    expect(api.createSetupPlan.mock.calls[1][0]).toMatchObject({
      conid: 321,
      monitoring_mode: "automatic",
      timeframe: "1D",
      conditions: [{ indicator: "rsi", condition: "below", threshold: 30 }],
    });
    await screen.findByRole("button", { name: "Save plan changes" });

    const intention = screen.getByLabelText("What are you waiting for?");
    fireEvent.change(intention, { target: { value: "Wait for a daily close above resistance." } });
    const confirmDiscard = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Back to Names" }));
    expect(confirmDiscard).toHaveBeenCalledWith("Discard unsaved setup plan changes?");
    expect(useNavigationStore.getState().activeScreen).toBe("analysis");
    fireEvent.click(screen.getByText("Tools"));
    fireEvent.click(screen.getByRole("button", { name: "Draw Fib" }));
    expect(intention).toHaveValue("Wait for a daily close above resistance.");
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(intention).toHaveValue("Wait for a daily close above resistance.");
    fireEvent.keyDown(window, { key: "c" });

    fireEvent.click(screen.getByRole("button", { name: "Save plan changes" }));
    await waitFor(() => expect(intention).toBeDisabled());
    expect(intention).toHaveValue("Wait for a daily close above resistance.");
    await act(async () => failPendingSave(new Error("sidecar unavailable")));
    expect(await screen.findByRole("alert")).toHaveTextContent("sidecar unavailable");
    expect(screen.getByLabelText("What are you waiting for?")).toHaveValue("Wait for a daily close above resistance.");
    fireEvent.click(screen.getByRole("button", { name: "Save plan changes" }));
    expect(await screen.findByText("Setup saved.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open Today" }));
    await screen.findByText("Watching · 2");
    fireEvent.click(screen.getByText("Watching · 2"));
    expect(screen.queryByRole("button", { name: "Open AAA Breakout plan 34" })).not.toBeInTheDocument();
    const otherPlan = await screen.findByRole("button", { name: "Open AAA Breakout plan 33" });
    expect(screen.getByRole("button", { name: "Open AAA Breakout plan 32" })).toBeInTheDocument();
    fireEvent.click(otherPlan);
    await waitFor(() => expect(api.getSetupPlan).toHaveBeenCalledWith(33, expect.any(AbortSignal)));
    expect(await screen.findByRole("button", { name: "Back to Today" })).toBeInTheDocument();
    await screen.findByText("Plan 33 wait intention");
    fireEvent.click(screen.getByText("More"));
    fireEvent.click(screen.getByRole("button", { name: "Edit plan" }));
    expect(screen.getByLabelText("What are you waiting for?")).toHaveValue("Plan 33 wait intention");
    fireEvent.change(screen.getByLabelText("What are you waiting for?"), { target: { value: "Unsaved plan 33 edit" } });
    expect(useNavigationStore.getState().navigateToAnalysis(321, "AAA", 32)).toBe(false);
    expect(useNavigationStore.getState().analysisContext.setupPlanId).toBe(33);
    expect(api.getSetupPlan).not.toHaveBeenCalledWith(32, expect.any(AbortSignal));
    confirmDiscard.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Back to Today" }));
    expect(useNavigationStore.getState().activeScreen).toBe("today");
    confirmDiscard.mockRestore();
    client.clear();
  });

  it("blocks setup-plan access when MoonMarket selection differs from IBKR scope", () => {
    accountContext.selectedAccountId = "DU222";
    useNavigationStore.setState({
      activeScreen: "analysis",
      analysisContext: { returnTo: "screener", setupPlanId: 31, conid: 321 },
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><AnalysisHarness /></QueryClientProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Setup" }));
    expect(screen.getByRole("alert")).toHaveTextContent("MoonMarket is set to DU222, but IBKR is using DU111.");
    expect(api.getSetupPlan).not.toHaveBeenCalled();

    act(() => useNavigationStore.setState({ activeScreen: "today" }));
    expect(screen.getByRole("alert")).toHaveTextContent("MoonMarket is set to DU222, but IBKR is using DU111.");
    expect(api.getSetupPlans).not.toHaveBeenCalled();
    client.clear();
  });
});


it("selects separate plans and creates a new plan explicitly without losing a cancelled dirty draft or changing chart preference", async () => {
  api.getSetupPlan.mockImplementation(async (id: number) => planDetail(id, "automatic"));
  api.getSetupPlans.mockResolvedValue([planSummary(32), planSummary(33)]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><AnalysisHarness /></QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Setup" }));
  await screen.findByRole("option", { name: /#32/ });
  const picker = screen.getByLabelText("Existing plans for AAA");
  fireEvent.change(picker, { target: { value: "32" } });
  await waitFor(() => expect(screen.getByLabelText("What are you waiting for?")).toHaveValue("Plan 32 wait intention"));
  const preferredTimeframe = useChartStore.getState().timeframe;
  fireEvent.change(screen.getByLabelText("Check timeframe"), { target: { value: "30m" } });
  expect(useChartStore.getState().timeframe).toBe(preferredTimeframe);
  fireEvent.click(screen.getByRole("button", { name: "View 30m check timeframe" }));
  expect(useChartStore.getState().timeframe).toBe("30m");
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  fireEvent.click(screen.getByRole("button", { name: "New plan for AAA" }));
  expect(useNavigationStore.getState().analysisContext.setupPlanId).toBe(32);
  expect(screen.getByLabelText("Check timeframe")).toHaveValue("30m");
  fireEvent.change(picker, { target: { value: "33" } });
  expect(useNavigationStore.getState().analysisContext.setupPlanId).toBe(32);
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "New plan for AAA" }));
  await waitFor(() => expect(screen.getByLabelText("What are you waiting for?")).toHaveValue(""));
  expect(useNavigationStore.getState().analysisContext.setupPlanId).toBeNull();
  fireEvent.change(screen.getByLabelText("Monitoring mode"), { target: { value: "automatic" } });
  fireEvent.click(screen.getByRole("button", { name: "Add price alert" }));
  fireEvent.change(screen.getByLabelText("threshold"), { target: { value: "123" } });
  expect(screen.getByText(/Request review when Price above 123/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("indicator"), { target: { value: "news_candle" } });
  expect(screen.getByLabelText("condition")).toHaveValue("fires");
  fireEvent.change(screen.getByLabelText("indicator"), { target: { value: "rsi" } });
  expect(screen.getByLabelText("condition")).toHaveValue("above");
  expect(screen.queryByRole("option", { name: "Fires" })).toBeNull();
  expect(screen.getByLabelText("threshold")).toHaveValue(null);
  client.clear();
});

it("keeps top navigation accessible with the narrow Analysis panel open and protects dirty drafts", async () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  useChartStore.setState({ activeConid: 321, activeSymbol: "AAA", rightPanelCollapsed: false, rightPanelActiveTab: "setup" });
  useNavigationStore.setState({ activeScreen: "analysis", analysisContext: { returnTo: "screener", setupPlanId: null, conid: 321 }, analysisDraftDirty: false });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const view = render(<QueryClientProvider client={client}>
    <nav aria-label="Top navigation"><button onClick={() => useNavigationStore.getState().navigate("today")}>Today</button></nav>
    <AnalysisHarness />
  </QueryClientProvider>);
  try {
    await screen.findByLabelText("What are you waiting for?");
    const nav = screen.getByRole("navigation", { name: "Top navigation" });
    expect(nav.closest('[inert], [aria-hidden="true"]')).toBeNull();
    expect(view.container.contains(screen.getByRole("dialog", { name: "Analysis tools" }))).toBe(true);
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toBeNull();
    fireEvent.change(screen.getByLabelText("What are you waiting for?"), { target: { value: "Preserve this draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(confirm).toHaveBeenCalledWith("Discard unsaved setup plan changes?");
    expect(useNavigationStore.getState().activeScreen).toBe("analysis");
    fireEvent.click(screen.getByRole("button", { name: "Setup" }));
    expect(await screen.findByLabelText("What are you waiting for?")).toHaveValue("Preserve this draft");
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    await screen.findByRole("region", { name: "Tracked setup plans" });
    expect(useNavigationStore.getState().activeScreen).toBe("today");
  } finally {
    confirm.mockRestore();
    client.clear();
  }
});
