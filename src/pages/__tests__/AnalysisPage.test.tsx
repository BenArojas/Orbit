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

const orderTicketState = vi.hoisted(() => ({ open: vi.fn() }));
const routerState = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock("@/orbit/OrderTicket", () => ({
  useOrderTicketStore: (selector: (state: typeof orderTicketState) => unknown) => selector(orderTicketState),
}));

vi.mock("@/orbit/OrderTicket/useOrderTicketStore", () => ({
  useOrderTicketStore: (selector: (state: typeof orderTicketState) => unknown) => selector(orderTicketState),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => routerState.navigate,
}));

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

const toastInfoMock = vi.fn();
vi.mock("sonner", () => ({
  toast: { info: (...args: unknown[]) => toastInfoMock(...args) },
}));

vi.mock("@/hooks/useLockedFibs", () => ({
  useLockedFibs: () => ({ data: undefined, isLoading: false }),
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

describe("AnalysisPage order entry points", () => {
  beforeEach(() => {
    resetChartDataMock();
    orderTicketState.open.mockClear();
    routerState.navigate.mockClear();
    useCompareStore.getState().__resetForTests();
    useChartStore.setState({
      activeSymbol: "AAPL",
      activeConid: 265598,
      timeframe: "1D",
      activeIndicators: new Set(),
      fibDrawMode: null,
      fibDrawPointA: null,
      rightPanelCollapsed: false,
    });
  });

  it("opens the shared order ticket and navigates to MoonMarket portfolio", () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /trade/i }));
    expect(orderTicketState.open).toHaveBeenCalledWith({ conid: 265598, symbol: "AAPL" });

    fireEvent.click(screen.getByRole("button", { name: /view portfolio/i }));
    expect(routerState.navigate).toHaveBeenCalledWith("/moonmarket/portfolio");
  });

  it("navigates to MoonMarket options with the active conid and symbol", () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /options/i }));

    expect(routerState.navigate).toHaveBeenCalledWith("/moonmarket/options?conid=265598&symbol=AAPL");
  });
});

// ── no_active_fib guard (locked-fib override) ────────────────

function makeLockedFib() {
  return {
    id: "lock-1",
    source: "locked" as const,
    lockId: 1,
    colorIndex: 1,
    hidden: false,
    result: {
      no_active_fib: false,
      swing_high: 35,
      swing_low: 20,
      direction: "up",
      levels: [],
      extensions: [],
      candidates: [],
    } as unknown,
  };
}

describe("AnalysisPage — no_active_fib toast/untoggle (auto layer only)", () => {
  beforeEach(() => {
    resetChartDataMock();
    toastInfoMock.mockClear();
    useChartStore.setState({
      activeSymbol: "ASX",
      activeConid: 12345,
      timeframe: "1D",
      activeIndicators: new Set(["fibonacci"]),
      fibDrawMode: null,
      fibDrawPointA: null,
      activeFibs: [],
    });
    chartDataMock.fibonacci = { no_active_fib: true, candidates: [{}, {}] };
  });

  it("toasts and untoggles the pill when the auto-detector finds no active fib", () => {
    renderPage();
    expect(toastInfoMock).toHaveBeenCalledTimes(1);
    expect(useChartStore.getState().activeIndicators.has("fibonacci")).toBe(false);
  });

  it("still toasts/untoggles even with a drawn fib present — the pill governs only the auto layer, and the drawn fib stays in the stack", () => {
    useChartStore.setState({ activeFibs: [makeLockedFib() as never] });
    renderPage();
    // Pill untoggles (auto layer has nothing), but the drawn fib is
    // untouched — it renders on its own visibility layer regardless.
    expect(toastInfoMock).toHaveBeenCalledTimes(1);
    expect(useChartStore.getState().activeIndicators.has("fibonacci")).toBe(false);
    expect(
      useChartStore.getState().activeFibs.some((f) => f.source === "locked"),
    ).toBe(true);
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
    act(() => {
      useChartStore.setState({ rightPanelCollapsed: false });
    });

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
