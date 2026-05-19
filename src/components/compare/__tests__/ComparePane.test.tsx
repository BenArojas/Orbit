import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import ComparePane from "../ComparePane";
import { useCompareStore } from "@/store/compare";
import { useChartStore } from "@/store/chart";

const mockResolveConid = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    resolveConid: (...args: unknown[]) => mockResolveConid(...args),
  },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/hooks/useCompareData", () => ({
  useCompareData: () => ({
    stockCandles: [{ time: 1700000000, open: 1, high: 2, low: 1, close: 2, volume: 100 }],
    refCandles: [{ time: 1700000000, open: 5, high: 6, low: 5, close: 6, volume: 0 }],
    stockLiveTick: null,
    refLiveTick: null,
    isLoading: false,
    error: null,
  }),
}));

vi.mock("../CompareChart", () => ({
  default: ({ layout }: { layout: string }) => (
    <div data-testid="compare-chart" data-layout={layout} />
  ),
}));

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  vi.clearAllMocks();
  // Pre-resolve so the auto-resolve effect inside ComparePane finds a
  // populated conid and doesn't fire api.resolveConid during tests.
  mockResolveConid.mockResolvedValue({ symbol: "SPY", conid: 320227571 });
  useCompareStore.getState().__resetForTests();
  useCompareStore.getState().enter("5m");
  useChartStore.setState({ activeConid: 265598, activeSymbol: "AAPL" });
  // Seed the first pane's reference so auto-resolve is a no-op.
  const id = useCompareStore.getState().panes[0].id;
  useCompareStore.getState().setPaneReference(id, "SPY", 320227571);
});

describe("ComparePane", () => {
  it("renders a CompareChart with the pane's layout", () => {
    const pane = useCompareStore.getState().panes[0];
    render(<ComparePane pane={pane} />, { wrapper: makeWrapper() });
    expect(screen.getByTestId("compare-chart")).toHaveAttribute("data-layout", "overlay");
  });

  it("changing the layout dropdown updates the store and re-renders", () => {
    const pane = useCompareStore.getState().panes[0];
    render(<ComparePane pane={pane} />, { wrapper: makeWrapper() });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "stockOnly" } });
    expect(useCompareStore.getState().panes[0].layout).toBe("stockOnly");
  });

  it("clicking a TF pill updates the store", () => {
    const pane = useCompareStore.getState().panes[0];
    render(<ComparePane pane={pane} />, { wrapper: makeWrapper() });
    fireEvent.click(screen.getByRole("button", { name: "1h" }));
    expect(useCompareStore.getState().panes[0].timeframe).toBe("1h");
  });

  it("close button is disabled when only one pane exists", () => {
    const pane = useCompareStore.getState().panes[0];
    render(<ComparePane pane={pane} />, { wrapper: makeWrapper() });
    expect(screen.getByRole("button", { name: /remove pane/i })).toBeDisabled();
  });

  it("close button removes the pane when more than one exists", () => {
    useCompareStore.getState().addPane();
    const [, secondPane] = useCompareStore.getState().panes;
    render(<ComparePane pane={secondPane} />, { wrapper: makeWrapper() });
    fireEvent.click(screen.getByRole("button", { name: /remove pane/i }));
    expect(useCompareStore.getState().panes).toHaveLength(1);
  });

  it("renders the pane's own reference symbol", () => {
    const id = useCompareStore.getState().panes[0].id;
    useCompareStore.getState().setPaneReference(id, "QQQ", 320227575);
    const pane = useCompareStore.getState().panes[0];
    render(<ComparePane pane={pane} />, { wrapper: makeWrapper() });
    const input = screen.getByLabelText(/reference symbol for pane/i) as HTMLInputElement;
    expect(input.value).toBe("QQQ");
  });
});
