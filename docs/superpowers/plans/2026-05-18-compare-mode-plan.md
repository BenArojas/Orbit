# Compare Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated Compare Mode to the Analysis page — a stack of 1–3 dual-axis panes that overlay the primary stock against a shared reference symbol (default SPY), faithful to @ultrawavetrader's "clean chart, no indicators" methodology.

**Architecture:** New `CompareChart` component built directly on Lightweight Charts v5 (not a fork of `ChartContainer`); new Zustand store (`compare`) persisted to localStorage; new data hook `useCompareData` that reuses the existing `api.computeIndicators` endpoint with an empty indicator list and the existing WebSocket singleton. Conditional rendering at the AnalysisPage level swaps the chart area for `<CompareView />`. Backend untouched.

**Tech Stack:** TypeScript · React 19 · Zustand 5 · TanStack Query 5 · Lightweight Charts 5.1 · Tailwind v4 · Vitest + React Testing Library · `crypto.randomUUID()` for pane IDs (no new deps).

**Spec:** [docs/superpowers/specs/2026-05-18-compare-mode-design.md](../specs/2026-05-18-compare-mode-design.md)

---

## Prerequisites

**Branch off `dev`, not main.** All file paths in this plan reference the dev-branch state. Main has only scaffolding; the real codebase (AnalysisPage, ChartContainer, useChartData, the stores, etc.) lives on dev. Before starting:

```bash
git fetch origin
git checkout dev
git pull origin dev
git checkout -b feature/compare-mode
```

Confirm the worktree has the files this plan references:

```bash
test -f src/pages/AnalysisPage.tsx && \
test -f src/hooks/useChartData.ts && \
test -f src/hooks/useWebSocket.ts && \
test -f src/store/chart.ts && \
echo "OK — on dev"
```

Expected: `OK — on dev`. If the test fails, you are on the wrong branch.

## File map

**New files (8):**

| Path | Responsibility |
|---|---|
| `src/store/compare.ts` | Zustand store. Mode active flag, reference, panes list, actions. Persisted to localStorage. |
| `src/store/__tests__/compare.test.ts` | Store tests. |
| `src/hooks/useCompareData.ts` | Per-pane data hook. Stock + reference candles via TanStack Query; live ticks via WS singleton. |
| `src/hooks/__tests__/useCompareData.test.ts` | Hook tests. |
| `src/components/compare/CompareChart.tsx` | Dedicated dual-axis chart. 1–2 candle series + conditional volume + custom OHLC legend. |
| `src/components/compare/ComparePane.tsx` | Single pane wrapper — PaneToolbar + CompareChart. |
| `src/components/compare/PaneToolbar.tsx` | Per-pane controls (TF pills, layout dropdown, ✕ close). |
| `src/components/compare/CompareModeHeader.tsx` | Header bar — primary stock label + reference input + Add pane + Exit. |
| `src/components/compare/CompareView.tsx` | Container — wires header + pane list. |
| `src/components/compare/index.ts` | Barrel exports. |
| `src/components/compare/__tests__/CompareChart.test.tsx` | Component tests. |
| `src/components/compare/__tests__/ComparePane.test.tsx` | Component tests. |
| `src/components/compare/__tests__/PaneToolbar.test.tsx` | Component tests. |
| `src/components/compare/__tests__/CompareModeHeader.test.tsx` | Component tests. |
| `src/components/compare/__tests__/CompareView.test.tsx` | Component tests. |

**Modified files (3):**

| Path | Change |
|---|---|
| `src/hooks/useWebSocket.ts` | Add ref-counting to `subscriptions` so multiple consumers of the same conid don't fight. Backward-compatible: single-consumer behavior is unchanged. |
| `src/pages/AnalysisPage.tsx` | Add Compare toggle button, `C` keyboard shortcut, conditional render of `<CompareView />`, AI panel auto-collapse on enter, watchlist-click force-exit handler. |
| `src/store/index.ts` | Re-export the compare store. |

---

## Task 1: Ref-count WS subscriptions

**Why:** the existing `useWebSocket` singleton uses `subscriptions: Set<number>`. If two consumers (e.g. main chart + a compare pane) both `subscribe(265598)`, then one calls `unsubscribe(265598)`, the conid is removed from the Set — the other consumer loses live data. Compare mode WILL trigger this scenario. Convert to a refcount map and only emit subscribe/unsubscribe to the server on the 0↔1 transition.

**Files:**
- Modify: `src/hooks/useWebSocket.ts`
- Modify: `src/hooks/__tests__/useChartData.test.ts` (already mocks useWebSocket, no real change expected but verify)

- [ ] **Step 1.1: Read the current subscriptions data structure**

Run: `grep -n "subscriptions" src/hooks/useWebSocket.ts`

Expected to find:
- `const subscriptions = new Set<number>();`
- `subscriptions.add(conid)` in `subscribe`
- `subscriptions.delete(conid)` in `unsubscribe`
- `for (const conid of subscriptions)` in `onopen` (resubscribe loop)
- `subscriptions.clear()` in `__resetWebSocketSingletonForTests`

- [ ] **Step 1.2: Write failing test for refcount behavior**

Append to `src/hooks/__tests__/useChartData.test.ts`? No — this lives in `useWebSocket`. There is no existing `useWebSocket` test file. Create one.

Create `src/hooks/__tests__/useWebSocket.test.ts`:

```ts
/**
 * Tests for useWebSocket — subscription ref-counting.
 *
 * The singleton must keep a conid subscribed as long as ANY consumer
 * holds a subscription on it. unsubscribe() decrements; only the last
 * release emits the server-side unsubscribe.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWebSocket, __resetWebSocketSingletonForTests } from "../useWebSocket";

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
}

beforeEach(() => {
  __resetWebSocketSingletonForTests();
  MockWebSocket.instances = [];
  // @ts-expect-error overriding global
  globalThis.WebSocket = MockWebSocket;
});

describe("useWebSocket subscription refcounting", () => {
  it("only emits one subscribe to the server when two consumers subscribe to the same conid", () => {
    const { result: a } = renderHook(() => useWebSocket());
    const { result: b } = renderHook(() => useWebSocket());

    const sock = MockWebSocket.instances[0];
    act(() => sock.open());

    act(() => {
      a.current.subscribe(123);
      b.current.subscribe(123);
    });

    const subMsgs = sock.sent.filter((s) => s.includes('"action":"subscribe"') && s.includes('"conid":123'));
    expect(subMsgs).toHaveLength(1);
  });

  it("keeps the subscription alive when one of two consumers unsubscribes", () => {
    const { result: a } = renderHook(() => useWebSocket());
    const { result: b } = renderHook(() => useWebSocket());

    const sock = MockWebSocket.instances[0];
    act(() => sock.open());

    act(() => {
      a.current.subscribe(123);
      b.current.subscribe(123);
      a.current.unsubscribe(123);
    });

    const unsubMsgs = sock.sent.filter((s) => s.includes('"action":"unsubscribe"') && s.includes('"conid":123'));
    expect(unsubMsgs).toHaveLength(0);
  });

  it("emits the server-side unsubscribe only when the last consumer releases", () => {
    const { result: a } = renderHook(() => useWebSocket());
    const { result: b } = renderHook(() => useWebSocket());

    const sock = MockWebSocket.instances[0];
    act(() => sock.open());

    act(() => {
      a.current.subscribe(123);
      b.current.subscribe(123);
      a.current.unsubscribe(123);
      b.current.unsubscribe(123);
    });

    const unsubMsgs = sock.sent.filter((s) => s.includes('"action":"unsubscribe"') && s.includes('"conid":123'));
    expect(unsubMsgs).toHaveLength(1);
  });

  it("re-subscribes each held conid exactly once on reconnect", () => {
    const { result: a } = renderHook(() => useWebSocket());
    const { result: b } = renderHook(() => useWebSocket());

    let sock = MockWebSocket.instances[0];
    act(() => sock.open());

    act(() => {
      a.current.subscribe(123);
      b.current.subscribe(123);
      a.current.subscribe(456);
    });

    // Simulate disconnect → reconnect
    act(() => sock.onclose?.());
    // The hook's reconnect logic creates a new socket asynchronously; force it by
    // calling the second instance's open if/when present. Since reconnect uses
    // setTimeout, drive it with vi.useFakeTimers in a real test if needed.
    // For this assertion we just verify the resubscribe iteration is per-conid, not per-refcount:
    // we re-open the most recent instance.
    vi.useFakeTimers();
    act(() => { vi.advanceTimersByTime(1500); });
    vi.useRealTimers();

    sock = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    act(() => sock.open());

    const subMsgs = sock.sent.filter((s) => s.includes('"action":"subscribe"'));
    // 123 and 456 each subscribed exactly once on reconnect — refcount of 2 for 123 should NOT cause 2 messages.
    expect(subMsgs.filter((s) => s.includes('"conid":123'))).toHaveLength(1);
    expect(subMsgs.filter((s) => s.includes('"conid":456'))).toHaveLength(1);
  });
});
```

- [ ] **Step 1.3: Run the new test to verify it fails**

Run: `npx vitest run src/hooks/__tests__/useWebSocket.test.ts`

Expected: FAIL — refcounting not yet implemented; the first test should report two subscribe messages, not one.

- [ ] **Step 1.4: Implement refcounting in `useWebSocket.ts`**

Open `src/hooks/useWebSocket.ts`. Find the line:

```ts
const subscriptions = new Set<number>();
```

Replace with:

```ts
const subscriptions = new Map<number, number>(); // conid → refcount
```

Find the `subscribe` callback (inside `useWebSocket`):

```ts
const subscribe = useCallback((conid: number) => {
  subscriptions.add(conid);
  send({ action: "subscribe", conid });
}, []);
```

Replace with:

```ts
const subscribe = useCallback((conid: number) => {
  const prev = subscriptions.get(conid) ?? 0;
  subscriptions.set(conid, prev + 1);
  if (prev === 0) {
    send({ action: "subscribe", conid });
  }
}, []);
```

Find the `unsubscribe` callback:

```ts
const unsubscribe = useCallback((conid: number) => {
  subscriptions.delete(conid);
  send({ action: "unsubscribe", conid });
}, []);
```

Replace with:

```ts
const unsubscribe = useCallback((conid: number) => {
  const prev = subscriptions.get(conid) ?? 0;
  if (prev <= 0) return;
  if (prev === 1) {
    subscriptions.delete(conid);
    send({ action: "unsubscribe", conid });
  } else {
    subscriptions.set(conid, prev - 1);
  }
}, []);
```

