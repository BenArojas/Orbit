import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ComparePane from "../ComparePane";
import { useCompareStore } from "@/store/compare";
import { useChartStore } from "@/store/chart";

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

beforeEach(() => {
  useCompareStore.getState().__resetForTests();
  useCompareStore.getState().enter("5m");
  useChartStore.setState({ activeConid: 265598, activeSymbol: "AAPL" });
  useCompareStore.getState().setReference("SPY", 320227571);
});

describe("ComparePane", () => {
  it("renders a CompareChart with the pane's layout", () => {
    const pane = useCompareStore.getState().panes[0];
    render(<ComparePane pane={pane} />);
    expect(screen.getByTestId("compare-chart")).toHaveAttribute("data-layout", "overlay");
  });

  it("changing the layout dropdown updates the store and re-renders", () => {
    const pane = useCompareStore.getState().panes[0];
    render(<ComparePane pane={pane} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "stockOnly" } });
    expect(useCompareStore.getState().panes[0].layout).toBe("stockOnly");
  });

  it("clicking a TF pill updates the store", () => {
    const pane = useCompareStore.getState().panes[0];
    render(<ComparePane pane={pane} />);
    fireEvent.click(screen.getByRole("button", { name: "1h" }));
    expect(useCompareStore.getState().panes[0].timeframe).toBe("1h");
  });

  it("close button is disabled when only one pane exists", () => {
    const pane = useCompareStore.getState().panes[0];
    render(<ComparePane pane={pane} />);
    expect(screen.getByRole("button", { name: /remove pane/i })).toBeDisabled();
  });

  it("close button removes the pane when more than one exists", () => {
    useCompareStore.getState().addPane();
    const [, secondPane] = useCompareStore.getState().panes;
    render(<ComparePane pane={secondPane} />);
    fireEvent.click(screen.getByRole("button", { name: /remove pane/i }));
    expect(useCompareStore.getState().panes).toHaveLength(1);
  });
});
