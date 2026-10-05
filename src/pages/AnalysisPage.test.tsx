import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AnalysisPage from "./AnalysisPage";
import { useChartStore } from "@/store/chart";
import { useCompareStore } from "@/store/compare";
import { useNavigationStore } from "@/store/navigation";

const { resolveConid, navigate } = vi.hoisted(() => ({ resolveConid: vi.fn(), navigate: vi.fn() }));

vi.mock("@/modules/parallax/api", () => ({ parallaxApi: { resolveConid } }));
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));
vi.mock("@/hooks/useChartData", () => ({
  useChartData: () => ({ candles: [], indicators: [], fibonacci: null, liveTick: null, isLoading: false, isFetching: false, error: null, loadMore: vi.fn(), isLoadingMore: false, canLoadMore: false }),
}));
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
vi.mock("@/components/analysis/RightSidebar", () => ({ default: () => <div data-testid="right-panel">Panel open</div> }));
vi.mock("@/components/compare", () => ({ CompareView: () => <div>Compare workspace</div> }));

function AnalysisHarness() {
  const activeScreen = useNavigationStore((state) => state.activeScreen);
  return activeScreen === "analysis"
    ? <AnalysisPage />
    : <button onClick={() => useNavigationStore.getState().navigate("analysis")}>Return to Analysis</button>;
}

afterEach(() => {
  cleanup();
  resolveConid.mockReset();
  navigate.mockReset();
  useCompareStore.getState().exit();
  useChartStore.setState({ rightPanelCollapsed: true, rightPanelVisibilityExplicit: false, rightPanelActiveTab: "fibonacci" });
  localStorage.removeItem("orbit.parallax.analysis-panel");
  useNavigationStore.setState({ activeScreen: "analysis" });
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
});
