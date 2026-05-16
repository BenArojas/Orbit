/**
 * Tests for AnalysisPage — symbol input syncs with store state, and
 * (Bug-3 fix) ChartContainer stays mounted across indicator-toggle
 * refetches that briefly empty the candles array.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useChartStore } from "@/store";
import AnalysisPage from "../AnalysisPage";

// ── Mocks ─────────────────────────────────────────────────────

// Mutable reference the tests update before each render so we can
// flip useChartData's return value (e.g., simulate "candles arrive →
// candles disappear → candles arrive again" during an indicator
// toggle refetch).
const chartDataMock = {
  candles: [] as Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>,
  indicators: [] as unknown[],
  fibonacci: null as unknown,
  liveTick: null as unknown,
  isLoading: false,
  error: null as unknown,
};

vi.mock("@/hooks/useChartData", () => ({
  useChartData: () => chartDataMock,
}));

vi.mock("@/hooks/useInstrument", () => ({
  useInstrument: () => ({
    symbol: null,
    companyName: "Apple Inc.",
    isLoading: false,
  }),
}));

vi.mock("@/components/indicators", () => ({
  IndicatorToolbar: () => <div data-testid="indicator-toolbar" />,
}));

vi.mock("@/components/ai", () => ({
  AiChatPanel: () => <div data-testid="ai-chat-panel" />,
  RightSidebar: () => <div data-testid="right-sidebar" />,
}));

vi.mock("@/components/charts", () => ({
  ChartContainer: () => <div data-testid="chart-container" />,
  SubChartPanel: () => <div data-testid="sub-chart-panel" />,
  SUB_CHART_BACKEND_NAMES: { rsi: "rsi", macd: "macd", stochastic: "stoch", obv: "obv", adx: "adx" },
}));

// ── Helpers ───────────────────────────────────────────────────

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AnalysisPage />
    </QueryClientProvider>,
  );
}

// ── Tests ─────────────────────────────────────────────────────

function resetChartDataMock() {
  chartDataMock.candles = [];
  chartDataMock.indicators = [];
  chartDataMock.fibonacci = null;
  chartDataMock.liveTick = null;
  chartDataMock.isLoading = false;
  chartDataMock.error = null;
}

describe("AnalysisPage symbol input sync", () => {
  beforeEach(() => {
    resetChartDataMock();
    useChartStore.setState({
      activeSymbol: "",
      activeConid: null,
      timeframe: "1D",
      activeIndicators: new Set(),
      fibDrawMode: null,
      fibDrawPointA: null,
    });
  });

  it("renders the symbol input", () => {
    renderPage();
    expect(screen.getByPlaceholderText("AAPL")).toBeInTheDocument();
  });

  it("input value updates when store activeSymbol changes externally", async () => {
    renderPage();

    // Simulate navigateToAnalysis setting the symbol in the store
    act(() => {
      useChartStore.getState().setActiveSymbol("QQQ");
    });

    // The useEffect should have fired and synced the input
    const input = screen.getByPlaceholderText("AAPL") as HTMLInputElement;
    expect(input.value).toBe("QQQ");
  });

  it("shows company name badge when companyName is available", () => {
    useChartStore.setState({ activeSymbol: "AAPL", activeConid: 265598 });
    renderPage();

    // The mock useInstrument returns "Apple Inc."
    expect(screen.getByText("Apple Inc.")).toBeInTheDocument();
  });
});

// ── Bug 3 fix ────────────────────────────────────────────────

describe("AnalysisPage — chart stays mounted across indicator-toggle refetches (Bug 3)", () => {
  beforeEach(() => {
    resetChartDataMock();
    useChartStore.setState({
      activeSymbol: "AAPL",
      activeConid: 265598,
      timeframe: "1D",
      activeIndicators: new Set(),
      fibDrawMode: null,
      fibDrawPointA: null,
    });
  });

  function makeCandle(time: number) {
    return { time, open: 100, high: 101, low: 99, close: 100, volume: 1_000_000 };
  }

  it("does NOT unmount ChartContainer when candles briefly empty during a refetch", () => {
    // Initial render with data — chart appears.
    chartDataMock.candles = [makeCandle(1), makeCandle(2), makeCandle(3)];
    const { rerender } = render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <AnalysisPage />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("chart-container")).toBeInTheDocument();

    // Simulate an indicator toggle that briefly empties the candles
    // (queryKey changed; placeholderData not yet flowing through).
    act(() => {
      chartDataMock.candles = [];
      chartDataMock.isLoading = true;
    });
    rerender(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <AnalysisPage />
      </QueryClientProvider>,
    );

    // Pre-fix: this would render the loading placeholder instead of
    // ChartContainer. Post-fix: ChartContainer stays because we've
    // already loaded once for this conid.
    expect(screen.getByTestId("chart-container")).toBeInTheDocument();
    expect(screen.queryByText(/Loading chart data/)).toBeNull();

    // Refetch settles with fresh data — chart still mounted.
    act(() => {
      chartDataMock.candles = [makeCandle(4), makeCandle(5)];
      chartDataMock.isLoading = false;
    });
    rerender(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <AnalysisPage />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("chart-container")).toBeInTheDocument();
  });

  it("shows the loading placeholder on FIRST load (before any candles arrive)", () => {
    // Conid is set but no data has ever arrived → placeholder shows.
    chartDataMock.candles = [];
    chartDataMock.isLoading = true;
    renderPage();
    expect(screen.queryByTestId("chart-container")).toBeNull();
    expect(screen.getByText(/Loading chart data/)).toBeInTheDocument();
  });

  it("resets hasEverLoaded when conid changes — placeholder shows for new conid's first load", async () => {
    // Load once for conid A.
    chartDataMock.candles = [makeCandle(1), makeCandle(2)];
    const { rerender } = render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <AnalysisPage />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("chart-container")).toBeInTheDocument();

    // Switch to a new conid. Candles temporarily empty + loading.
    act(() => {
      useChartStore.getState().setActiveConid(8314);
      chartDataMock.candles = [];
      chartDataMock.isLoading = true;
    });
    rerender(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <AnalysisPage />
      </QueryClientProvider>,
    );

    // Should now show the loading placeholder — hasEverLoaded was
    // reset on the conid change.
    expect(screen.queryByTestId("chart-container")).toBeNull();
    expect(screen.getByText(/Loading chart data/)).toBeInTheDocument();
  });
});