Find the `onopen` reconnect loop:

```ts
sock.onopen = () => {
  reconnectAttempt = 0;
  setStatus("connected");
  // Re-subscribe to all active conids after (re)connect
  for (const conid of subscriptions) {
    sock.send(JSON.stringify({ action: "subscribe", conid }));
  }
};
```

Replace `for (const conid of subscriptions)` with `for (const conid of subscriptions.keys())`. Final:

```ts
sock.onopen = () => {
  reconnectAttempt = 0;
  setStatus("connected");
  for (const conid of subscriptions.keys()) {
    sock.send(JSON.stringify({ action: "subscribe", conid }));
  }
};
```

Find `__resetWebSocketSingletonForTests` — the line `subscriptions.clear();` works for both `Set` and `Map` so no change needed.

- [ ] **Step 1.5: Run the new test to verify it passes**

Run: `npx vitest run src/hooks/__tests__/useWebSocket.test.ts`

Expected: PASS — all four cases.

- [ ] **Step 1.6: Run the full chart-data test to verify no regression**

Run: `npx vitest run src/hooks/__tests__/useChartData.test.ts`

Expected: PASS — useChartData mocks useWebSocket so it's insulated, but confirms nothing else broke.

- [ ] **Step 1.7: Commit**

```bash
git add src/hooks/useWebSocket.ts src/hooks/__tests__/useWebSocket.test.ts
git commit -m "refactor(ws): ref-count subscriptions so shared consumers don't fight

Multiple consumers (e.g. main chart + a compare pane on the same conid)
previously raced: the second unsubscribe would tear down the live
feed even though the first consumer still needed it. Convert
subscriptions to a Map<conid, refcount>; emit subscribe/unsubscribe
to the server only on the 0↔1 boundary.

Precondition for compare-mode panes."
```

---

## Task 2: Compare Zustand store

**Files:**
- Create: `src/store/compare.ts`
- Create: `src/store/__tests__/compare.test.ts`
- Modify: `src/store/index.ts`

**Deliberate spec deviation:** the spec (§6 "User reloads page mid-compare") suggests `active: true` is also persisted so compare mode auto-resumes on reload. This plan **does NOT persist the `active` flag** — only the user's preferences (reference symbol, pane configurations). Reasoning: auto-resuming into compare mode interacts badly with the chart store which is not persisted (so `activeConid` is null on reload and panes can't fetch). Sticky panes + reference is the right ergonomic compromise — re-entering compare mode with `C` restores everything except the boot-up state. Flag for the user during plan review if they want it changed.

- [ ] **Step 2.1: Write the failing test**

Create `src/store/__tests__/compare.test.ts`:

```ts
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
```

- [ ] **Step 2.2: Run the test to verify it fails**

Run: `npx vitest run src/store/__tests__/compare.test.ts`

Expected: FAIL with `Cannot find module '../compare'`.

- [ ] **Step 2.3: Implement the store**

Create `src/store/compare.ts`:

```ts
/**
 * Compare Store — Analysis-page Compare Mode state.
 *
 * Owns the active flag, shared reference symbol, and the stack of
 * configurable panes. Persisted to localStorage so the user's reference
 * + last pane configuration survives a reload.
 *
 * Reference conid is intentionally NOT persisted (cleared on rehydrate)
 * because IBKR can re-issue conids — we always re-resolve on entry.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import type { Timeframe } from "@/store/chart";

export type Layout = "overlay" | "stockOnly" | "refOnly";

export interface ComparePane {
  id: string;
  layout: Layout;
  timeframe: Timeframe;
}

export interface CompareReference {
  symbol: string;
  conid: number | null;
}

interface CompareState {
  active: boolean;
  reference: CompareReference;
  panes: ComparePane[];

  enter: (initialTimeframe: Timeframe) => void;
  exit: () => void;
  setReference: (symbol: string, conid: number) => void;
  /** Internal — used when symbol changes before resolution completes. */
  setReferenceSymbol: (symbol: string) => void;
  addPane: () => void;
  removePane: (id: string) => void;
  setPaneLayout: (id: string, layout: Layout) => void;
  setPaneTimeframe: (id: string, tf: Timeframe) => void;

  /** Test-only reset. Not part of the runtime API. */
  __resetForTests: () => void;
}

export const MAX_PANES = 3;
export const DEFAULT_REFERENCE: CompareReference = { symbol: "SPY", conid: null };

function newPaneId(): string {
  // crypto.randomUUID is available in modern browsers and Tauri's webview.
  return crypto.randomUUID();
}

const initialState = {
  active: false,
  reference: { ...DEFAULT_REFERENCE },
  panes: [] as ComparePane[],
};

export const useCompareStore = create<CompareState>()(
  persist(
    (set, get) => ({
      ...initialState,

      enter: (initialTimeframe) =>
        set((state) => {
          if (state.panes.length > 0) {
            // Sticky re-entry — keep the last configuration.
            return { active: true };
          }
          return {
            active: true,
            panes: [
              {
                id: newPaneId(),
                layout: "overlay" as Layout,
                timeframe: initialTimeframe,
              },
            ],
          };
        }),

      exit: () => set({ active: false }),

      setReference: (symbol, conid) =>
        set({ reference: { symbol, conid } }),

      setReferenceSymbol: (symbol) =>
        set((state) => ({
          reference: { symbol, conid: state.reference.symbol === symbol ? state.reference.conid : null },
        })),

      addPane: () =>
        set((state) => {
          if (state.panes.length >= MAX_PANES) return {};
          const last = state.panes[state.panes.length - 1];
          const timeframe = last?.timeframe ?? "1D";
          return {
            panes: [
              ...state.panes,
              { id: newPaneId(), layout: "overlay" as Layout, timeframe },
            ],
          };
        }),

      removePane: (id) =>
        set((state) => {
          if (state.panes.length <= 1) return {};
          return { panes: state.panes.filter((p) => p.id !== id) };
        }),

      setPaneLayout: (id, layout) =>
        set((state) => ({
          panes: state.panes.map((p) => (p.id === id ? { ...p, layout } : p)),
        })),

      setPaneTimeframe: (id, tf) =>
        set((state) => ({
          panes: state.panes.map((p) => (p.id === id ? { ...p, timeframe: tf } : p)),
        })),

      __resetForTests: () => set({ ...initialState, reference: { ...DEFAULT_REFERENCE } }),
    }),
    {
      name: "parallax-compare-store",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        // Persist the user's preferences but NOT the live `active` flag
        // (compare mode shouldn't auto-resume on reload) and NOT the
        // resolved conid (IBKR can re-issue them — always re-resolve).
        reference: { symbol: state.reference.symbol, conid: null },
        panes: state.panes,
      }),
    },
  ),
);
```

- [ ] **Step 2.4: Re-export from the store barrel**

Open `src/store/index.ts`. Append after the existing exports:

```ts
export {
  useCompareStore,
  MAX_PANES as COMPARE_MAX_PANES,
  DEFAULT_REFERENCE as COMPARE_DEFAULT_REFERENCE,
  type Layout as CompareLayout,
  type ComparePane,
  type CompareReference,
} from "./compare";
```

- [ ] **Step 2.5: Run the test to verify it passes**

Run: `npx vitest run src/store/__tests__/compare.test.ts`

Expected: PASS — all cases.

- [ ] **Step 2.6: Commit**

```bash
git add src/store/compare.ts src/store/__tests__/compare.test.ts src/store/index.ts
git commit -m "feat(compare): add compare-mode Zustand store + persist middleware

Active flag, shared reference symbol (SPY default), pane stack
(layout + timeframe per pane). Caps at 3 panes. Persists user
preferences to localStorage but never the live active flag or
resolved conid (IBKR can re-issue conids — always re-resolve)."
```

---

## Task 3: useCompareData hook

**Files:**
- Create: `src/hooks/useCompareData.ts`
- Create: `src/hooks/__tests__/useCompareData.test.ts`

- [ ] **Step 3.1: Write the failing test**

Create `src/hooks/__tests__/useCompareData.test.ts`:

```ts
/**
 * Tests for useCompareData — per-pane data fetching for compare mode.
 *
 * Covers:
 *   - candle queries fire with empty indicator list
 *   - query keys use the same shape as useChartData so caches share
 *   - layout='stockOnly' skips the reference query and ref-WS subscribe
 *   - layout='refOnly' skips the stock query and stock-WS subscribe
 *   - WS subscribe/unsubscribe on mount/unmount and layout change
 *   - liveTick state updates only when conid matches the incoming message
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { useCompareData } from "../useCompareData";

const mockComputeIndicators = vi.fn();
const mockSubscribe = vi.fn();
const mockUnsubscribe = vi.fn();
const mockAddHandler = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    computeIndicators: (...args: unknown[]) => mockComputeIndicators(...args),
  },
}));

vi.mock("../useWebSocket", () => ({
  useWebSocket: () => ({
    status: "connected",
    subscribe: mockSubscribe,
    unsubscribe: mockUnsubscribe,
    addHandler: (h: unknown) => { mockAddHandler(h); return () => {}; },
  }),
}));

vi.mock("@/context/GatewayContext", () => ({
  useIbkrReady: () => true,
}));

const MOCK_RESPONSE = {
  conid: 0,
  timeframe: "1D" as const,
  period: "1y",
  candles: [{ time: 1700000000, open: 1, high: 2, low: 1, close: 2, volume: 100 }],
  indicators: [],
  fibonacci: null,
};

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrapper(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockComputeIndicators.mockResolvedValue(MOCK_RESPONSE);
});

describe("useCompareData — overlay layout", () => {
  it("fetches both stock and reference candles with empty indicator list", async () => {
    const client = makeClient();
    renderHook(() => useCompareData(265598, 320227571, "5m", "overlay"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(mockComputeIndicators).toHaveBeenCalledTimes(2));

    const calls = mockComputeIndicators.mock.calls.map((c) => c[0] as { conid: number; indicators: string[] });
    const conids = calls.map((c) => c.conid).sort();
    expect(conids).toEqual([265598, 320227571].sort());
    for (const call of calls) {
      expect(call.indicators).toEqual([]);
    }
  });

  it("uses query keys that match useChartData (cache-shared)", async () => {
    const client = makeClient();
    renderHook(() => useCompareData(265598, 320227571, "5m", "overlay"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(mockComputeIndicators).toHaveBeenCalled());

    const queryCache = client.getQueryCache();
    const keys = queryCache.getAll().map((q) => q.queryKey);
    expect(keys).toContainEqual(["candles", 265598, "5m", "3M"]);
    expect(keys).toContainEqual(["candles", 320227571, "5m", "3M"]);
  });

  it("subscribes to both conids via WS", async () => {
    const client = makeClient();
    renderHook(() => useCompareData(265598, 320227571, "5m", "overlay"), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(mockSubscribe).toHaveBeenCalledWith(265598));
    expect(mockSubscribe).toHaveBeenCalledWith(320227571);
  });
});

describe("useCompareData — stockOnly layout", () => {
  it("does not fetch the reference candles", async () => {
    const client = makeClient();
    renderHook(() => useCompareData(265598, 320227571, "5m", "stockOnly"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(mockComputeIndicators).toHaveBeenCalledTimes(1));
    expect(mockComputeIndicators.mock.calls[0][0].conid).toBe(265598);
  });

  it("does not subscribe to the reference conid", async () => {
    const client = makeClient();
    renderHook(() => useCompareData(265598, 320227571, "5m", "stockOnly"), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(mockSubscribe).toHaveBeenCalledWith(265598));
    expect(mockSubscribe).not.toHaveBeenCalledWith(320227571);
  });
});

describe("useCompareData — refOnly layout", () => {
  it("does not fetch the stock candles", async () => {
    const client = makeClient();
    renderHook(() => useCompareData(265598, 320227571, "5m", "refOnly"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(mockComputeIndicators).toHaveBeenCalledTimes(1));
    expect(mockComputeIndicators.mock.calls[0][0].conid).toBe(320227571);
  });
});

describe("useCompareData — unmount", () => {
  it("unsubscribes from any active conids on unmount", async () => {
    const client = makeClient();
    const { unmount } = renderHook(
      () => useCompareData(265598, 320227571, "5m", "overlay"),
      { wrapper: wrapper(client) },
    );
    await waitFor(() => expect(mockSubscribe).toHaveBeenCalled());
    unmount();
    expect(mockUnsubscribe).toHaveBeenCalledWith(265598);
    expect(mockUnsubscribe).toHaveBeenCalledWith(320227571);
  });
});
```

