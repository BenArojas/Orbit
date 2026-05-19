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

  it("does not render any marker-related controls (marker feature removed)", () => {
    render(<CompareModeHeader />);
    expect(screen.queryByRole("button", { name: /marker/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /clear/i })).not.toBeInTheDocument();
  });
});

// End-to-end migration tests for the persisted-state schema.
describe("compare store — persisted state migrations", () => {
  it("v1 → v2: spreads legacy top-level reference into each pane", async () => {
    const v1 = {
      state: {
        reference: { symbol: "QQQ", conid: null },
        panes: [
          { id: "p-a", layout: "overlay", timeframe: "5m" },
          { id: "p-b", layout: "stockOnly", timeframe: "1h" },
        ],
      },
      version: 1,
    };
    localStorage.setItem("parallax-compare-store", JSON.stringify(v1));
    await useCompareStore.persist.rehydrate();
    const panes = useCompareStore.getState().panes;
    expect(panes).toHaveLength(2);
    expect(panes[0].reference).toEqual({ symbol: "QQQ", conid: null });
    expect(panes[1].reference).toEqual({ symbol: "QQQ", conid: null });
  });

  it("v2 → v3: drops legacy markers + markerMode silently", async () => {
    const v2 = {
      state: {
        panes: [
          {
            id: "p-a",
            layout: "overlay",
            timeframe: "5m",
            reference: { symbol: "SPY", conid: null },
          },
        ],
        markers: [{ id: "m-1", time: 1700000000, xRatio: 0.5 }],
        markerMode: true,
      },
      version: 2,
    };
    localStorage.setItem("parallax-compare-store", JSON.stringify(v2));
    await useCompareStore.persist.rehydrate();
    const s = useCompareStore.getState() as unknown as Record<string, unknown>;
    expect(s.panes).toBeDefined();
    expect(s).not.toHaveProperty("markers");
    expect(s).not.toHaveProperty("markerMode");
  });
});
