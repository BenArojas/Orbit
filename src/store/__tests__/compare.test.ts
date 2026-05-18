/**
 * Tests for the compare store.
 *
 * Covers initial state, mode entry/exit, reference management,
 * pane management (add, remove, layout/TF update), and persistence.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useCompareStore, MAX_PANES } from "../compare";

beforeEach(() => {
  // Reset to a clean initial state. The store exposes a test reset.
  useCompareStore.getState().__resetForTests();
  localStorage.clear();
});

describe("compare store — initial state", () => {
  it("defaults to inactive with SPY reference and no panes", () => {
    const s = useCompareStore.getState();
    expect(s.active).toBe(false);
    expect(s.reference).toEqual({ symbol: "SPY", conid: null });
    expect(s.panes).toEqual([]);
  });
});

describe("compare store — enter / exit", () => {
  it("enter() activates the mode and seeds one overlay pane at the given TF", () => {
    useCompareStore.getState().enter("5m");
    const s = useCompareStore.getState();
    expect(s.active).toBe(true);
    expect(s.panes).toHaveLength(1);
    expect(s.panes[0].layout).toBe("overlay");
    expect(s.panes[0].timeframe).toBe("5m");
    expect(s.panes[0].id).toMatch(/.+/);
  });

  it("enter() is idempotent on a non-empty panes list", () => {
    useCompareStore.getState().enter("5m");
    const firstId = useCompareStore.getState().panes[0].id;
    useCompareStore.getState().enter("1h");  // already active — should not seed a second pane
    const s = useCompareStore.getState();
    expect(s.panes).toHaveLength(1);
    expect(s.panes[0].id).toBe(firstId);
    expect(s.panes[0].timeframe).toBe("5m");
  });

  it("exit() clears active but preserves panes (so re-entry is sticky)", () => {
    useCompareStore.getState().enter("5m");
    useCompareStore.getState().exit();
    const s = useCompareStore.getState();
    expect(s.active).toBe(false);
    // Panes preserved for "sticky" re-entry.
    expect(s.panes).toHaveLength(1);
  });
});

describe("compare store — reference", () => {
  it("setReference updates symbol + conid", () => {
    useCompareStore.getState().setReference("QQQ", 320227571);
    const r = useCompareStore.getState().reference;
    expect(r.symbol).toBe("QQQ");
    expect(r.conid).toBe(320227571);
  });
});

describe("compare store — panes", () => {
  beforeEach(() => {
    useCompareStore.getState().enter("15m");
  });

  it("addPane() appends a new overlay pane copying the most recent TF", () => {
    useCompareStore.getState().setPaneTimeframe(useCompareStore.getState().panes[0].id, "1h");
    useCompareStore.getState().addPane();
    const panes = useCompareStore.getState().panes;
    expect(panes).toHaveLength(2);
    expect(panes[1].layout).toBe("overlay");
    expect(panes[1].timeframe).toBe("1h");
  });

  it("addPane() refuses to exceed MAX_PANES", () => {
    while (useCompareStore.getState().panes.length < MAX_PANES) {
      useCompareStore.getState().addPane();
    }
    const before = useCompareStore.getState().panes.length;
    useCompareStore.getState().addPane();
    expect(useCompareStore.getState().panes.length).toBe(before);
  });

  it("removePane() removes by id", () => {
    useCompareStore.getState().addPane();
    const ids = useCompareStore.getState().panes.map((p) => p.id);
    useCompareStore.getState().removePane(ids[0]);
    const panes = useCompareStore.getState().panes;
    expect(panes).toHaveLength(1);
    expect(panes[0].id).toBe(ids[1]);
  });

  it("removePane() refuses to remove the last remaining pane", () => {
    const id = useCompareStore.getState().panes[0].id;
    useCompareStore.getState().removePane(id);
    expect(useCompareStore.getState().panes).toHaveLength(1);
  });

  it("setPaneLayout updates only the targeted pane", () => {
    useCompareStore.getState().addPane();
    const [first, second] = useCompareStore.getState().panes;
    useCompareStore.getState().setPaneLayout(second.id, "stockOnly");
    const after = useCompareStore.getState().panes;
    expect(after[0].layout).toBe("overlay");
    expect(after[1].layout).toBe("stockOnly");
    // First pane id unchanged
    expect(after[0].id).toBe(first.id);
  });

  it("setPaneTimeframe updates only the targeted pane", () => {
    useCompareStore.getState().addPane();
    const [, second] = useCompareStore.getState().panes;
    useCompareStore.getState().setPaneTimeframe(second.id, "1D");
    const after = useCompareStore.getState().panes;
    expect(after[1].timeframe).toBe("1D");
  });
});

describe("compare store — persistence", () => {
  it("writes to localStorage on change", () => {
    useCompareStore.getState().setReference("QQQ", 320227571);
    const raw = localStorage.getItem("parallax-compare-store");
    expect(raw).toBeTruthy();
    expect(raw).toContain("QQQ");
  });
});