- [ ] **Step 3.2: Run the test to verify it fails**

Run: `npx vitest run src/hooks/__tests__/useCompareData.test.ts`

Expected: FAIL with `Cannot find module '../useCompareData'`.

- [ ] **Step 3.3: Implement the hook**

Create `src/hooks/useCompareData.ts`:

```ts
/**
 * useCompareData — Per-pane data hook for Compare Mode.
 *
 * Fetches OHLCV candles for the primary stock and the shared reference
 * via the existing POST /indicators/compute endpoint (with an empty
 * indicator list — we only want candles). Subscribes to live ticks
 * via the existing WebSocket singleton. Both subscriptions are
 * ref-counted at the singleton level, so multiple panes that want the
 * same conid don't cause server-side fan-out.
 *
 * Query keys deliberately mirror useChartData's (["candles", conid,
 * timeframe, loadedPeriod]) so the TanStack Query cache is shared:
 * entering compare mode for AAPL hits a warm cache if the main chart
 * already loaded AAPL at the same timeframe.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";

import { api, type CandleData, type IndicatorComputeResponse } from "@/lib/api";
import { useIbkrReady } from "@/context/GatewayContext";
import { useWebSocket, type WsMessage } from "./useWebSocket";
import type { Timeframe } from "@/store/chart";
import type { Layout } from "@/store/compare";

export interface CompareLiveTick {
  last: number;
  volume: number;
  high: number;
  low: number;
}

interface UseCompareDataResult {
  stockCandles: CandleData[] | undefined;
  refCandles: CandleData[] | undefined;
  stockLiveTick: CompareLiveTick | null;
  refLiveTick: CompareLiveTick | null;
  isLoading: boolean;
  error: unknown;
}

const HISTORY_PERIOD = "3M";

export function useCompareData(
  stockConid: number | null,
  refConid: number | null,
  timeframe: Timeframe,
  layout: Layout,
): UseCompareDataResult {
  const ibkrReady = useIbkrReady();
  const { subscribe, unsubscribe, addHandler } = useWebSocket();

  const wantsStock = layout !== "refOnly";
  const wantsRef = layout !== "stockOnly";

  // ── Candle queries — shared keys with useChartData for cache reuse ──

  const stockQuery = useQuery<IndicatorComputeResponse>({
    queryKey: ["candles", stockConid, timeframe, HISTORY_PERIOD],
    queryFn: () =>
      api.computeIndicators({
        conid: stockConid!,
        timeframe,
        indicators: [],
        history_period: HISTORY_PERIOD,
      }),
    enabled: ibkrReady && wantsStock && stockConid != null,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });

  const refQuery = useQuery<IndicatorComputeResponse>({
    queryKey: ["candles", refConid, timeframe, HISTORY_PERIOD],
    queryFn: () =>
      api.computeIndicators({
        conid: refConid!,
        timeframe,
        indicators: [],
        history_period: HISTORY_PERIOD,
      }),
    enabled: ibkrReady && wantsRef && refConid != null,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });

  // ── WebSocket subscriptions ────────────────────────────────

  const prevStockConidRef = useRef<number | null>(null);
  const prevRefConidRef = useRef<number | null>(null);

  useEffect(() => {
    const prev = prevStockConidRef.current;
    if (wantsStock && stockConid != null) {
      if (prev !== stockConid) {
        if (prev != null) unsubscribe(prev);
        subscribe(stockConid);
        prevStockConidRef.current = stockConid;
      }
    } else if (prev != null) {
      unsubscribe(prev);
      prevStockConidRef.current = null;
    }
    return () => {
      const last = prevStockConidRef.current;
      if (last != null) {
        unsubscribe(last);
        prevStockConidRef.current = null;
      }
    };
  }, [wantsStock, stockConid, subscribe, unsubscribe]);

  useEffect(() => {
    const prev = prevRefConidRef.current;
    if (wantsRef && refConid != null) {
      if (prev !== refConid) {
        if (prev != null) unsubscribe(prev);
        subscribe(refConid);
        prevRefConidRef.current = refConid;
      }
    } else if (prev != null) {
      unsubscribe(prev);
      prevRefConidRef.current = null;
    }
    return () => {
      const last = prevRefConidRef.current;
      if (last != null) {
        unsubscribe(last);
        prevRefConidRef.current = null;
      }
    };
  }, [wantsRef, refConid, subscribe, unsubscribe]);

  // ── Live tick state ────────────────────────────────────────

  const [stockLiveTick, setStockLiveTick] = useState<CompareLiveTick | null>(null);
  const [refLiveTick, setRefLiveTick] = useState<CompareLiveTick | null>(null);

  // Reset live ticks when conid or timeframe changes
  useEffect(() => { setStockLiveTick(null); }, [stockConid, timeframe]);
  useEffect(() => { setRefLiveTick(null); }, [refConid, timeframe]);

  const handleMessage = useCallback(
    (msg: WsMessage) => {
      if (msg.type !== "market_data") return;
      const last = msg.last as number | undefined;
      if (last == null) return;
      const volume = msg.volume as number | undefined;
      const high = msg.high as number | undefined;
      const low = msg.low as number | undefined;
      if (msg.conid === stockConid) {
        setStockLiveTick((prev) => ({
          last,
          volume: volume ?? prev?.volume ?? 0,
          high: high ?? prev?.high ?? last,
          low: low ?? prev?.low ?? last,
        }));
      } else if (msg.conid === refConid) {
        setRefLiveTick((prev) => ({
          last,
          volume: volume ?? prev?.volume ?? 0,
          high: high ?? prev?.high ?? last,
          low: low ?? prev?.low ?? last,
        }));
      }
    },
    [stockConid, refConid],
  );

  useEffect(() => {
    const remove = addHandler(handleMessage);
    return remove;
  }, [addHandler, handleMessage]);

  return {
    stockCandles: stockQuery.data?.candles,
    refCandles: refQuery.data?.candles,
    stockLiveTick,
    refLiveTick,
    isLoading: stockQuery.isLoading || refQuery.isLoading,
    error: stockQuery.error ?? refQuery.error,
  };
}
```

- [ ] **Step 3.4: Run the test to verify it passes**

Run: `npx vitest run src/hooks/__tests__/useCompareData.test.ts`

Expected: PASS — all cases.

- [ ] **Step 3.5: Commit**

```bash
git add src/hooks/useCompareData.ts src/hooks/__tests__/useCompareData.test.ts
git commit -m "feat(compare): add useCompareData hook for per-pane data fetching

Fetches stock + reference candles via the existing
POST /indicators/compute endpoint with an empty indicator list.
Query keys mirror useChartData so the TanStack Query cache is
shared. Subscribes to live ticks via the existing WS singleton
(now ref-counted so multiple panes can share subscriptions)."
```

---

## Task 4: CompareChart component

**Files:**
- Create: `src/components/compare/CompareChart.tsx`
- Create: `src/components/compare/__tests__/CompareChart.test.tsx`

- [ ] **Step 4.1: Write the failing test**

Create `src/components/compare/__tests__/CompareChart.test.tsx`:

