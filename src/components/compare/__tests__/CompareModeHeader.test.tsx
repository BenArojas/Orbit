import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import CompareModeHeader from "../CompareModeHeader";
import { useCompareStore, MAX_PANES } from "@/store/compare";
import { useChartStore } from "@/store/chart";

beforeEach(() => {
  useCompareStore.getState().__resetForTests();
  useCompareStore.getState().enter("5m");
  useChartStore.setState({ activeSymbol: "AAPL", activeConid: 265598 });
});

describe("CompareModeHeader", () => {
  it("renders the primary stock symbol as read-only text", () => {
    render(<CompareModeHeader />);
    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("AAPL")).not.toBeInTheDocument();
  });

  it("no longer renders a shared reference input (per-pane inputs live in PaneToolbar)", () => {
    render(<CompareModeHeader />);
    expect(screen.queryByLabelText(/reference symbol$/i)).not.toBeInTheDocument();
  });

  it("disables the Add-pane button at the cap", () => {
    while (useCompareStore.getState().panes.length < MAX_PANES) {
      useCompareStore.getState().addPane();
    }
    render(<CompareModeHeader />);
    expect(screen.getByRole("button", { name: /add pane/i })).toBeDisabled();
  });

  it("clicking Exit sets compare.active=false", () => {
    render(<CompareModeHeader />);
    fireEvent.click(screen.getByRole("button", { name: /exit/i }));
    expect(useCompareStore.getState().active).toBe(false);
  });

  it("Marker button toggles markerMode", () => {
    render(<CompareModeHeader />);
    fireEvent.click(screen.getByRole("button", { name: /enter marker mode/i }));
    expect(useCompareStore.getState().markerMode).toBe(true);
  });

  it("Clear button only renders when markers exist", () => {
    render(<CompareModeHeader />);
    expect(screen.queryByRole("button", { name: /clear all markers/i })).not.toBeInTheDocument();
  });

  it("Clear button removes all markers when clicked", () => {
    useCompareStore.getState().addMarker(1700000000);
    useCompareStore.getState().addMarker(1700000300);
    render(<CompareModeHeader />);
    fireEvent.click(screen.getByRole("button", { name: /clear all markers/i }));
    expect(useCompareStore.getState().markers).toEqual([]);
  });
});

// Bonus: end-to-end migration test for v0/v1 → v2.
describe("compare store — migration (v1 → v2)", () => {
  it("spreads legacy top-level reference into each pane that lacks one", async () => {
    // Simulate persisted v1 state in localStorage.
    const v1 = {
      state: {
        reference: { symbol: "QQQ", conid: null },
        panes: [
          { id: "p-a", layout: "overlay", timeframe: "5m" },
          { id: "p-b", layout: "stockOnly", timeframe: "1h" },
        ],
        markers: [],
      },
      version: 1,
    };
    localStorage.setItem("parallax-compare-store", JSON.stringify(v1));
    // Force the store to re-hydrate from the seeded localStorage.
    await useCompareStore.persist.rehydrate();
    const panes = useCompareStore.getState().panes;
    expect(panes).toHaveLength(2);
    expect(panes[0].reference).toEqual({ symbol: "QQQ", conid: null });
    expect(panes[1].reference).toEqual({ symbol: "QQQ", conid: null });
  });
});
