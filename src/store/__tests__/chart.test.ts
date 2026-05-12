/**
 * Tests for the chart store — Branch 3 additions:
 *   - displayedFibOverride state + setDisplayedFib / clearDisplayedFib
 *   - fibCleared state + clearChartFib
 *   - reset behavior on timeframe + conid changes
 *
 * The store is global Zustand; each test starts by snapshotting and
 * restoring the initial state to keep them isolated.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { useChartStore } from "../chart";
import type { FibonacciCandidate } from "@/lib/api";

// ── Helpers ──────────────────────────────────────────────────

function makeCandidate(
  overrides: Partial<FibonacciCandidate> = {},
): FibonacciCandidate {
  return {
    swing_high: 130,
    swing_low: 100,
    swing_high_time: 1_700_000_000,
    swing_low_time: 1_699_900_000,
    direction: "up",
    score: 70,
    swing_clarity: 0.8,
    multi_touch_count: 0,
    rejection_intensity: 0.3,
    stretched_penalty: 0.5,
    recency: 0.9,
    is_nested: false,
    parent_index: null,
    status: "active",
    ...overrides,
  };
}

beforeEach(() => {
  // Reset to defaults before every test so global Zustand state
  // doesn't leak between cases.
  useChartStore.getState().clearChart();
});

// ── displayedFibOverride ────────────────────────────────────

describe("chart store — displayedFibOverride", () => {
  it("starts as null", () => {
    expect(useChartStore.getState().displayedFibOverride).toBeNull();
  });

  it("setDisplayedFib stores the candidate and un-clears fibCleared", () => {
    useChartStore.getState().clearChartFib(); // fibCleared = true
    expect(useChartStore.getState().fibCleared).toBe(true);

    const c = makeCandidate({ score: 88 });
    useChartStore.getState().setDisplayedFib(c);

    const state = useChartStore.getState();
    expect(state.displayedFibOverride).toBe(c);
    expect(state.fibCleared).toBe(false);
  });

  it("clearDisplayedFib resets to null but does NOT touch fibCleared", () => {
    const c = makeCandidate();
    useChartStore.getState().setDisplayedFib(c);
    useChartStore.getState().clearDisplayedFib();
    expect(useChartStore.getState().displayedFibOverride).toBeNull();
    expect(useChartStore.getState().fibCleared).toBe(false);
  });
});

// ── fibCleared ───────────────────────────────────────────────

describe("chart store — fibCleared", () => {
  it("starts as false", () => {
    expect(useChartStore.getState().fibCleared).toBe(false);
  });

  it("clearChartFib sets fibCleared and removes any override", () => {
    useChartStore.getState().setDisplayedFib(makeCandidate());
    useChartStore.getState().clearChartFib();
    const state = useChartStore.getState();
    expect(state.fibCleared).toBe(true);
    expect(state.displayedFibOverride).toBeNull();
  });
});

// ── Reset behavior ───────────────────────────────────────────

describe("chart store — reset on timeframe change", () => {
  it("changing timeframe clears displayedFibOverride and fibCleared", () => {
    useChartStore.getState().setDisplayedFib(makeCandidate());
    useChartStore.getState().clearChartFib(); // re-set fibCleared explicitly
    useChartStore.getState().clearChartFib();
    useChartStore.getState().setTimeframe("4h");
    const state = useChartStore.getState();
    expect(state.timeframe).toBe("4h");
    expect(state.displayedFibOverride).toBeNull();
    expect(state.fibCleared).toBe(false);
  });
});

describe("chart store — clearChart resets fib state", () => {
  it("clearChart wipes both fib fields", () => {
    useChartStore.getState().setDisplayedFib(makeCandidate());
    useChartStore.getState().clearChartFib();
    useChartStore.getState().clearChart();
    const state = useChartStore.getState();
    expect(state.displayedFibOverride).toBeNull();
    expect(state.fibCleared).toBe(false);
    expect(state.activeConid).toBeNull();
  });
});