```tsx
/**
 * Tests for CompareChart — the dual-axis chart used inside Compare Mode panes.
 *
 * The Lightweight Charts library is heavy and DOM-dependent; we mock the
 * createChart factory + addSeries return values and assert on the calls
 * to verify configuration (number of series, scale modes, volume presence).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import CompareChart from "../CompareChart";

const mockApplyOptions = vi.fn();
const mockSetData = vi.fn();
const mockUpdate = vi.fn();
const mockRemove = vi.fn();
const mockAddSeries = vi.fn(() => ({
  setData: mockSetData,
  update: mockUpdate,
  applyOptions: vi.fn(),
}));
const mockPriceScale = vi.fn(() => ({ applyOptions: mockApplyOptions }));
const mockSubscribeCrosshairMove = vi.fn();
const mockUnsubscribeCrosshairMove = vi.fn();
const mockTimeScale = vi.fn(() => ({
  applyOptions: vi.fn(),
  fitContent: vi.fn(),
  getVisibleRange: () => null,
  setVisibleRange: vi.fn(),
}));
const mockChart = {
  addSeries: mockAddSeries,
  priceScale: mockPriceScale,
  applyOptions: vi.fn(),
  subscribeCrosshairMove: mockSubscribeCrosshairMove,
  unsubscribeCrosshairMove: mockUnsubscribeCrosshairMove,
  timeScale: mockTimeScale,
  remove: mockRemove,
  setCrosshairPosition: vi.fn(),
  clearCrosshairPosition: vi.fn(),
};

vi.mock("lightweight-charts", async () => {
  const actual = await vi.importActual<typeof import("lightweight-charts")>("lightweight-charts");
  return {
    ...actual,
    createChart: vi.fn(() => mockChart),
  };
});

vi.mock("@/components/charts/chartTheme", () => ({
  readChartTheme: () => ({
    bg: "#000",
    gridLines: "#222",
    text: "#fff",
    borderColor: "#444",
    upColor: "#0f0",
    downColor: "#f00",
  }),
}));

const CANDLES = [
  { time: 1700000000, open: 100, high: 102, low: 99, close: 101, volume: 1000 },
  { time: 1700000300, open: 101, high: 103, low: 100, close: 102, volume: 2000 },
];

const REF_CANDLES = [
  { time: 1700000000, open: 500, high: 502, low: 499, close: 501, volume: 0 },
  { time: 1700000300, open: 501, high: 503, low: 500, close: 502, volume: 0 },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CompareChart — overlay layout", () => {
  it("mounts two candle series and a volume histogram (for stock)", () => {
    render(
      <CompareChart
        layout="overlay"
        stockCandles={CANDLES}
        refCandles={REF_CANDLES}
        stockSymbol="AAPL"
        refSymbol="SPY"
        stockLiveTick={null}
        refLiveTick={null}
      />,
    );
    // 2 candles + 1 volume = 3 addSeries calls
    expect(mockAddSeries).toHaveBeenCalledTimes(3);
  });

  it("sets both price scales to Mode.Normal (Regular)", () => {
    render(
      <CompareChart
        layout="overlay"
        stockCandles={CANDLES}
        refCandles={REF_CANDLES}
        stockSymbol="AAPL"
        refSymbol="SPY"
        stockLiveTick={null}
        refLiveTick={null}
      />,
    );
    // priceScale('right') and priceScale('left') each get applyOptions with mode set.
    const calls = mockApplyOptions.mock.calls.map((c) => c[0]);
    const modes = calls.filter((c) => "mode" in c).map((c) => c.mode);
    // PriceScaleMode.Normal === 0
    expect(modes.every((m) => m === 0)).toBe(true);
    expect(modes.length).toBeGreaterThanOrEqual(2);
  });
});

describe("CompareChart — stockOnly layout", () => {
  it("mounts one candle series + volume", () => {
    render(
      <CompareChart
        layout="stockOnly"
        stockCandles={CANDLES}
        refCandles={REF_CANDLES}
        stockSymbol="AAPL"
        refSymbol="SPY"
        stockLiveTick={null}
        refLiveTick={null}
      />,
    );
    // 1 candle + 1 volume = 2 addSeries
    expect(mockAddSeries).toHaveBeenCalledTimes(2);
  });
});

describe("CompareChart — refOnly layout", () => {
  it("mounts one candle series, no volume", () => {
    render(
      <CompareChart
        layout="refOnly"
        stockCandles={CANDLES}
        refCandles={REF_CANDLES}
        stockSymbol="AAPL"
        refSymbol="SPY"
        stockLiveTick={null}
        refLiveTick={null}
      />,
    );
    // 1 candle, no volume
    expect(mockAddSeries).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 4.2: Run the test to verify it fails**

Run: `npx vitest run src/components/compare/__tests__/CompareChart.test.tsx`

Expected: FAIL with `Cannot find module '../CompareChart'`.

- [ ] **Step 4.3: Implement CompareChart**

Create `src/components/compare/CompareChart.tsx`:

```tsx
/**
 * CompareChart — Dual-axis chart for Compare Mode panes.
 *
 * Renders the primary stock and a shared reference symbol on the same
 * Lightweight Charts v5 instance, using two separate price scales (both
 * Mode.Normal — "Regular" in TradingView terms; not percent, not
 * indexed). Volume histogram is drawn only on the stock's scale; the
 * reference never has volume.
 *
 * The component is single-purpose: no indicator overlays, no
 * Fibonacci, no drawing layer, no watermark. Compare mode is clean
 * by design (per Indi's methodology — see the spec).
 *
 * Crosshair: participates in the existing crosshair-sync store so
 * hovering one pane highlights the same time on every other chart
 * on the page. The legend at top-left shows OHLC for both visible
 * symbols at the hovered index, falling back to the last candle
 * when no crosshair is active.
 */

import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type Time,
  type MouseEventParams,
} from "lightweight-charts";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { readChartTheme } from "@/components/charts/chartTheme";
import { useCrosshairStore } from "@/store";
import type { CandleData } from "@/lib/api";
import type { Layout } from "@/store/compare";
import type { CompareLiveTick } from "@/hooks/useCompareData";

const CROSSHAIR_COLOR = "rgba(0, 212, 255, 0.4)";
const CROSSHAIR_LABEL_BG = "#0f1724";
const STOCK_SERIES_COLOR_KEY = "stock";
const REF_SERIES_UP_COLOR = "rgba(110, 232, 132, 0.95)";
const REF_SERIES_DOWN_COLOR = "rgba(110, 232, 132, 0.55)";
const STOCK_PRICE_SCALE_ID = "right";
const REF_PRICE_SCALE_ID = "left";

export interface CompareChartProps {
  layout: Layout;
  stockCandles: CandleData[] | undefined;
  refCandles: CandleData[] | undefined;
  stockSymbol: string;
  refSymbol: string;
  stockLiveTick: CompareLiveTick | null;
  refLiveTick: CompareLiveTick | null;
}

function toCandlestickData(c: CandleData): CandlestickData<Time> {
  return {
    time: c.time as Time,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  };
}

function toHistogramData(c: CandleData, upColor: string, downColor: string): HistogramData<Time> {
  return {
    time: c.time as Time,
    value: c.volume,
    color: c.close >= c.open ? upColor : downColor,
  };
}

