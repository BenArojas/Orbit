/**
 * Tests for AnalysisPage — symbol input syncs with store state, and
 * (Bug-3 fix) ChartContainer stays mounted across indicator-toggle
 * refetches that briefly empty the candles array.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useChartStore } from "@/store";
import { useCompareStore } from "@/store/compare";
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
  DrawingToolbar: () => <div data-testid="drawing-toolbar" />,
  AtrBadge: () => null,
  SUB_CHART_BACKEND_NAMES: { rsi: "rsi", macd: "macd", stochastic: "stoch", obv: "obv", adx: "adx" },
  SHORTCUT_MAP: {},
}));

vi.mock("@/components/compare", () => ({
  CompareView: () => <div data-testid="compare-view" />,
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

// ── Spec B (post-split-query) ────────────────────────────────

describe("AnalysisPage — chart stays mounted across indicator toggles (Spec B)", () => {
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

  it("keeps ChartContainer mounted when an indicator-only update arrives (candles stable across toggles)", () => {
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

    // Simulate an indicator toggle. Post-Spec-B the candles and indicators
    // are on independent TanStack Queries, so candles stay populated
    // while the indicator query refetches. ChartContainer never blanks.
    act(() => {
      chartDataMock.indicators = [{ name: "rsi", type: "oscillator", values: [], params: {} }];
    });
    rerender(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <AnalysisPage />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("chart-container")).toBeInTheDocument();
    expect(screen.queryByText(/Loading chart data/)).toBeNull();

    // Toggle again — chart still mounted.
    act(() => {
      chartDataMock.indicators = [
        { name: "rsi", type: "oscillator", values: [], params: {} },
        { name: "macd", type: "histogram", values: [], params: {} },
      ];
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

describe("AnalysisPage — Compare Mode integration", () => {
  beforeEach(() => {
    useCompareStore.getState().__resetForTests();
    useChartStore.setState({ activeConid: 265598, activeSymbol: "AAPL", timeframe: "5m" });
    resetChartDataMock();
  });

  it("renders a Compare toggle button in the toolbar", () => {
    renderPage();
    expect(screen.getByRole("button", { name: /compare/i })).toBeInTheDocument();
  });

  it("entering compare mode hides the indicator toolbar + sub-chart panels and shows CompareView", () => {
    chartDataMock.candles = [
      { time: 1700000000, open: 1, high: 2, low: 1, close: 2, volume: 100 },
    ];
    renderPage();
    expect(screen.queryByTestId("compare-view")).not.toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /compare/i }));
    });

    expect(screen.getByTestId("compare-view")).toBeInTheDocument();
    expect(screen.queryByTestId("indicator-toolbar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("chart-container")).not.toBeInTheDocument();
  });

  it("auto-collapses the right panel on compare entry", () => {
    renderPage();
    useChartStore.setState({ rightPanelCollapsed: false });

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /compare/i }));
    });
    expect(useChartStore.getState().rightPanelCollapsed).toBe(true);
  });

  it("pressing 'C' toggles compare mode", () => {
    renderPage();
    act(() => {
      fireEvent.keyDown(window, { key: "c" });
    });
    expect(useCompareStore.getState().active).toBe(true);

    act(() => {
      fireEvent.keyDown(window, { key: "c" });
    });
    expect(useCompareStore.getState().active).toBe(false);
  });

  it("changing the active conid while in compare mode force-exits", () => {
    renderPage();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /compare/i }));
    });
    expect(useCompareStore.getState().active).toBe(true);

    act(() => {
      useChartStore.setState({ activeConid: 999, activeSymbol: "MSFT" });
    });
    expect(useCompareStore.getState().active).toBe(false);
  });

  it("does not toggle compare mode when 'C' is pressed inside an input", () => {
    renderPage();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /compare/i }));
    });
    expect(useCompareStore.getState().active).toBe(true);

    const fakeInput = document.createElement("input");
    document.body.appendChild(fakeInput);
    fakeInput.focus();
    act(() => {
      const evt = new KeyboardEvent("keydown", { key: "c", bubbles: true });
      fakeInput.dispatchEvent(evt);
    });
    expect(useCompareStore.getState().active).toBe(true);
    document.body.removeChild(fakeInput);
  });
});
