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
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
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
  TriggerRuleCreate,
} from "@/lib/api";

// ── Mock the API layer ───────────────────────────────────────

const mockGetLockedFibs = vi.fn();
const mockLockFib = vi.fn();
const mockUnlockFib = vi.fn();
const mockClearFib = vi.fn();
const mockGetFibConfig = vi.fn();
const mockCreateTriggerRule = vi.fn();
const mockGetWatchlists = vi.fn();
const mockGetRuleTemplates = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...mod,
    api: {
      ...mod.api,
      getLockedFibs: (conid: number) => mockGetLockedFibs(conid),
      lockFibonacci: (req: LockFibonacciRequest) => mockLockFib(req),
      unlockFibonacci: (id: number) => mockUnlockFib(id),
      clearLockedFibs: (conid: number) => mockClearFib(conid),
      getFibConfig: () => mockGetFibConfig(),
      createTriggerRule: (rule: TriggerRuleCreate) => mockCreateTriggerRule(rule),
      getWatchlists: () => mockGetWatchlists(),
      getRuleTemplates: () => mockGetRuleTemplates(),
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
  mockGetWatchlists.mockResolvedValue([]);
  mockGetRuleTemplates.mockResolvedValue([]);
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
  mockClearFib.mockResolvedValue({ deleted: 0, conid: 0 });
  mockCreateTriggerRule.mockImplementation(async (rule: TriggerRuleCreate) => ({
    ...rule,
    id: 123,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));

  useChartStore.getState().clearChart();
  useChartStore.getState().setActiveConid(265598);
  useChartStore.getState().setActiveSymbol("AAPL");
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
  it("opens a prefilled rule modal from the primary fib golden pocket", async () => {
    useChartStore.getState().setPrimaryFib(
      makeResult({
        levels: [
          { level: 0.618, price: 111.46, label: "0.618 (GP)", kind: "retracement", golden_pocket: true },
          { level: 0.65, price: 110.5, label: "0.65 (GP)", kind: "retracement", golden_pocket: true },
          { level: 0.716, price: 108.52, label: "0.716 (GP)", kind: "retracement", golden_pocket: true },
        ],
      }),
    );

    render(withQueryClient(createElement(FibStackPanel)));

    const btn = await screen.findByTestId("fib-create-alert-button");
    await act(async () => {
      fireEvent.click(btn);
    });

    expect(mockCreateTriggerRule).not.toHaveBeenCalled();
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Fib golden pocket: AAPL 1D")).toBeInTheDocument();
    expect(screen.getByDisplayValue("AAPL")).toBeInTheDocument();
    expect(screen.getByText("conid: 265598")).toBeInTheDocument();

    const indicators = screen.getAllByRole("combobox", { name: /indicator/i });
    expect(indicators.map((node) => (node as HTMLSelectElement).value)).toEqual(["close", "close"]);
    const thresholds = screen.getAllByRole("spinbutton", { name: /threshold/i });
    expect(thresholds.map((node) => (node as HTMLInputElement).value)).toEqual(["110.5", "111.46"]);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /create rule/i }));
    });

    await waitFor(() => expect(mockCreateTriggerRule).toHaveBeenCalledTimes(1));
    expect(mockCreateTriggerRule).toHaveBeenCalledWith({
      name: "Fib golden pocket: AAPL 1D",
      enabled: true,
      timeframe: "1D",
      scan_interval_seconds: 300,
      watchlist_name: null,
      conid: 265598,
      symbol: "AAPL",
      template_id: null,
      ibkr_mirror_target: null,
      conditions: [
        {
          indicator: "close",
          condition: "above",
          threshold: 110.5,
          news_candle_method: null,
        },
        {
          indicator: "close",
          condition: "below",
          threshold: 111.46,
          news_candle_method: null,
        },
      ],
    });
  });

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

  it("'Clear all' calls api.clearLockedFibs with the conid and empties the locked list", async () => {
    useChartStore.getState().setActiveConid(777);
    useChartStore.getState().addLockedFib(1, makeResult());
    useChartStore.getState().addLockedFib(2, makeResult());
    render(withQueryClient(createElement(FibStackPanel)));

    const clearBtn = await screen.findByTestId("fib-clear-all-button");
    await act(async () => {
      fireEvent.click(clearBtn);
    });

    expect(mockClearFib).toHaveBeenCalledTimes(1);
    expect(mockClearFib).toHaveBeenCalledWith(777);
    expect(
      useChartStore.getState().activeFibs.filter((f) => f.source === "locked"),
    ).toHaveLength(0);
  });

  it("clicking the eye toggle hides the fib (without deleting) and updates the count", async () => {
    // Seed via the server mock so the merge effect keeps the lock in the
    // store (addLockedFib would be wiped by the [] sync).
    const lock: LockedFibonacciResponse = {
      id: 55,
      conid: 265598,
      timeframe: "1D",
      tool_type: "retracement",
      swing_high_price: 130,
      swing_high_time: 1_700_000_000,
      swing_low_price: 100,
      swing_low_time: 1_699_900_000,
      direction: "up",
      user_note: null,
      locked_at: new Date().toISOString(),
    };
    mockGetLockedFibs.mockResolvedValue([lock]);
    useChartStore.getState().setActiveConid(265598);
    render(withQueryClient(createElement(FibStackPanel)));

    const eye = await screen.findByTestId("fib-locked-visibility-55");
    expect(screen.getByTestId("fib-stack-count").textContent).toMatch(/1/);

    await act(async () => {
      fireEvent.click(eye);
    });

    // Still present (not deleted) but now hidden, and excluded from the count.
    const fib = useChartStore
      .getState()
      .activeFibs.find((f) => f.id === "lock-55");
    expect(fib).toBeDefined();
    expect(fib?.hidden).toBe(true);
    expect(screen.getByTestId("fib-stack-count").textContent).toMatch(/0/);
  });

  it("does not render 'Clear all' when there are no locked fibs", () => {
    useChartStore.getState().setPrimaryFib(makeResult());
    render(withQueryClient(createElement(FibStackPanel)));
    expect(screen.queryByTestId("fib-clear-all-button")).toBeNull();
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

// ── Race fix: optimistic lock insertion ──────────────────────

describe("FibStackPanel — locking is optimistic (no_active_fib race fix)", () => {
  it("renders the locked fib before the server responds", async () => {
    // A lock POST that never resolves — only onMutate runs. This proves
    // the fib reaches the store optimistically, before any network reply,
    // which is what prevents the no_active_fib effect from racing ahead
    // and untoggling the indicator on the first draw.
    mockLockFib.mockImplementation(() => new Promise(() => {}));
    useChartStore.getState().setActiveConid(265598);
    useChartStore.getState().setPrimaryFib(makeResult());

    render(withQueryClient(createElement(FibStackPanel)));

    const btn = await screen.findByTestId("fib-lock-primary-button");
    await act(async () => {
      fireEvent.click(btn);
      // Flush onMutate's cancelQueries + setQueryData and the merge effect.
      await Promise.resolve();
      await Promise.resolve();
    });

    const locked = useChartStore
      .getState()
      .activeFibs.filter((f) => f.source === "locked");
    expect(locked).toHaveLength(1);
  });
});
