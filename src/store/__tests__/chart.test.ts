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

import {
  FIB_COLOR_PALETTE,
  FIB_STACK_HARD_CAP,
  FIB_STACK_SOFT_CAP,
  useChartStore,
} from "../chart";
import type { FibonacciCandidate, FibonacciResult } from "@/lib/api";

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

function makeResult(overrides: Partial<FibonacciResult> = {}): FibonacciResult {
  return {
    tool_mode: "retracement",
    swing_high: 130,
    swing_low: 100,
    swing_high_time: 1_700_000_000,
    swing_low_time: 1_699_900_000,
    direction: "up",
    levels: [],
    extensions: [],
    score: 75,
    swing_clarity: 0.82,
    timeframe_clarity: "clean",
    candidates: [],
    convergence_zones: [],
    is_nested: false,
    parent_fib_id: null,
    reasoning: "",
    source: "auto",
    no_active_fib: false,
    no_active_fib_reason: null,
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

// ── Branch 4: activeFibs stack ──────────────────────────────

describe("chart store — activeFibs (Branch 4)", () => {
  it("starts empty", () => {
    expect(useChartStore.getState().activeFibs).toEqual([]);
  });

  it("setPrimaryFib pushes a primary entry at index 0 with colorIndex=0", () => {
    useChartStore.getState().setPrimaryFib(makeResult({ score: 80 }));
    const fibs = useChartStore.getState().activeFibs;
    expect(fibs).toHaveLength(1);
    expect(fibs[0].id).toBe("primary");
    expect(fibs[0].source).toBe("auto");
    expect(fibs[0].colorIndex).toBe(0);
    expect(fibs[0].result.score).toBe(80);
  });

  it("setPrimaryFib replaces any existing primary (no duplicates)", () => {
    useChartStore.getState().setPrimaryFib(makeResult({ score: 50 }));
    useChartStore.getState().setPrimaryFib(makeResult({ score: 70 }));
    const fibs = useChartStore.getState().activeFibs;
    expect(fibs).toHaveLength(1);
    expect(fibs[0].result.score).toBe(70);
  });

  it("setPrimaryFib(null) removes the primary but keeps locked entries", () => {
    useChartStore.getState().setPrimaryFib(makeResult());
    useChartStore.getState().addLockedFib(101, makeResult());
    useChartStore.getState().setPrimaryFib(null);
    const fibs = useChartStore.getState().activeFibs;
    expect(fibs).toHaveLength(1);
    expect(fibs[0].id).toBe("lock-101");
  });

  it("addLockedFib appends a locked entry with a non-zero colorIndex", () => {
    useChartStore.getState().setPrimaryFib(makeResult());
    const ok = useChartStore.getState().addLockedFib(42, makeResult());
    expect(ok).toBe(true);
    const fibs = useChartStore.getState().activeFibs;
    expect(fibs).toHaveLength(2);
    expect(fibs[1].id).toBe("lock-42");
    expect(fibs[1].source).toBe("locked");
    expect(fibs[1].lockId).toBe(42);
    expect(fibs[1].colorIndex).toBeGreaterThan(0);
    expect(fibs[1].colorIndex).toBeLessThan(FIB_COLOR_PALETTE.length);
  });

  it("addLockedFib dedupes by lockId (no-op when already in list)", () => {
    useChartStore.getState().addLockedFib(7, makeResult());
    useChartStore.getState().addLockedFib(7, makeResult({ score: 99 }));
    const fibs = useChartStore.getState().activeFibs;
    expect(fibs).toHaveLength(1);
    expect(fibs[0].lockId).toBe(7);
  });

  it("addLockedFib refuses to add past FIB_STACK_HARD_CAP and returns false", () => {
    for (let i = 0; i < FIB_STACK_HARD_CAP; i += 1) {
      useChartStore.getState().addLockedFib(1000 + i, makeResult());
    }
    expect(useChartStore.getState().activeFibs).toHaveLength(FIB_STACK_HARD_CAP);
    const result = useChartStore.getState().addLockedFib(9999, makeResult());
    expect(result).toBe(false);
    expect(useChartStore.getState().activeFibs).toHaveLength(FIB_STACK_HARD_CAP);
  });

  it("assigns distinct colorIndex values across multiple locks (under HARD_CAP)", () => {
    for (let i = 0; i < FIB_STACK_HARD_CAP - 1; i += 1) {
      useChartStore.getState().addLockedFib(2000 + i, makeResult());
    }
    const fibs = useChartStore.getState().activeFibs;
    const indices = fibs.map((f) => f.colorIndex);
    const unique = new Set(indices);
    expect(unique.size).toBe(indices.length);
  });

  it("removeActiveFib drops the matching entry", () => {
    useChartStore.getState().setPrimaryFib(makeResult());
    useChartStore.getState().addLockedFib(11, makeResult());
    useChartStore.getState().addLockedFib(12, makeResult());

    useChartStore.getState().removeActiveFib("lock-11");
    const fibs = useChartStore.getState().activeFibs;
    expect(fibs.map((f) => f.id)).toEqual(["primary", "lock-12"]);
  });

  it("clearAllActiveFibs wipes the list", () => {
    useChartStore.getState().setPrimaryFib(makeResult());
    useChartStore.getState().addLockedFib(33, makeResult());
    useChartStore.getState().clearAllActiveFibs();
    expect(useChartStore.getState().activeFibs).toEqual([]);
  });

  it("clearChartFib removes the primary but keeps locked fibs", () => {
    useChartStore.getState().setPrimaryFib(makeResult());
    useChartStore.getState().addLockedFib(55, makeResult());
    useChartStore.getState().clearChartFib();
    const fibs = useChartStore.getState().activeFibs;
    expect(fibs.map((f) => f.id)).toEqual(["lock-55"]);
    expect(useChartStore.getState().fibCleared).toBe(true);
  });

  it("setTimeframe clears the entire stack (locked fibs re-fetched per TF context)", () => {
    useChartStore.getState().setPrimaryFib(makeResult());
    useChartStore.getState().addLockedFib(66, makeResult());
    useChartStore.getState().setTimeframe("4h");
    expect(useChartStore.getState().activeFibs).toEqual([]);
  });

  it("clearChart wipes activeFibs along with everything else", () => {
    useChartStore.getState().setPrimaryFib(makeResult());
    useChartStore.getState().addLockedFib(77, makeResult());
    useChartStore.getState().clearChart();
    expect(useChartStore.getState().activeFibs).toEqual([]);
  });

  // Reminder constants — locked here so a future PR that fiddles with
  // the caps trips a test and forces an explicit decision.
  it("FIB_STACK_SOFT_CAP=5 and FIB_STACK_HARD_CAP=8 (plan decision 8B)", () => {
    expect(FIB_STACK_SOFT_CAP).toBe(5);
    expect(FIB_STACK_HARD_CAP).toBe(8);
  });
});