export default function CompareChart({
  layout,
  stockCandles,
  refCandles,
  stockSymbol,
  refSymbol,
  stockLiveTick,
  refLiveTick,
}: CompareChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const stockSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const refSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const chartId = useId();

  const showStock = layout !== "refOnly";
  const showRef = layout !== "stockOnly";

  const [hoveredTime, setHoveredTime] = useState<number | null>(null);
  const broadcastHovered = useCrosshairStore((s) => s.setHovered);
  const sharedTime = useCrosshairStore((s) => s.time);
  const sharedSource = useCrosshairStore((s) => s.source);

  // ── Create chart instance + series per layout ─────────────

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const theme = readChartTheme();
    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: theme.bg },
        textColor: theme.text,
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 10,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: theme.gridLines },
        horzLines: { color: theme.gridLines },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: CROSSHAIR_COLOR, width: 1, style: 2, labelBackgroundColor: CROSSHAIR_LABEL_BG },
        horzLine: { color: CROSSHAIR_COLOR, width: 1, style: 2, labelBackgroundColor: CROSSHAIR_LABEL_BG },
      },
      rightPriceScale: {
        borderColor: theme.borderColor,
        scaleMargins: { top: 0.05, bottom: 0.2 },
      },
      leftPriceScale: {
        visible: true,
        borderColor: theme.borderColor,
        scaleMargins: { top: 0.05, bottom: 0.2 },
      },
      timeScale: {
        borderColor: theme.borderColor,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
        barSpacing: 8,
      },
      handleScroll: { vertTouchDrag: false },
    });

    chartRef.current = chart;

    if (showStock) {
      const stockSeries = chart.addSeries(CandlestickSeries, {
        upColor: theme.upColor,
        downColor: theme.downColor,
        wickUpColor: theme.upColor,
        wickDownColor: theme.downColor,
        borderVisible: false,
        priceScaleId: STOCK_PRICE_SCALE_ID,
      });
      stockSeriesRef.current = stockSeries;

      const volumeSeries = chart.addSeries(HistogramSeries, {
        priceScaleId: "volume",
        priceFormat: { type: "volume" },
      });
      chart.priceScale("volume").applyOptions({
        scaleMargins: { top: 0.85, bottom: 0 },
        mode: 0,
      });
      volumeSeriesRef.current = volumeSeries;
    }

    if (showRef) {
      const refSeries = chart.addSeries(CandlestickSeries, {
        upColor: REF_SERIES_UP_COLOR,
        downColor: REF_SERIES_DOWN_COLOR,
        wickUpColor: REF_SERIES_UP_COLOR,
        wickDownColor: REF_SERIES_DOWN_COLOR,
        borderVisible: false,
        priceScaleId: REF_PRICE_SCALE_ID,
      });
      refSeriesRef.current = refSeries;
    }

    // Force both price scales to Mode.Normal (= 0 = "Regular").
    chart.priceScale(STOCK_PRICE_SCALE_ID).applyOptions({ mode: 0 });
    chart.priceScale(REF_PRICE_SCALE_ID).applyOptions({ mode: 0 });

    // Resize
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      chart.applyOptions({ width, height });
    });
    ro.observe(container);

    // Theme change observer
    const themeObs = new MutationObserver(() => {
      const t = readChartTheme();
      chart.applyOptions({
        layout: { background: { type: ColorType.Solid, color: t.bg }, textColor: t.text },
        grid: { vertLines: { color: t.gridLines }, horzLines: { color: t.gridLines } },
        rightPriceScale: { borderColor: t.borderColor },
        leftPriceScale: { borderColor: t.borderColor },
        timeScale: { borderColor: t.borderColor },
      });
      stockSeriesRef.current?.applyOptions({
        upColor: t.upColor,
        downColor: t.downColor,
        wickUpColor: t.upColor,
        wickDownColor: t.downColor,
      });
    });
    themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    // Crosshair broadcast
    const xhrHandler = (param: MouseEventParams) => {
      const t = (param.time as number | undefined) ?? null;
      setHoveredTime(t);
      if (!param.sourceEvent) return;
      broadcastHovered(t, chartId);
    };
    chart.subscribeCrosshairMove(xhrHandler);

    return () => {
      ro.disconnect();
      themeObs.disconnect();
      try { chart.unsubscribeCrosshairMove(xhrHandler); } catch { /* no-op */ }
      chart.remove();
      chartRef.current = null;
      stockSeriesRef.current = null;
      refSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, [layout, chartId, broadcastHovered, showStock, showRef]);

  // ── Update data ────────────────────────────────────────────

  useEffect(() => {
    const series = stockSeriesRef.current;
    if (!series || !stockCandles || stockCandles.length === 0) return;
    series.setData(stockCandles.map(toCandlestickData));
  }, [stockCandles]);

  useEffect(() => {
    const series = refSeriesRef.current;
    if (!series || !refCandles || refCandles.length === 0) return;
    series.setData(refCandles.map(toCandlestickData));
  }, [refCandles]);

  useEffect(() => {
    const series = volumeSeriesRef.current;
    if (!series || !stockCandles || stockCandles.length === 0) return;
    const theme = readChartTheme();
    series.setData(stockCandles.map((c) => toHistogramData(c, theme.upColor, theme.downColor)));
  }, [stockCandles]);

  // ── Live tick updates ──────────────────────────────────────

  useEffect(() => {
    const series = stockSeriesRef.current;
    if (!series || !stockCandles || stockCandles.length === 0 || !stockLiveTick) return;
    const last = stockCandles[stockCandles.length - 1];
    series.update({
      time: last.time as Time,
      open: last.open,
      high: Math.max(last.high, stockLiveTick.last),
      low: Math.min(last.low, stockLiveTick.last),
      close: stockLiveTick.last,
    });
  }, [stockLiveTick, stockCandles]);

  useEffect(() => {
    const series = refSeriesRef.current;
    if (!series || !refCandles || refCandles.length === 0 || !refLiveTick) return;
    const last = refCandles[refCandles.length - 1];
    series.update({
      time: last.time as Time,
      open: last.open,
      high: Math.max(last.high, refLiveTick.last),
      low: Math.min(last.low, refLiveTick.last),
      close: refLiveTick.last,
    });
  }, [refLiveTick, refCandles]);

  // ── Mirror shared crosshair time from other panes ─────────

  useEffect(() => {
    const chart = chartRef.current;
    const series = stockSeriesRef.current ?? refSeriesRef.current;
    if (!chart || !series) return;
    if (sharedSource === chartId) return;
    const candles = stockCandles ?? refCandles;
    if (!candles || candles.length === 0) return;

    if (sharedTime == null) {
      chart.clearCrosshairPosition();
      return;
    }
    let close: number | null = null;
    for (const c of candles) {
      if (c.time === sharedTime) { close = c.close; break; }
    }
    if (close == null) {
      chart.clearCrosshairPosition();
      return;
    }
    try {
      chart.setCrosshairPosition(close, sharedTime as Time, series);
    } catch { /* series removed mid-update */ }
  }, [sharedTime, sharedSource, chartId, stockCandles, refCandles]);

  // ── Legend (OHLC for both at the hovered time) ────────────

  const legend = useMemo(() => {
    const findAt = (candles: CandleData[] | undefined): CandleData | null => {
      if (!candles || candles.length === 0) return null;
      if (hoveredTime == null) return candles[candles.length - 1];
      for (const c of candles) if (c.time === hoveredTime) return c;
      return null;
    };
    return {
      stock: showStock ? findAt(stockCandles) : null,
      ref: showRef ? findAt(refCandles) : null,
    };
  }, [hoveredTime, stockCandles, refCandles, showStock, showRef]);

  const fmt = (n: number | undefined | null) =>
    n == null ? "—" : n.toFixed(2);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="absolute inset-0" />
      <div className="pointer-events-none absolute left-3 top-2 z-10 rounded border border-[var(--border)] bg-[var(--bg-1)]/85 px-2 py-1 font-mono text-[10px] text-[var(--text-2)]">
        {legend.stock && (
          <div>
            <span className="font-bold text-[var(--text-1)]">{stockSymbol}</span>{" "}
            O {fmt(legend.stock.open)}  H {fmt(legend.stock.high)}  L {fmt(legend.stock.low)}  C {fmt(legend.stock.close)}  V {legend.stock.volume?.toLocaleString() ?? "—"}
          </div>
        )}
        {legend.ref && (
          <div className="text-[#6ee884]">
            <span className="font-bold">{refSymbol}</span>{" "}
            O {fmt(legend.ref.open)}  H {fmt(legend.ref.high)}  L {fmt(legend.ref.low)}  C {fmt(legend.ref.close)}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4.4: Run the test to verify it passes**

Run: `npx vitest run src/components/compare/__tests__/CompareChart.test.tsx`

Expected: PASS — three describe blocks.

- [ ] **Step 4.5: Commit**

```bash
git add src/components/compare/CompareChart.tsx src/components/compare/__tests__/CompareChart.test.tsx
git commit -m "feat(compare): add CompareChart dual-axis component

Single-purpose dual-axis chart. Renders 1–2 candlestick series per
layout (overlay / stockOnly / refOnly) on two separate price scales,
both forced to Mode.Normal (\"Regular\"). Volume histogram only on the
stock. Custom legend at top-left shows OHLC for both visible
instruments at the hovered time. Participates in the existing
crosshair-sync store so hovering links every chart on the page."
```

---

## Task 5: PaneToolbar component

**Files:**
- Create: `src/components/compare/PaneToolbar.tsx`
- Create: `src/components/compare/__tests__/PaneToolbar.test.tsx`

- [ ] **Step 5.1: Write the failing test**

Create `src/components/compare/__tests__/PaneToolbar.test.tsx`:

```tsx
/**
 * Tests for PaneToolbar — per-pane controls (TF pills, layout dropdown, close).
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PaneToolbar from "../PaneToolbar";

const defaultProps = {
  paneId: "pane-1",
  timeframe: "5m" as const,
  layout: "overlay" as const,
  canRemove: true,
  onTimeframeChange: vi.fn(),
  onLayoutChange: vi.fn(),
  onRemove: vi.fn(),
};

describe("PaneToolbar", () => {
  it("highlights the active TF pill", () => {
    render(<PaneToolbar {...defaultProps} timeframe="1h" />);
    const pill = screen.getByRole("button", { name: "1h" });
    expect(pill.className).toMatch(/bg-\[var\(--bg-4\)\]/);
  });

  it("calls onTimeframeChange when a different pill is clicked", () => {
    const onTimeframeChange = vi.fn();
    render(<PaneToolbar {...defaultProps} onTimeframeChange={onTimeframeChange} />);
    fireEvent.click(screen.getByRole("button", { name: "1D" }));
    expect(onTimeframeChange).toHaveBeenCalledWith("1D");
  });

  it("calls onLayoutChange when the dropdown value changes", () => {
    const onLayoutChange = vi.fn();
    render(<PaneToolbar {...defaultProps} onLayoutChange={onLayoutChange} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "stockOnly" } });
    expect(onLayoutChange).toHaveBeenCalledWith("stockOnly");
  });

  it("disables the close button when canRemove is false", () => {
    render(<PaneToolbar {...defaultProps} canRemove={false} />);
    expect(screen.getByRole("button", { name: /remove pane/i })).toBeDisabled();
  });

  it("calls onRemove when the close button is clicked", () => {
    const onRemove = vi.fn();
    render(<PaneToolbar {...defaultProps} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole("button", { name: /remove pane/i }));
    expect(onRemove).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 5.2: Run the test to verify it fails**

Run: `npx vitest run src/components/compare/__tests__/PaneToolbar.test.tsx`

Expected: FAIL with `Cannot find module '../PaneToolbar'`.

- [ ] **Step 5.3: Implement PaneToolbar**

Create `src/components/compare/PaneToolbar.tsx`:

```tsx
/**
 * PaneToolbar — Per-pane controls inside a Compare Mode pane.
 *
 * TF pills (single-select, same set as the main chart), layout dropdown
 * (overlay / stock only / ref only), and a close ✕. The close is disabled
 * when only one pane remains (Compare Mode always has at least one).
 */

import { X } from "lucide-react";
import type { Timeframe } from "@/store/chart";
import type { Layout } from "@/store/compare";

const TIMEFRAMES: Timeframe[] = ["1m", "5m", "15m", "1h", "4h", "1D", "1W", "1M"];

const LAYOUT_LABELS: Record<Layout, string> = {
  overlay: "Overlay",
  stockOnly: "Stock only",
  refOnly: "Reference only",
};

export interface PaneToolbarProps {
  paneId: string;
  timeframe: Timeframe;
  layout: Layout;
  /** False when only one pane remains — disables the close ✕. */
  canRemove: boolean;
  onTimeframeChange: (tf: Timeframe) => void;
  onLayoutChange: (layout: Layout) => void;
  onRemove: () => void;
}

export default function PaneToolbar({
  paneId,
  timeframe,
  layout,
  canRemove,
  onTimeframeChange,
  onLayoutChange,
  onRemove,
}: PaneToolbarProps) {
  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-[var(--border)] bg-[var(--bg-1)] px-2 py-1">
      <div className="flex gap-px rounded-md border border-[var(--border)] bg-[var(--bg-0)] p-0.5">
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf}
            onClick={() => onTimeframeChange(tf)}
            className={`rounded px-2 py-0.5 font-data text-[10px] font-medium transition-all ${
              tf === timeframe
                ? "bg-[var(--bg-4)] text-foreground shadow-[inset_0_0_8px_var(--glow-cyan)]"
                : "text-[var(--text-3)] hover:text-[var(--text-2)]"
            }`}
          >
            {tf}
          </button>
        ))}
      </div>

      <select
        value={layout}
        onChange={(e) => onLayoutChange(e.target.value as Layout)}
        aria-label={`Layout for pane ${paneId}`}
        className="ml-auto rounded border border-[var(--border)] bg-[var(--bg-0)] px-2 py-0.5 font-data text-[10px] text-[var(--text-2)] focus:border-[var(--clr-cyan)] focus:outline-none"
      >
        {(Object.keys(LAYOUT_LABELS) as Layout[]).map((l) => (
          <option key={l} value={l}>
            {LAYOUT_LABELS[l]}
          </option>
        ))}
      </select>

      <button
        onClick={onRemove}
        disabled={!canRemove}
        title={canRemove ? "Remove pane" : "At least one pane required"}
        aria-label="Remove pane"
        className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-3)] transition-colors hover:text-[var(--clr-red)] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:text-[var(--text-3)]"
      >
        <X size={12} />
      </button>
    </div>
  );
}
```

- [ ] **Step 5.4: Run the test to verify it passes**

Run: `npx vitest run src/components/compare/__tests__/PaneToolbar.test.tsx`

Expected: PASS — five cases.

- [ ] **Step 5.5: Commit**

```bash
git add src/components/compare/PaneToolbar.tsx src/components/compare/__tests__/PaneToolbar.test.tsx
git commit -m "feat(compare): add PaneToolbar (TF pills + layout + close)"
```

---

## Task 6: ComparePane component

**Files:**
- Create: `src/components/compare/ComparePane.tsx`
- Create: `src/components/compare/__tests__/ComparePane.test.tsx`

- [ ] **Step 6.1: Write the failing test**

Create `src/components/compare/__tests__/ComparePane.test.tsx`:

```tsx
/**
 * Tests for ComparePane — wires the per-pane toolbar to the compare store
 * and renders a CompareChart with data from useCompareData.
 */

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
```

- [ ] **Step 6.2: Run the test to verify it fails**

Run: `npx vitest run src/components/compare/__tests__/ComparePane.test.tsx`

Expected: FAIL with `Cannot find module '../ComparePane'`.

- [ ] **Step 6.3: Implement ComparePane**

Create `src/components/compare/ComparePane.tsx`:

```tsx
/**
 * ComparePane — One configurable pane in Compare Mode.
 *
 * Composes PaneToolbar (controls) + CompareChart (the chart itself).
 * Reads the primary stock from the chart store and the reference from
 * the compare store. Data fetching is delegated to useCompareData.
 */

