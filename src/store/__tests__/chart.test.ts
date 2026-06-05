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

  // ── Bug 2 / Phase A — replaceLockedFibs ──────────────────

  it("replaceLockedFibs preserves the primary and replaces locked entries", () => {
    useChartStore.getState().setPrimaryFib(makeResult({ score: 91 }));
    useChartStore.getState().addLockedFib(1, makeResult());
    useChartStore.getState().addLockedFib(2, makeResult());
    useChartStore.getState().addLockedFib(3, makeResult());
    expect(useChartStore.getState().activeFibs.length).toBe(4);

    // Server now reports only locks 2 and 5 (lock 1 was deleted, lock
    // 3 was never confirmed, lock 5 is new). Full sync.
    useChartStore.getState().replaceLockedFibs([
      { lockId: 2, result: makeResult() },
      { lockId: 5, result: makeResult() },
    ]);

    const fibs = useChartStore.getState().activeFibs;
    expect(fibs.map((f) => f.id)).toEqual(["primary", "lock-2", "lock-5"]);
    // Primary score preserved.
    expect(fibs[0].result.score).toBe(91);
  });

  it("replaceLockedFibs with empty array drops all locked but keeps primary", () => {
    useChartStore.getState().setPrimaryFib(makeResult());
    useChartStore.getState().addLockedFib(1, makeResult());
    useChartStore.getState().addLockedFib(2, makeResult());

    useChartStore.getState().replaceLockedFibs([]);

    const fibs = useChartStore.getState().activeFibs;
    expect(fibs.map((f) => f.id)).toEqual(["primary"]);
  });

  it("replaceLockedFibs assigns non-zero colorIndex values to each entry", () => {
    useChartStore.getState().setPrimaryFib(makeResult());

    useChartStore.getState().replaceLockedFibs([
      { lockId: 10, result: makeResult() },
      { lockId: 20, result: makeResult() },
      { lockId: 30, result: makeResult() },
    ]);

    const fibs = useChartStore.getState().activeFibs;
    expect(fibs[0].colorIndex).toBe(0); // primary
    for (const locked of fibs.slice(1)) {
      expect(locked.colorIndex).toBeGreaterThan(0);
      expect(locked.colorIndex).toBeLessThan(FIB_COLOR_PALETTE.length);
    }
  });

  it("toggleFibVisibility flips the hidden flag for the matching fib only", () => {
    useChartStore.getState().setPrimaryFib(makeResult());
    useChartStore.getState().addLockedFib(1, makeResult());
    useChartStore.getState().addLockedFib(2, makeResult());

    useChartStore.getState().toggleFibVisibility("lock-1");

    const fibs = useChartStore.getState().activeFibs;
    expect(fibs.find((f) => f.id === "lock-1")?.hidden).toBe(true);
    expect(fibs.find((f) => f.id === "lock-2")?.hidden).toBe(false);
    expect(fibs.find((f) => f.id === "primary")?.hidden).toBe(false);

    // Toggling again restores visibility.
    useChartStore.getState().toggleFibVisibility("lock-1");
    expect(
      useChartStore.getState().activeFibs.find((f) => f.id === "lock-1")?.hidden,
    ).toBe(false);
  });

  it("replaceLockedFibs preserves a fib's hidden state across a server sync", () => {
    useChartStore.getState().addLockedFib(7, makeResult());
    useChartStore.getState().toggleFibVisibility("lock-7");
    expect(
      useChartStore.getState().activeFibs.find((f) => f.id === "lock-7")?.hidden,
    ).toBe(true);

    // Server refetch re-sends the same lock — hidden must NOT reset.
    useChartStore.getState().replaceLockedFibs([
      { lockId: 7, result: makeResult() },
      { lockId: 8, result: makeResult() },
    ]);

    const fibs = useChartStore.getState().activeFibs;
    expect(fibs.find((f) => f.id === "lock-7")?.hidden).toBe(true);
    expect(fibs.find((f) => f.id === "lock-8")?.hidden).toBe(false);
  });

  it("replaceLockedFibs works when no primary is set", () => {
    useChartStore.getState().replaceLockedFibs([
      { lockId: 100, result: makeResult() },
      { lockId: 200, result: makeResult() },
    ]);
    const fibs = useChartStore.getState().activeFibs;
    expect(fibs.map((f) => f.id)).toEqual(["lock-100", "lock-200"]);
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

// ── Branch 7: setActiveConid full-reset behavior ────────────

describe("chart store — setActiveConid resets chart state (Branch 7)", () => {
  it("changing conid resets activeIndicators back to defaults (empty)", () => {
    useChartStore.getState().setActiveConid(265598);
    useChartStore.getState().toggleIndicator("rsi");
    useChartStore.getState().toggleIndicator("ema21");
    expect(useChartStore.getState().activeIndicators.size).toBe(2);

    useChartStore.getState().setActiveConid(8314);
    expect(useChartStore.getState().activeIndicators.size).toBe(0);
  });

  it("changing conid resets timeframe to 15m (default per UX feedback; plan decision 10A)", () => {
    useChartStore.getState().setActiveConid(265598);
    useChartStore.getState().setTimeframe("4h");
    expect(useChartStore.getState().timeframe).toBe("4h");

    useChartStore.getState().setActiveConid(8314);
    expect(useChartStore.getState().timeframe).toBe("15m");
  });

  it("changing conid clears fibDrawMode and fibDrawPointA", () => {
    useChartStore.getState().setActiveConid(265598);
    useChartStore.getState().enterFibDrawMode("retracement");
    useChartStore.getState().setFibDrawPointA({ time: 1, price: 100 });
    expect(useChartStore.getState().fibDrawMode).toBe("retracement");

    useChartStore.getState().setActiveConid(8314);
    expect(useChartStore.getState().fibDrawMode).toBeNull();
    expect(useChartStore.getState().fibDrawPointA).toBeNull();
  });

  it("changing conid clears displayedFibOverride, fibCleared, activeFibs", () => {
    useChartStore.getState().setActiveConid(265598);
    useChartStore.getState().setDisplayedFib(makeCandidate());
    useChartStore.getState().setPrimaryFib(makeResult());
    useChartStore.getState().addLockedFib(7, makeResult());
    useChartStore.getState().clearChartFib();
    expect(useChartStore.getState().fibCleared).toBe(true);
    expect(useChartStore.getState().activeFibs.length).toBeGreaterThan(0);

    useChartStore.getState().setActiveConid(8314);
    expect(useChartStore.getState().displayedFibOverride).toBeNull();
    expect(useChartStore.getState().fibCleared).toBe(false);
    expect(useChartStore.getState().activeFibs).toEqual([]);
  });

  it("same conid is idempotent — no state changes (plan decision 10B note)", () => {
    useChartStore.getState().setActiveConid(265598);
    useChartStore.getState().toggleIndicator("rsi");
    useChartStore.getState().setTimeframe("4h");
    useChartStore.getState().setPrimaryFib(makeResult());

    // Snapshot the things that should NOT change on a same-conid set.
    const before = useChartStore.getState();
    const beforeSnapshot = {
      timeframe: before.timeframe,
      indicators: new Set(before.activeIndicators),
      activeFibs: before.activeFibs,
    };

    useChartStore.getState().setActiveConid(265598);

    const after = useChartStore.getState();
    expect(after.timeframe).toBe(beforeSnapshot.timeframe);
    expect(after.activeIndicators).toEqual(beforeSnapshot.indicators);
    expect(after.activeFibs).toBe(beforeSnapshot.activeFibs); // reference equality — no recreation
  });

  it("does not overwrite activeSymbol — the resolver owns that field", () => {
    useChartStore.getState().setActiveSymbol("AAPL");
    useChartStore.getState().setActiveConid(265598);
    // Setting conid alone must not clear the symbol the resolver
    // wrote a moment earlier (they're set in close succession by the
    // resolveConidMutation onSuccess).
    expect(useChartStore.getState().activeSymbol).toBe("AAPL");
  });
});
