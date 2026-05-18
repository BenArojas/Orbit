import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import CompareView from "../CompareView";
import { useCompareStore } from "@/store/compare";
import { useChartStore } from "@/store/chart";

vi.mock("../CompareModeHeader", () => ({
  default: () => <div data-testid="compare-mode-header" />,
}));

vi.mock("../ComparePane", () => ({
  default: ({ pane }: { pane: { id: string } }) => (
    <div data-testid="compare-pane" data-pane-id={pane.id} />
  ),
}));

beforeEach(() => {
  useCompareStore.getState().__resetForTests();
  useChartStore.setState({ activeConid: 265598, activeSymbol: "AAPL" });
});

describe("CompareView", () => {
  it("renders the header + one pane on initial entry", () => {
    useCompareStore.getState().enter("5m");
    render(<CompareView />);
    expect(screen.getByTestId("compare-mode-header")).toBeInTheDocument();
    expect(screen.getAllByTestId("compare-pane")).toHaveLength(1);
  });

  it("renders one ComparePane per entry in the panes list", () => {
    useCompareStore.getState().enter("5m");
    useCompareStore.getState().addPane();
    useCompareStore.getState().addPane();
    render(<CompareView />);
    expect(screen.getAllByTestId("compare-pane")).toHaveLength(3);
  });

  it("each pane is keyed by its id (re-renders track stable identity)", () => {
    useCompareStore.getState().enter("5m");
    useCompareStore.getState().addPane();
    render(<CompareView />);
    const ids = screen.getAllByTestId("compare-pane").map((el) => el.getAttribute("data-pane-id"));
    expect(new Set(ids).size).toBe(ids.length);
  });
});