import PaneToolbar from "./PaneToolbar";
import CompareChart from "./CompareChart";
import { useChartStore } from "@/store/chart";
import { useCompareStore, type ComparePane as ComparePaneType } from "@/store/compare";
import { useCompareData } from "@/hooks/useCompareData";

export interface ComparePaneProps {
  pane: ComparePaneType;
}

const PANE_MIN_HEIGHT = 200;

export default function ComparePane({ pane }: ComparePaneProps) {
  const stockConid = useChartStore((s) => s.activeConid);
  const stockSymbol = useChartStore((s) => s.activeSymbol);
  const reference = useCompareStore((s) => s.reference);
  const panes = useCompareStore((s) => s.panes);
  const setPaneTimeframe = useCompareStore((s) => s.setPaneTimeframe);
  const setPaneLayout = useCompareStore((s) => s.setPaneLayout);
  const removePane = useCompareStore((s) => s.removePane);

  const data = useCompareData(
    stockConid,
    reference.conid,
    pane.timeframe,
    pane.layout,
  );

  const canRemove = panes.length > 1;

  return (
    <div
      className="flex min-h-0 flex-1 flex-col bg-[var(--bg-0)]"
      style={{ minHeight: PANE_MIN_HEIGHT }}
    >
      <PaneToolbar
        paneId={pane.id}
        timeframe={pane.timeframe}
        layout={pane.layout}
        canRemove={canRemove}
        onTimeframeChange={(tf) => setPaneTimeframe(pane.id, tf)}
        onLayoutChange={(layout) => setPaneLayout(pane.id, layout)}
        onRemove={() => removePane(pane.id)}
      />
      <div className="relative min-h-0 flex-1">
        {(() => {
          if (data.error) {
            return (
              <div className="flex h-full items-center justify-center text-xs text-[var(--clr-red)]">
                Failed to load data
              </div>
            );
          }
          // Per-pane empty state — spec §6: "Reference conid resolves but
          // computeIndicators 404s or returns empty — show 'No data for [SYMBOL]'".
          // Determine which symbol is at fault per layout.
          const wantsStock = pane.layout !== "refOnly";
          const wantsRef = pane.layout !== "stockOnly";
          const stockEmpty = wantsStock && data.stockCandles !== undefined && data.stockCandles.length === 0;
          const refEmpty = wantsRef && data.refCandles !== undefined && data.refCandles.length === 0;
          if (!data.isLoading && (stockEmpty || refEmpty)) {
            const missing = stockEmpty ? stockSymbol : reference.symbol;
            return (
              <div className="flex h-full items-center justify-center text-xs text-[var(--text-3)]">
                No data for {missing || "this symbol"}
              </div>
            );
          }
          return (
            <CompareChart
              layout={pane.layout}
              stockCandles={data.stockCandles}
              refCandles={data.refCandles}
              stockSymbol={stockSymbol || "—"}
              refSymbol={reference.symbol}
              stockLiveTick={data.stockLiveTick}
              refLiveTick={data.refLiveTick}
            />
          );
        })()}
      </div>
    </div>
  );
}
```

- [ ] **Step 6.4: Run the test to verify it passes**

Run: `npx vitest run src/components/compare/__tests__/ComparePane.test.tsx`

Expected: PASS.

- [ ] **Step 6.5: Commit**

```bash
git add src/components/compare/ComparePane.tsx src/components/compare/__tests__/ComparePane.test.tsx
git commit -m "feat(compare): add ComparePane wiring toolbar + chart + data hook"
```

---

## Task 7: CompareModeHeader component

**Files:**
- Create: `src/components/compare/CompareModeHeader.tsx`
- Create: `src/components/compare/__tests__/CompareModeHeader.test.tsx`

- [ ] **Step 7.1: Write the failing test**

Create `src/components/compare/__tests__/CompareModeHeader.test.tsx`:

```tsx
/**
 * Tests for CompareModeHeader — the bar above the pane stack.
 *
 * Primary stock label is read-only. Reference symbol is editable
 * (resolves via api.resolveConid). Add-pane disables at cap. Exit
 * sets compare.active=false.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CompareModeHeader from "../CompareModeHeader";
import { useCompareStore, MAX_PANES } from "@/store/compare";
import { useChartStore } from "@/store/chart";

const mockResolveConid = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    resolveConid: (...args: unknown[]) => mockResolveConid(...args),
  },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  useCompareStore.getState().__resetForTests();
  useCompareStore.getState().enter("5m");
  useChartStore.setState({ activeSymbol: "AAPL", activeConid: 265598 });
  mockResolveConid.mockResolvedValue({ symbol: "SPY", conid: 320227571 });
});

describe("CompareModeHeader", () => {
  it("renders the primary stock symbol as read-only text (not an input)", () => {
    render(<CompareModeHeader />);
    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("AAPL")).not.toBeInTheDocument();
  });

  it("auto-resolves the default reference (SPY) on mount", async () => {
    render(<CompareModeHeader />);
    await waitFor(() => expect(mockResolveConid).toHaveBeenCalledWith("SPY"));
    await waitFor(() => expect(useCompareStore.getState().reference.conid).toBe(320227571));
  });

  it("resolves a typed reference symbol on Enter", async () => {
    mockResolveConid.mockResolvedValueOnce({ symbol: "SPY", conid: 320227571 });
    mockResolveConid.mockResolvedValueOnce({ symbol: "QQQ", conid: 320227575 });

    render(<CompareModeHeader />);
    await waitFor(() => expect(useCompareStore.getState().reference.conid).toBe(320227571));

    const input = screen.getByLabelText(/reference symbol/i);
    fireEvent.change(input, { target: { value: "QQQ" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(mockResolveConid).toHaveBeenCalledWith("QQQ"));
    await waitFor(() => expect(useCompareStore.getState().reference.symbol).toBe("QQQ"));
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
});
```

- [ ] **Step 7.2: Run the test to verify it fails**

Run: `npx vitest run src/components/compare/__tests__/CompareModeHeader.test.tsx`

Expected: FAIL with `Cannot find module '../CompareModeHeader'`.

- [ ] **Step 7.3: Implement CompareModeHeader**

Create `src/components/compare/CompareModeHeader.tsx`:

```tsx
/**
 * CompareModeHeader — Bar at the top of Compare Mode.
 *
 *   Compare:  AAPL (read-only)  vs  [SPY ▾] (editable)        + Add pane    ✕ Exit
 *
 * The primary stock is read-only inside compare mode — to swap stocks
 * the user must exit (or click a watchlist row, which AnalysisPage
 * handles by force-exiting + switching).
 *
 * The reference input resolves via api.resolveConid on Enter or blur.
 * On mount, if the reference has no conid yet (first entry or post-
 * rehydrate), we kick off resolution immediately.
 */

import { useEffect, useState, type KeyboardEvent } from "react";
import { Plus, X } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { useChartStore } from "@/store/chart";
import { useCompareStore, MAX_PANES } from "@/store/compare";

