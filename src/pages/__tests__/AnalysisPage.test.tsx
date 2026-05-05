/**
 * Tests for AnalysisPage — symbol input syncs with store state.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useChartStore } from "@/store";
import AnalysisPage from "../AnalysisPage";

// ── Mocks ─────────────────────────────────────────────────────

vi.mock("@/hooks/useChartData", () => ({
  useChartData: () => ({
    candles: [],
    indicators: [],
    fibonacci: null,
    liveTick: null,
    isLoading: false,
    error: null,
  }),
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

describe("AnalysisPage symbol input sync", () => {
  beforeEach(() => {
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
