/**
 * Tests for FibStackPanel — Branch 4 of the fib improvements plan.
 *
 * Covers:
 *   - Count badge reflects activeFibs.length and turns warning at SOFT_CAP.
 *   - Hard cap disables the Lock button and the addLockedFib action.
 *   - Locked cards render with delete buttons that call useUnlockFib.
 *   - Lock button calls api.lockFibonacci with the primary's swing data.
 *   - Primary renders via FibScoreCard (existing tests cover the inner card).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import FibStackPanel from "../fib/FibStackPanel";
import {
  useChartStore,
  FIB_STACK_HARD_CAP,
  FIB_STACK_SOFT_CAP,
} from "@/store/chart";
import type {
  FibConfig,
  FibonacciResult,
  LockFibonacciRequest,
  LockedFibonacciResponse,
} from "@/lib/api";

// ── Mock the API layer ───────────────────────────────────────

const mockGetLockedFibs = vi.fn();
const mockLockFib = vi.fn();
const mockUnlockFib = vi.fn();
const mockGetFibConfig = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...mod,
    api: {
      ...mod.api,
      getLockedFibs: (conid: number) => mockGetLockedFibs(conid),
      lockFibonacci: (req: LockFibonacciRequest) => mockLockFib(req),
      unlockFibonacci: (id: number) => mockUnlockFib(id),
      getFibConfig: () => mockGetFibConfig(),
    },
  };
});

// ── Helpers ──────────────────────────────────────────────────

const DEFAULT_CONFIG: FibConfig = {
  ratios: [0, 0.382, 0.5, 0.618, 0.65, 0.716, 1.0],
  extension_ratios: [1.272, 1.618, 2.0],
  weights: {
    swing_clarity: 0.25,
    multi_touch: 0.25,
    rejection_intensity: 0.20,
    stretched_penalty: 0.15,
    recency: 0.15,
  },
};

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
    reasoning: "Active fib.",
    source: "auto",
    no_active_fib: false,
    no_active_fib_reason: null,
    ...overrides,
  };
}

function withQueryClient(children: ReactNode): ReactNode {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetFibConfig.mockResolvedValue(DEFAULT_CONFIG);
  mockGetLockedFibs.mockResolvedValue([]);
  mockLockFib.mockImplementation(async (req: LockFibonacciRequest) => ({
    id: 999,
    conid: req.conid,
    timeframe: req.timeframe,
    tool_type: req.tool_type,
    swing_high_price: req.swing_high_price,
    swing_high_time: req.swing_high_time,
    swing_low_price: req.swing_low_price,
    swing_low_time: req.swing_low_time,
    direction: req.direction,
    user_note: null,
    locked_at: new Date().toISOString(),
  } as LockedFibonacciResponse));
  mockUnlockFib.mockResolvedValue({ deleted: true, id: 0 });

  useChartStore.getState().clearChart();
  useChartStore.getState().setActiveConid(265598);
  useChartStore.getState().setTimeframe("1D");
});

// ── Tests ────────────────────────────────────────────────────

describe("FibStackPanel — count badge", () => {
  it("renders nothing when activeFibs is empty", () => {
    const { container } = render(
      withQueryClient(createElement(FibStackPanel)),
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows 'Fibs on chart: 1' when only the primary is set", async () => {
    useChartStore.getState().setPrimaryFib(makeResult());
    render(withQueryClient(createElement(FibStackPanel)));
    const badge = await screen.findByTestId("fib-stack-count");
    expect(badge.textContent).toMatch(/1/);
    expect(screen.queryByTestId("fib-stack-soft-warning")).toBeNull();
  });

  it("turns yellow + shows soft-warning text at SOFT_CAP", () => {
    useChartStore.getState().setPrimaryFib(makeResult());
    for (let i = 0; i < FIB_STACK_SOFT_CAP - 1; i += 1) {
      useChartStore.getState().addLockedFib(100 + i, makeResult());
    }
    expect(useChartStore.getState().activeFibs.length).toBe(
      FIB_STACK_SOFT_CAP,
    );

    render(withQueryClient(createElement(FibStackPanel)));
    expect(screen.getByTestId("fib-stack-soft-warning")).toBeTruthy();
  });

  it("disables the Lock button at HARD_CAP", () => {
    useChartStore.getState().setPrimaryFib(makeResult());
    for (let i = 0; i < FIB_STACK_HARD_CAP - 1; i += 1) {
      useChartStore.getState().addLockedFib(200 + i, makeResult());
    }
    expect(useChartStore.getState().activeFibs.length).toBe(
      FIB_STACK_HARD_CAP,
    );

    render(withQueryClient(createElement(FibStackPanel)));
    const btn = screen.getByTestId("fib-lock-primary-button");
    expect(btn).toBeDisabled();
  });
});

describe("FibStackPanel — lock + unlock", () => {
  it("Lock button calls api.lockFibonacci with the primary's swing data", async () => {
    useChartStore.getState().setPrimaryFib(
      makeResult({ swing_high: 200, swing_low: 150, direction: "up" }),
    );
    render(withQueryClient(createElement(FibStackPanel)));
    const btn = await screen.findByTestId("fib-lock-primary-button");

    await act(async () => {
      fireEvent.click(btn);
    });

    expect(mockLockFib).toHaveBeenCalledTimes(1);
    const [arg] = mockLockFib.mock.calls[0];
    expect(arg.conid).toBe(265598);
    expect(arg.swing_high_price).toBe(200);
    expect(arg.swing_low_price).toBe(150);
    expect(arg.direction).toBe("up");
    expect(arg.tool_type).toBe("retracement");
  });

  it("clicking × on a locked card calls api.unlockFibonacci", async () => {
    useChartStore.getState().addLockedFib(42, makeResult());
    render(withQueryClient(createElement(FibStackPanel)));

    const deleteBtn = await screen.findByTestId("fib-locked-delete-42");
    await act(async () => {
      fireEvent.click(deleteBtn);
    });

    expect(mockUnlockFib).toHaveBeenCalledTimes(1);
    expect(mockUnlockFib).toHaveBeenCalledWith(42);
  });

  it("rendered locked cards match the order they were added", () => {
    useChartStore.getState().addLockedFib(10, makeResult({ swing_high: 110 }));
    useChartStore.getState().addLockedFib(20, makeResult({ swing_high: 120 }));
    useChartStore.getState().addLockedFib(30, makeResult({ swing_high: 130 }));

    render(withQueryClient(createElement(FibStackPanel)));

    const list = screen.getByTestId("fib-locked-list");
    const cards = list.querySelectorAll("[data-testid^='fib-locked-card-']");
    expect(cards).toHaveLength(3);
    expect(cards[0].getAttribute("data-testid")).toBe("fib-locked-card-10");
    expect(cards[1].getAttribute("data-testid")).toBe("fib-locked-card-20");
    expect(cards[2].getAttribute("data-testid")).toBe("fib-locked-card-30");
  });
});

describe("FibStackPanel — no-active-fib primary suppresses Lock", () => {
  it("Lock button is disabled when the primary is a no_active_fib placeholder", async () => {
    useChartStore.getState().setPrimaryFib(
      makeResult({ no_active_fib: true, no_active_fib_reason: "no alive swing" }),
    );
    render(withQueryClient(createElement(FibStackPanel)));
    const btn = await screen.findByTestId("fib-lock-primary-button");
    expect(btn).toBeDisabled();
  });
});

// ── Bug 2 fixes ──────────────────────────────────────────────

describe("FibStackPanel — Bug 2 fixes", () => {
  it("locking clears displayedFibOverride so the primary returns to auto", async () => {
    useChartStore.getState().setPrimaryFib(
      makeResult({ swing_high: 200, swing_low: 150, direction: "up" }),
    );
    // Simulate the user having previously picked a candidate.
    useChartStore.getState().setDisplayedFib({
      swing_high: 180,
      swing_low: 160,
      swing_high_time: 1,
      swing_low_time: 0,
      direction: "up",
      score: 50,
      swing_clarity: 0.5,
      multi_touch_count: 0,
      rejection_intensity: 0,
      stretched_penalty: 0,
      recency: 1,
      is_nested: false,
      parent_index: null,
      status: "active",
    });
    expect(useChartStore.getState().displayedFibOverride).not.toBeNull();

    render(withQueryClient(createElement(FibStackPanel)));
    const btn = await screen.findByTestId("fib-lock-primary-button");
    await act(async () => {
      fireEvent.click(btn);
    });

    // Wait a microtask for onSuccess to fire.
    await act(async () => {
      await Promise.resolve();
    });

    // The override should now be cleared — primary "snaps back" to auto.
    expect(useChartStore.getState().displayedFibOverride).toBeNull();
  });

  it("unlocking removes the lock from activeFibs and does NOT re-add it on the next render", async () => {
    // Server starts with two locks. User clicks delete on lock-7;
    // optimistic cache write removes it; the server-side mock removes
    // it too (so the invalidation-driven refetch agrees). The store
    // should end up with just lock-8 — lock-7 gone for good.
    const mkLock = (id: number, high: number): LockedFibonacciResponse => ({
      id,
      conid: 265598,
      timeframe: "1D",
      tool_type: "retracement",
      swing_high_price: high,
      swing_high_time: 1_700_000_000,
      swing_low_price: 100,
      swing_low_time: 1_699_900_000,
      direction: "up",
      user_note: null,
      locked_at: new Date().toISOString(),
    });
    // "Server state" the mocks share. Real backend deletes on
    // DELETE /fibonacci/lock/{id}; we mimic that here.
    const serverState: LockedFibonacciResponse[] = [mkLock(7, 130), mkLock(8, 140)];
    mockGetLockedFibs.mockImplementation(async () => [...serverState]);
    mockUnlockFib.mockImplementation(async (id: number) => {
      const idx = serverState.findIndex((l) => l.id === id);
      if (idx !== -1) serverState.splice(idx, 1);
      return { deleted: true, id };
    });

    useChartStore.getState().setPrimaryFib(makeResult());

    render(withQueryClient(createElement(FibStackPanel)));

    // Wait for the GET to resolve and the merge effect to populate.
    const deleteBtn = await screen.findByTestId("fib-locked-delete-7");
    await act(async () => {
      fireEvent.click(deleteBtn);
    });
    await act(async () => {
      // Two flushes: one for the optimistic update, one for the
      // invalidation-driven refetch (which now agrees with the cache).
      await Promise.resolve();
      await Promise.resolve();
    });

    const fibs = useChartStore.getState().activeFibs;
    expect(fibs.find((f) => f.id === "lock-7")).toBeUndefined();
    expect(fibs.find((f) => f.id === "lock-8")).toBeDefined();
  });
});