export default function CompareModeHeader() {
  const activeSymbol = useChartStore((s) => s.activeSymbol);
  const reference = useCompareStore((s) => s.reference);
  const panes = useCompareStore((s) => s.panes);
  const setReference = useCompareStore((s) => s.setReference);
  const setReferenceSymbol = useCompareStore((s) => s.setReferenceSymbol);
  const addPane = useCompareStore((s) => s.addPane);
  const exit = useCompareStore((s) => s.exit);

  const [refInput, setRefInput] = useState(reference.symbol);
  const [inputFocused, setInputFocused] = useState(false);

  useEffect(() => {
    if (!inputFocused) setRefInput(reference.symbol);
  }, [reference.symbol, inputFocused]);

  const resolveMutation = useMutation({
    mutationFn: (sym: string) => api.resolveConid(sym),
    onSuccess: (result) => {
      setReference(result.symbol, result.conid);
    },
    onError: (_err, sym) => {
      // Spec §6: "If resolution fails, fall back to SPY" — but only on the
      // automatic mount-time resolve, identified by reference.conid being
      // null (= we are trying to resolve, not changing from a working state).
      // Manual user typos against an already-resolved reference should
      // revert the input and toast (no surprise SPY swap when they typo).
      const isPostRehydrateFallback = sym !== "SPY" && reference.conid == null;
      if (isPostRehydrateFallback) {
        toast.error(`Reference symbol unresolvable: ${sym} — falling back to SPY`);
        // setReferenceSymbol clears conid → the auto-resolve effect re-fires
        // for "SPY" → onSuccess populates the conid. Bounded recursion: at
        // most one re-attempt because the second attempt is for "SPY"
        // (universal default) and matches the early-return on sym === "SPY".
        setReferenceSymbol("SPY");
      } else {
        toast.error(`Reference symbol not found: ${sym}`);
        setRefInput(reference.symbol);
      }
    },
  });

  // Auto-resolve on mount whenever the reference is missing a conid.
  useEffect(() => {
    if (reference.conid == null && !resolveMutation.isPending) {
      resolveMutation.mutate(reference.symbol);
    }
    // intentionally only on mount + symbol change — mutation identity is stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reference.symbol]);

  const submit = () => {
    const sym = refInput.trim().toUpperCase();
    if (!sym || sym === reference.symbol) {
      setRefInput(reference.symbol);
      return;
    }
    resolveMutation.mutate(sym);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") submit();
    if (e.key === "Escape") setRefInput(reference.symbol);
  };

  const atPaneCap = panes.length >= MAX_PANES;

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--bg-1)] px-3 py-2 text-[12px]">
      <span className="text-[var(--text-3)]">Compare:</span>
      <span className="rounded bg-[var(--bg-3)] px-2 py-0.5 font-mono text-[11px] font-bold text-foreground">
        {activeSymbol || "—"}
      </span>
      <span className="text-[var(--text-3)]">vs</span>
      <input
        type="text"
        value={inputFocused ? refInput : reference.symbol}
        aria-label="Reference symbol"
        placeholder="SPY"
        onChange={(e) => setRefInput(e.target.value.toUpperCase())}
        onFocus={() => setInputFocused(true)}
        onBlur={() => { setInputFocused(false); submit(); }}
        onKeyDown={handleKeyDown}
        className={`w-[80px] rounded border border-[var(--border)] bg-[var(--bg-0)] px-2 py-0.5 text-center font-mono text-[11px] font-bold text-[#6ee884] outline-none transition-all focus:border-[var(--clr-cyan)] ${
          resolveMutation.isPending ? "animate-pulse" : ""
        }`}
      />

      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={addPane}
          disabled={atPaneCap}
          aria-label="Add pane"
          title={atPaneCap ? `Maximum ${MAX_PANES} panes` : "Add another pane"}
          className="flex items-center gap-1 rounded border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--text-2)] transition-all hover:border-[var(--clr-cyan)] hover:text-[var(--clr-cyan)] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-[var(--border)] disabled:hover:text-[var(--text-2)]"
        >
          <Plus size={12} /> Add pane
        </button>
        <button
          onClick={exit}
          aria-label="Exit compare mode"
          title="Exit Compare mode (C)"
          className="flex items-center gap-1 rounded border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--clr-red)] transition-all hover:border-[var(--clr-red)] hover:bg-[rgba(255,68,102,0.08)]"
        >
          <X size={12} /> Exit
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 7.4: Run the test to verify it passes**

Run: `npx vitest run src/components/compare/__tests__/CompareModeHeader.test.tsx`

Expected: PASS — five cases.

- [ ] **Step 7.5: Commit**

```bash
git add src/components/compare/CompareModeHeader.tsx src/components/compare/__tests__/CompareModeHeader.test.tsx
git commit -m "feat(compare): add CompareModeHeader with reference symbol resolver"
```

---

## Task 8: CompareView component + barrel

**Files:**
- Create: `src/components/compare/CompareView.tsx`
- Create: `src/components/compare/__tests__/CompareView.test.tsx`
- Create: `src/components/compare/index.ts`

- [ ] **Step 8.1: Write the failing test**

Create `src/components/compare/__tests__/CompareView.test.tsx`:

```tsx
/**
 * Tests for CompareView — the container that wires header + pane list.
 */

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
```

- [ ] **Step 8.2: Run the test to verify it fails**

Run: `npx vitest run src/components/compare/__tests__/CompareView.test.tsx`

Expected: FAIL with `Cannot find module '../CompareView'`.

- [ ] **Step 8.3: Implement CompareView**

Create `src/components/compare/CompareView.tsx`:

```tsx
/**
 * CompareView — The full Compare Mode UI rendered inside the Analysis page
 * when compare.active is true. Header bar above a vertical stack of panes.
 */

import CompareModeHeader from "./CompareModeHeader";
import ComparePane from "./ComparePane";
import { useCompareStore } from "@/store/compare";

export default function CompareView() {
  const panes = useCompareStore((s) => s.panes);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CompareModeHeader />
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto bg-[var(--bg-1)] p-1">
        {panes.map((pane) => (
          <ComparePane key={pane.id} pane={pane} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 8.4: Create the barrel**

Create `src/components/compare/index.ts`:

```ts
export { default as CompareView } from "./CompareView";
export { default as CompareModeHeader } from "./CompareModeHeader";
export { default as ComparePane } from "./ComparePane";
export { default as CompareChart } from "./CompareChart";
export { default as PaneToolbar } from "./PaneToolbar";
```

- [ ] **Step 8.5: Run the test to verify it passes**

Run: `npx vitest run src/components/compare/__tests__/CompareView.test.tsx`

Expected: PASS — three cases.

- [ ] **Step 8.6: Commit**

```bash
git add src/components/compare/CompareView.tsx src/components/compare/index.ts src/components/compare/__tests__/CompareView.test.tsx
git commit -m "feat(compare): add CompareView container + barrel exports"
```

---

## Task 9: AnalysisPage integration

This task wires the Compare button, `C` keyboard shortcut, conditional render, AI-panel auto-collapse, and watchlist-click force-exit handler. It's a single coherent change to one file.

**Files:**
- Modify: `src/pages/AnalysisPage.tsx`
- Modify: `src/pages/__tests__/AnalysisPage.test.tsx`

- [ ] **Step 9.1: Extend the existing AnalysisPage test with the new cases**

Open `src/pages/__tests__/AnalysisPage.test.tsx`. Locate the existing `vi.mock("@/components/charts", ...)` block. Below the existing mocks, add:

```tsx
vi.mock("@/components/compare", () => ({
  CompareView: () => <div data-testid="compare-view" />,
}));
```

Then at the bottom of the file, before the closing of any final `describe` or at module-end, append:

```tsx
import { useCompareStore } from "@/store/compare";

describe("AnalysisPage — Compare Mode integration", () => {
  beforeEach(() => {
    useCompareStore.getState().__resetForTests();
    useChartStore.setState({ activeConid: 265598, activeSymbol: "AAPL", timeframe: "5m" });
    resetChartDataMock();
  });

  it("renders a Compare toggle button in the toolbar", () => {
    renderPage();
    expect(screen.getByRole("button", { name: /compare/i })).toBeInTheDocument();
  });

  it("entering compare mode hides the indicator toolbar + sub-chart panels and shows CompareView", () => {
    chartDataMock.candles = [
      { time: 1700000000, open: 1, high: 2, low: 1, close: 2, volume: 100 },
    ];
    renderPage();
    expect(screen.queryByTestId("compare-view")).not.toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /compare/i }));
    });

    expect(screen.getByTestId("compare-view")).toBeInTheDocument();
    expect(screen.queryByTestId("indicator-toolbar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("chart-container")).not.toBeInTheDocument();
  });

  it("auto-collapses the right panel on compare entry", () => {
    renderPage();
    useChartStore.setState({ rightPanelCollapsed: false });

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /compare/i }));
    });
    expect(useChartStore.getState().rightPanelCollapsed).toBe(true);
  });

  it("pressing 'C' toggles compare mode", () => {
    renderPage();
    act(() => {
      fireEvent.keyDown(window, { key: "c" });
    });
    expect(useCompareStore.getState().active).toBe(true);

    act(() => {
      fireEvent.keyDown(window, { key: "c" });
    });
    expect(useCompareStore.getState().active).toBe(false);
  });

  it("changing the active conid while in compare mode force-exits", () => {
    renderPage();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /compare/i }));
    });
    expect(useCompareStore.getState().active).toBe(true);

    act(() => {
      useChartStore.setState({ activeConid: 999, activeSymbol: "MSFT" });
    });
    expect(useCompareStore.getState().active).toBe(false);
  });
});
```

You will also need this import near the top of the file if not present:

```tsx
import { fireEvent } from "@testing-library/react";
```

If `fireEvent` is already in the import line for `@testing-library/react`, leave it alone.

- [ ] **Step 9.2: Run the new tests to verify they fail**

Run: `npx vitest run src/pages/__tests__/AnalysisPage.test.tsx`

Expected: FAIL on the new cases — the Compare button doesn't exist yet, `compare-view` isn't rendered, etc.

- [ ] **Step 9.3: Add the Compare toggle button to the toolbar**

Open `src/pages/AnalysisPage.tsx`.

Near the top imports (alongside the other `lucide-react` imports), add `GitCompare`:

Find:
```tsx
import { RotateCcw, ChevronLeft } from "lucide-react";
```

Replace with:
```tsx
import { RotateCcw, ChevronLeft, GitCompare } from "lucide-react";
```

Below the existing `useChartStore` destructure, add:

Find:
```tsx
const {
  activeConid,
  activeSymbol,
  timeframe,
  activeIndicators,
  setActiveConid,
  setActiveSymbol,
  setTimeframe,
  fibDrawMode,
  enterFibDrawMode,
  exitFibDrawMode,
  toggleIndicator,
  requestResetZoom,
  rightPanelCollapsed,
  toggleRightPanel,
} = useChartStore();
```

After that block, add:

```tsx
// ── Compare Mode integration ──────────────────────────────
const compareActive = useCompareStore((s) => s.active);
const enterCompare = useCompareStore((s) => s.enter);
const exitCompare = useCompareStore((s) => s.exit);
```

And add the import at the top:

```tsx
import { useCompareStore } from "@/store/compare";
import { CompareView } from "@/components/compare";
```

- [ ] **Step 9.4: Auto-collapse the right panel on compare entry; force-exit on conid change**

Inside the component body, after the existing `useEffect` that pre-loads the AI model, add:

```tsx
// Compare entry: auto-collapse the AI panel rail (does NOT auto-re-expand on exit).
useEffect(() => {
  if (compareActive && !rightPanelCollapsed) {
    toggleRightPanel();
  }
  // intentionally only reacts to compareActive transitions
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [compareActive]);

// Force-exit compare mode when the primary stock changes.
// Watchlist clicks update activeConid via the chart store; this guarantees
// compare mode never carries over a stale primary symbol.
const prevCompareConidRef = useRef<number | null>(activeConid);
useEffect(() => {
  if (prevCompareConidRef.current !== null
      && prevCompareConidRef.current !== activeConid
      && compareActive) {
    exitCompare();
    toast.info(`Exited compare mode for ${activeSymbol || "new symbol"}`);
  }
  prevCompareConidRef.current = activeConid;
}, [activeConid, activeSymbol, compareActive, exitCompare]);
```

- [ ] **Step 9.5: Add the keyboard shortcut handler for `C`**

Inside `handleDrawingShortcut` (the existing keyboard handler used for H/T/R/S/V/X/Escape/\\), find the existing `if (e.key === "\\")` block. Above it (still inside the function body, after the existing input-element guard), add:

```tsx
if (e.key.toLowerCase() === "c") {
  if (useCompareStore.getState().active) {
    exitCompare();
  } else {
    enterCompare(useChartStore.getState().timeframe);
  }
  return;
}
```

- [ ] **Step 9.6: Add the toolbar button**

Find the existing reset-zoom button:

```tsx
{/* Reset zoom — re-fits the price axis and time scale to all loaded data */}
<button
  onClick={requestResetZoom}
  title="Reset zoom"
  className="flex items-center justify-center rounded border border-border p-1.5 text-[var(--text-3)] transition-all hover:border-[var(--clr-cyan)] hover:text-[var(--clr-cyan)]"
>
  <RotateCcw size={12} />
</button>
```

After it (still inside the same toolbar `<div>`), add:

```tsx
{/* Compare Mode toggle — distinct visual treatment (not an indicator) */}
<div className="mx-1 h-5 w-px bg-[var(--border)]" />
<button
  onClick={() =>
    compareActive
      ? exitCompare()
      : enterCompare(timeframe)
  }
  title={compareActive ? "Exit Compare mode (C)" : "Enter Compare mode (C)"}
  className={`flex items-center gap-1 rounded-full border px-2.5 py-1 font-data text-[10px] font-medium transition-all ${
    compareActive
      ? "border-[var(--clr-cyan)] bg-[rgba(0,212,255,0.1)] text-[var(--clr-cyan)]"
      : "border-[var(--border)] text-[var(--text-3)] hover:border-[var(--clr-cyan)] hover:text-[var(--clr-cyan)]"
  }`}
>
  <GitCompare size={12} /> Compare
</button>
```

- [ ] **Step 9.7: Conditionally render CompareView**

Find the JSX block that renders the main chart + sub-charts. It looks like:

```tsx
{/* Main chart — flex-[2] gives it twice the share of remaining space ... */}
<div className="relative flex-[2] min-h-[200px] bg-[var(--bg-0)]">
  ...
</div>

{/* Sub-chart panels — stacked vertically, one per active oscillator. */}
{activeSubCharts.length > 0 && (
  <div className="flex min-h-0 flex-1 flex-col overflow-y-auto border-t border-border">
    ...
  </div>
)}
```

Wrap both blocks (the main chart div AND the sub-chart conditional) inside a single ternary that swaps in CompareView when active. The simplest non-invasive shape:

Just before the `{/* Main chart — ... */}` comment, add:

```tsx
{compareActive ? (
  <CompareView />
) : (
  <>
```

And immediately AFTER the closing `)}` of the sub-chart panels block, add:

```tsx
  </>
)}
```

Also: the entire toolbar `<div>` (symbol input, timeframe pills, indicator toolbar, reset zoom, fib buttons) should ALSO be hidden in compare mode (the CompareView has its own header). Find the toolbar opening:

```tsx
{/* Toolbar — shrink-0 so it stays at its natural height when sub-panels
    are added below; otherwise flex squeezes it and only the bottom row
    of indicator/timeframe pills remains visible. */}
<div className="flex shrink-0 flex-wrap items-center gap-2.5 border-b border-border bg-[var(--bg-1)] px-3.5 py-2">
```

Wrap the entire toolbar div in `{!compareActive && (...)}`:

```tsx
{!compareActive && (
  <div className="flex shrink-0 flex-wrap items-center gap-2.5 border-b border-border bg-[var(--bg-1)] px-3.5 py-2">
    {/* ... all toolbar contents unchanged ... */}
  </div>
)}
```

Note: the Compare button itself lives INSIDE this toolbar div. That's intentional — when compare mode is active the toolbar disappears and the CompareModeHeader takes its place. The Exit button on the CompareModeHeader is the only way to exit besides the `C` shortcut, which is fine.

- [ ] **Step 9.8: Run the test to verify it passes**

Run: `npx vitest run src/pages/__tests__/AnalysisPage.test.tsx`

Expected: PASS — all existing cases AND the 5 new Compare Mode cases.

- [ ] **Step 9.9: Type-check the whole frontend**

Run: `npx tsc --noEmit`

Expected: zero errors.

- [ ] **Step 9.10: Commit**

```bash
git add src/pages/AnalysisPage.tsx src/pages/__tests__/AnalysisPage.test.tsx
git commit -m "feat(compare): wire Compare Mode into AnalysisPage

- Adds a distinct Compare toggle button at the right end of the
  top toolbar (after Reset Zoom).
- 'C' keyboard shortcut toggles the mode.
- When active, the standard toolbar / main chart / sub-charts are
  hidden and CompareView renders in their place.
- AI panel auto-collapses on entry (does not auto-re-expand on exit).
- Force-exits compare mode when the primary conid changes (e.g.
  watchlist click)."
```

---

## Task 10: End-to-end manual verification

This is the smoke test before merging. No new code — just exercise the feature in a running app and confirm the spec is honored.

- [ ] **Step 10.1: Start the backend sidecar**

Run in a separate terminal:
```bash
cd backend
uv run uvicorn main:app --reload --port 8000
```

Expected: server listens on 8000. The IBKR gateway must already be running on localhost:5000 and authenticated.

- [ ] **Step 10.2: Start the frontend in dev mode**

Run in a separate terminal:
```bash
npm run tauri dev
```

Expected: Tauri window opens with the app. Navigate to the Analysis page and load a stock (e.g. AAPL).

- [ ] **Step 10.3: Verify chart is live before entering compare mode**

Watch the chart for ~30 seconds during market hours. The last candle should update with WS ticks. Confirm before proceeding.

- [ ] **Step 10.4: Enter Compare mode via the toolbar button**

Click the **Compare** button at the right end of the toolbar. Verify:

- [ ] Indicator toolbar disappears
- [ ] Sub-chart panels (if any were on) disappear
- [ ] Drawing toolbar (left rail) stays visible
- [ ] AI panel auto-collapses to its 32 px rail
- [ ] A new header appears: `Compare:  AAPL  vs  [SPY]   + Add pane   ✕ Exit`
- [ ] A single pane appears with AAPL (white candles) and SPY (green candles) overlaid
- [ ] Both Y-axes show raw price values (not percent, not indexed)
- [ ] Volume histogram appears at the bottom (AAPL only)
- [ ] Top-left legend shows OHLC for both AAPL and SPY at the last candle

- [ ] **Step 10.5: Reference symbol swap**

Type `QQQ` into the reference input and press Enter. Verify:

- [ ] Resolution succeeds (no error toast)
- [ ] Pane re-renders with QQQ in green
- [ ] Legend updates to show QQQ values
- [ ] Live ticks for QQQ visible in the last candle

- [ ] **Step 10.6: Add a second pane at a different timeframe**

Click **+ Add pane**. Verify:

- [ ] Second pane appears below the first, same overlay
- [ ] Both panes have their own per-pane toolbars (TF pills, layout dropdown, ✕)

Change the second pane's TF to `1h` by clicking its `1h` pill. Verify:

- [ ] Only the second pane reloads
- [ ] The first pane keeps its previous timeframe

- [ ] **Step 10.7: Layout switching**

In the second pane, change the layout dropdown to **Stock only**. Verify:

- [ ] Reference series (QQQ) disappears
- [ ] AAPL alone fills the pane

Change back to **Overlay**, then try **Reference only**. Verify each works.

- [ ] **Step 10.8: Pane removal + cap behavior**

Add a third pane (now at 3 — the cap). Verify:

- [ ] **+ Add pane** button is disabled with tooltip
- [ ] Click ✕ on the middle pane → it disappears
- [ ] **+ Add pane** re-enables

With only one pane left, verify:

- [ ] ✕ on the remaining pane is disabled with tooltip "At least one pane required"

- [ ] **Step 10.9: Exit and re-enter**

Click **✕ Exit**. Verify:

- [ ] CompareView disappears, standard chart returns with previous indicators
- [ ] AI panel does NOT auto-re-expand (still on the 32 px rail)
- [ ] Manually expand AI panel via the chevron — works as before

Press `C`. Verify:

- [ ] Compare mode re-enters
- [ ] The previous pane configuration is restored (sticky)

Reload the app. Verify:

- [ ] Compare mode does NOT auto-resume (active=false on rehydrate)
- [ ] Press `C` again — panes are still restored from last session

- [ ] **Step 10.10: Watchlist click force-exit**

While in compare mode, click a different symbol in the watchlist. Verify:

- [ ] Compare mode exits
- [ ] Analysis page switches to the new symbol with the standard chart
- [ ] No stale "AAPL vs SPY" state lingers

- [ ] **Step 10.11: Reference resolution failure**

Enter compare mode. Type `BOGUSTICKER` and press Enter. Verify:

- [ ] An error toast appears
- [ ] Input reverts to the previous valid reference (SPY/QQQ)
- [ ] Panes keep showing the previous reference's data

- [ ] **Step 10.12: Run all tests one final time**

Run: `npx vitest run`

Expected: all tests pass. No flakes.

- [ ] **Step 10.13: Lint**

Run: `npx eslint . --max-warnings 0`

Expected: zero warnings, zero errors. Fix any lint warnings before merging.

- [ ] **Step 10.14: Final commit and push**

If anything was tweaked during smoke testing, commit those fixes. Then push:

```bash
git push -u origin feature/compare-mode
```

Open a PR from `feature/compare-mode` → `dev` titled "feat(compare): Compare Mode — dual-axis stock vs reference overlay" with the spec linked in the body.

---

## Notes for the implementer

- **Pane min-height** is set to 200 px in `ComparePane.tsx`. With the cap at 3 panes plus the header (~32 px), the compare view fits comfortably in ~700 px of vertical space. If you find this too tight on smaller windows, lift it inside `ComparePane.tsx` only — don't add a new global setting.
- **The reference symbol input** uses the existing `api.resolveConid` endpoint, so symbol resolution behavior (case-insensitive, etc.) matches the main symbol input. No new backend work.
- **The Lightweight Charts left price scale** is hidden by default; the chart options block in `CompareChart.tsx` explicitly sets `leftPriceScale.visible: true`. Don't remove this — without it the reference series renders to a hidden axis.
- **The `C` shortcut** uses `e.key.toLowerCase() === "c"` to match both `C` and `c`. Other drawing-tool shortcuts in the codebase use `toUpperCase()` against a `SHORTCUT_MAP`; we don't need to add Compare to that map because the handler short-circuits before reaching the map lookup.
- **If the spec changes** (e.g. you decide to allow per-pane reference), the per-pane reference field already has a natural home: extend `ComparePane` with its own `reference?: CompareReference` override and resolve a local conid in `useCompareData`. The store's shared reference becomes the default. But that's out of scope for this plan.
