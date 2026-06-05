# MoonMarket Options/ATM Review Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the correctness, trading-risk, and stale-data defects found in the `feature/moonmarket-options-atm-chain` review, with regression tests for every change.

**Architecture:** Four severity lanes (Critical, Hard/High, Medium, Low) executed as two parallel phases. Phase 1 = {Critical ∥ Hard}; Phase 2 = {Medium ∥ Low}, started only after Phase 1 is merged and green. Each lane runs in its own git worktree to allow true parallelism; the orchestrator integrates lanes sequentially in the order given below and resolves the known shared-file overlaps.

**Tech Stack:** React 19 + TypeScript + @tanstack/react-query + vitest (frontend); Python 3.12 + FastAPI + Pydantic v2 + pytest (backend). Run frontend tests with `npm test -- <files>`, typecheck with `npm run typecheck`, backend tests with `cd backend && uv run python -m pytest <files> -q` (note: bare `uv run pytest` fails to spawn in this venv — always use `python -m pytest`).

---

## Decisions locked (from review Q&A)

1. **Fill detection:** Live-order authoritative. The `order_id`-correlated live order is the source of truth; `filled` only when its status is `Filled` or `remaining_quantity == 0`. Show partial fills with remaining qty. Trades feed is used only to enrich average price, filtered to executions at/after submit time. The loose conid+side+5min match is removed as a fill trigger.
2. **Options no-spot UX:** Block + prompt. On quote failure / no spot, auto-load nothing and show "Couldn't determine spot price — pick a strike to load" with a retry.
3. **Options fan-out:** Bundled backend endpoint. New endpoint loads the whole auto-load strike window in one request with server-side pacing; frontend fires one request for the window instead of 6.
4. **Ticket cancel:** Add a Cancel control to the order ticket for any non-terminal tracked order.

---

## Parallel execution & conflict management

**Phase 1 (parallel):** Lane CRITICAL ∥ Lane HARD. **Phase 2 (parallel, after Phase 1 merged + green):** Lane MEDIUM ∥ Lane LOW.

**Shared files that WILL need conflict resolution at integration** (orchestrator merges the first lane, then rebases/replays the second and resolves):

| File | Lanes that touch it | Integration order |
|------|--------------------|-------------------|
| `src/orbit/OrderTicket/OrderForm.tsx` | CRITICAL (C1,C2), HARD (H3,H4), MEDIUM (M5,M6,L?) | Merge CRITICAL first, then HARD |
| `src/orbit/OrderTicket/OrderResult.tsx` | CRITICAL (C1), MEDIUM (M1) | CRITICAL is Phase 1; M1 is Phase 2 → no clash |
| `src/orbit/OrderTicket/__tests__/OrderTicket.test.tsx` | CRITICAL (C1,C2,C3), HARD (H2,H3,H4), MEDIUM (M5), LOW (L3) | append-only test blocks; resolve by keeping both |
| `src/modules/moonmarket/options/OptionsChainTable.tsx` | HARD (H1), MEDIUM (M3), LOW (L2) | HARD Phase 1; M3/L2 Phase 2 → no clash |
| `src/lib/api.ts` | MEDIUM (M3) only | no clash |

**Rule for agents:** make append-only additions to test files (new `it(...)` / `def test_...` blocks) rather than rewriting existing tests, so integration conflicts stay trivial. Do NOT reformat untouched code.

**Worktree setup (orchestrator):** create one worktree per lane off the current `feature/moonmarket-options-atm-chain` HEAD, e.g. `git worktree add ../orbit-crit -b fix/crit-fills` and `git worktree add ../orbit-hard -b fix/hard`. After Phase 1 lanes finish, merge `fix/crit-fills` then `fix/hard` into the feature branch, run the full suite, then start Phase 2 lanes off the merged HEAD.

---

## File Structure

**Backend**
- `backend/models/__init__.py` — add stop-order validation to `MoonMarketOrderDraft` (CRITICAL); add `MoonMarketOptionWindowResponse` model (MEDIUM).
- `backend/services/orders.py` — no logic change; covered by model validator (CRITICAL).
- `backend/services/options.py` — add `contract_window(...)` with server-side pacing (MEDIUM).
- `backend/routers/options.py` — add `GET /moonmarket/options/window/{conid}` endpoint (MEDIUM).
- `backend/services/moonmarket.py` — soften `order_rules` account-scope docstring/response note (MEDIUM).
- `backend/tests/test_orders_router.py` — stop-order validation tests (CRITICAL).
- `backend/tests/test_moonmarket_router.py` — 404 tests for revalidate + order-rules (HARD).
- `backend/tests/test_options_router.py` — window endpoint tests (MEDIUM).

**Frontend**
- `src/orbit/OrderTicket/OrderForm.tsx` — fill-detection rewrite + post-fill refresh (CRITICAL C1), frontend stop validation (CRITICAL C2), side-flip guard (HARD H3), place-shape disambiguation (HARD H4), Cancel control (MEDIUM M5), `handleConfirm` liveBlocked guard (MEDIUM M6), zero/neg price feedback (LOW L1).
- `src/orbit/OrderTicket/OrderResult.tsx` — partial-fill tracker display (CRITICAL C1), Submitted-card status gate (MEDIUM M1).
- `src/orbit/OrderTicket/useOrderMutations.ts` — cancel/modify invalidate funds+portfolio (MEDIUM M2).
- `src/modules/moonmarket/options/OptionsChainTable.tsx` — block+prompt on no-spot (HARD H1), consume window query (MEDIUM M3), memoize window (LOW L2).
- `src/modules/moonmarket/options/OptionsChainPage.tsx` — pass quote error/no-spot state down (HARD H1).
- `src/modules/moonmarket/options/useOptionsChain.ts` — `useOptionWindow` hook (MEDIUM M3).
- `src/modules/moonmarket/options/StrikeRow.tsx` — accept preloaded window data (MEDIUM M3).
- `src/lib/api.ts` — `moonmarketOptionWindow` + `MoonMarketOptionWindowResponse` type (MEDIUM M3).
- Test files as listed above.

---

# LANE CRITICAL (Phase 1A) — branch `fix/crit-fills`

Covers review findings #1, #2 (false/partial filled), #3 (stop-order validation), #4 (rejection-path test).

### Task C1: Live-order-authoritative fill detection + partial fills + post-fill refresh

**Files:**
- Modify: `src/orbit/OrderTicket/OrderForm.tsx` (`matchingFill` ~135-155; `orderTracker` ~386-413; filled effect ~415-419; `refreshAccountAfterSubmitted` ~426-437)
- Modify: `src/orbit/OrderTicket/OrderResult.tsx` (`OrderTrackerCard` ~207-233; `OrderTrackerState` type ~11-23)
- Test: `src/orbit/OrderTicket/__tests__/OrderTicket.test.tsx`

- [ ] **Step 1: Write failing tests** (append to the test file)

```tsx
it("does not mark filled from a same-conid/same-side trade that predates submission", async () => {
  // live order present, status Submitted, remaining == quantity; a stale trade exists in window
  const { placeOrder } = renderTicket({
    liveOrders: [{ order_id: "o1", conid: 111, side: "BUY", quantity: 5, remaining_quantity: 5, status: "Submitted", order_type: "LMT", limit_price: 10 }],
    trades: [{ execution_id: "old", conid: 111, side: "BUY", quantity: 3, price: 9.9, trade_time_ms: Date.now() - 60_000 }],
  });
  await placeOrder({ orderId: "o1" });
  expect(await screen.findByText("Order Tracker")).toBeInTheDocument();
  expect(screen.queryByText("Order Filled")).not.toBeInTheDocument();
  expect(screen.getByText(/Remaining/)).toBeInTheDocument();
});

it("shows partial fill state when remaining_quantity is between 0 and quantity", async () => {
  const { placeOrder } = renderTicket({
    liveOrders: [{ order_id: "o1", conid: 111, side: "BUY", quantity: 5, remaining_quantity: 2, status: "Submitted", order_type: "LMT", limit_price: 10 }],
  });
  await placeOrder({ orderId: "o1" });
  expect(await screen.findByText(/Partially Filled|Order Tracker/)).toBeInTheDocument();
  expect(screen.queryByText("Order Filled")).not.toBeInTheDocument();
  expect(screen.getByText("3")).toBeInTheDocument(); // filled = 5 - 2
});

it("marks filled only when live order status is Filled (remaining 0)", async () => {
  const { placeOrder } = renderTicket({
    liveOrders: [{ order_id: "o1", conid: 111, side: "BUY", quantity: 5, remaining_quantity: 0, status: "Filled", order_type: "LMT", limit_price: 10 }],
    trades: [{ execution_id: "e1", conid: 111, side: "BUY", quantity: 5, price: 10.1, trade_time_ms: Date.now() }],
  });
  await placeOrder({ orderId: "o1" });
  expect(await screen.findByText("Order Filled")).toBeInTheDocument();
});
```

(If `renderTicket` does not yet accept `liveOrders`/`trades` overrides, extend the existing harness in this file to seed those query mocks. Match the existing mocking style already used for place/live-orders in the file.)

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- src/orbit/OrderTicket/__tests__/OrderTicket.test.tsx`
Expected: FAIL (current code marks filled from the stale trade / partial).

- [ ] **Step 3: Make the live order authoritative**

In `OrderForm.tsx`, replace `matchingFill` so it only enriches average price from executions at/after submit time (never a fill *trigger*), and reduce its window to `>= submittedAt`:

```tsx
function fillEnrichment(trades: MoonMarketTrade[], trackedOrder: TrackedOrder | null): {
  quantity: number;
  averagePrice: number | null;
} | null {
  if (!trackedOrder) return null;
  const matches = trades.filter((trade) => (
    trade.conid === trackedOrder.order.conid
    && trade.side === trackedOrder.order.side
    && trade.trade_time_ms != null
    && trade.trade_time_ms >= trackedOrder.submittedAt
  ));
  const quantity = matches.reduce((sum, t) => sum + Math.abs(t.quantity), 0);
  if (quantity <= 0) return null;
  const basis = matches.reduce((sum, t) => (t.price == null ? sum : sum + Math.abs(t.quantity) * t.price), 0);
  return { quantity, averagePrice: basis > 0 ? basis / quantity : null };
}
```

Rewrite `orderTracker` (lines ~386-413) so fill state derives from the live order's `status` + `remaining_quantity`, not from trades:

```tsx
const enrichment = fillEnrichment(tradesQuery.data?.trades ?? [], trackedOrder);
const orderTracker = useMemo<OrderTrackerState | null>(() => {
  if (!trackedOrder) return null;
  const orderedQty = trackedOrder.order.quantity;
  const liveStatus = liveOrder?.status ?? null;
  const remaining = liveOrder?.remaining_quantity ?? null;
  const liveFilled = liveOrder?.quantity != null && remaining != null
    ? Math.max(0, liveOrder.quantity - remaining)
    : null;
  const isFilled = orderIsFilled(liveStatus) || (remaining != null && remaining <= 0 && liveOrder != null);
  if (isFilled) {
    return {
      orderId: trackedOrder.orderId,
      orderType: trackedOrder.order.orderType,
      status: "filled",
      quantity: orderedQty,
      filledQuantity: liveFilled ?? enrichment?.quantity ?? orderedQty,
      averagePrice: enrichment?.averagePrice ?? null,
    };
  }
  const partialFilled = liveFilled != null && liveFilled > 0;
  return {
    orderId: trackedOrder.orderId,
    orderType: trackedOrder.order.orderType,
    status: partialFilled ? "partial" : (liveOrder ? "pending" : "submitted"),
    liveStatus: liveStatus ?? "Pending",
    quantity: orderedQty,
    filledQuantity: liveFilled ?? 0,
    currentPrice,
    limitPrice: trackedLimitPrice,
    distancePercent,
    remainingQuantity: remaining ?? orderedQty,
  };
}, [currentPrice, distancePercent, enrichment, liveOrder, trackedLimitPrice, trackedOrder]);
```

Add `"partial"` to the `OrderTrackerState["status"]` union in `OrderResult.tsx` (line 14).

- [ ] **Step 4: Re-run live-orders polling on terminal correctly** — confirm `liveOrdersQuery.refetchInterval` (line 262-265) still stops on terminal status; no change needed, but verify `orderIsTerminal` includes `"filled"`. It does (line 159).

- [ ] **Step 5: Re-invalidate global data when the order reaches filled** (review #6)

Replace the filled toast effect (lines ~415-419) so that on transition to `filled` it BOTH toasts AND re-runs the account refresh:

```tsx
useEffect(() => {
  if (!orderTracker || orderTracker.status !== "filled" || filledToastRef.current === orderTracker.orderId) return;
  filledToastRef.current = orderTracker.orderId;
  toast.success(`Order filled: ${orderTracker.filledQuantity ?? 0} shares at $${orderTracker.averagePrice?.toFixed(2) ?? "--"}`);
  if (selectedAccountId) {
    void queryClient.invalidateQueries({ queryKey: ["moonmarket", "portfolio", selectedAccountId] });
    void queryClient.invalidateQueries({ queryKey: ["moonmarket", "funds", selectedAccountId] });
    void queryClient.invalidateQueries({ queryKey: ["moonmarket", "live-orders", selectedAccountId] });
    void queryClient.invalidateQueries({ queryKey: ["moonmarket", "trades", selectedAccountId] });
  }
}, [orderTracker, queryClient, selectedAccountId]);
```

- [ ] **Step 6: Render partial state in `OrderTrackerCard`** (`OrderResult.tsx` ~207-233)

```tsx
function OrderTrackerCard({ tracker }: { tracker: OrderTrackerState }) {
  const filled = tracker.status === "filled";
  const partial = tracker.status === "partial";
  const heading = filled ? "Order Filled" : partial ? "Partially Filled" : "Order Tracker";
  // ... reuse existing class logic; for `partial` use the cyan (non-green) styling
  // In the non-filled branch add a "Filled" fact showing tracker.filledQuantity when partial:
  // {partial ? <Fact label="Filled" value={`${formatQuantity(tracker.filledQuantity)} shares`} tone="cyan" /> : null}
}
```

- [ ] **Step 7: Run tests to verify pass**

Run: `npm test -- src/orbit/OrderTicket/__tests__/OrderTicket.test.tsx`
Expected: PASS (all existing + new).

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add src/orbit/OrderTicket/OrderForm.tsx src/orbit/OrderTicket/OrderResult.tsx src/orbit/OrderTicket/__tests__/OrderTicket.test.tsx
git commit -m "fix: derive order fill state from live order, not loose trade match"
```

### Task C2: Stop-order price validation (backend + frontend)

**Files:**
- Modify: `backend/models/__init__.py` (`_validate_trailing` → extend, ~369-380)
- Modify: `src/orbit/OrderTicket/OrderForm.tsx` (`handlePlace` validation block ~491-504)
- Test: `backend/tests/test_orders_router.py`, `src/orbit/OrderTicket/__tests__/OrderTicket.test.tsx`

- [ ] **Step 1: Write failing backend tests**

```python
def test_place_rejects_stop_order_without_stop_price():
    resp = _client(fake).post("/moonmarket/orders", json={
        "account_id": "DU12345",
        "orders": [{"conid": 1, "side": "BUY", "quantity": 1, "orderType": "STP", "tif": "DAY"}],
    })
    assert resp.status_code == 422

def test_place_rejects_stop_limit_missing_a_leg():
    # missing auxPrice (stop)
    resp = _client(fake).post("/moonmarket/orders", json={
        "account_id": "DU12345",
        "orders": [{"conid": 1, "side": "BUY", "quantity": 1, "orderType": "STP_LIMIT", "tif": "DAY", "price": 10}],
    })
    assert resp.status_code == 422
```

- [ ] **Step 2: Run, verify fail**

Run: `cd backend && uv run python -m pytest tests/test_orders_router.py -q`
Expected: FAIL (currently 200/accepted).

- [ ] **Step 3: Extend the model validator** (`models/__init__.py` after the trailing block, before `return self`)

```python
        if self.order_type == "STP" and self.aux_price is None and self.price is None:
            raise ValueError("STP orders require a stop price (auxPrice)")
        if self.order_type == "STP_LIMIT":
            if self.price is None:
                raise ValueError("STP_LIMIT orders require a limit price")
            if self.aux_price is None:
                raise ValueError("STP_LIMIT orders require a stop price (auxPrice)")
```

- [ ] **Step 4: Run backend tests, verify pass**

Run: `cd backend && uv run python -m pytest tests/test_orders_router.py tests/test_moonmarket_router.py -q`
Expected: PASS.

- [ ] **Step 5: Frontend guard + failing test**

Add to `handlePlace` (after the TRAILLMT check, ~504):

```tsx
if (orderType === "STP" && !numberOrUndefined(auxPrice)) {
  toast.error("Stop price is required.");
  return;
}
if (orderType === "STP_LIMIT" && (!numberOrUndefined(price) || !numberOrUndefined(auxPrice))) {
  toast.error("Stop-limit orders require both a stop price and a limit price.");
  return;
}
```

Add a vitest case asserting placing a STP order with empty stop price shows the toast and does NOT call `moonmarketPlaceOrders`.

- [ ] **Step 6: Run + typecheck + commit**

```bash
cd backend && uv run python -m pytest tests/test_orders_router.py -q
cd .. && npm test -- src/orbit/OrderTicket/__tests__/OrderTicket.test.tsx && npm run typecheck
git add backend/models/__init__.py backend/tests/test_orders_router.py src/orbit/OrderTicket/OrderForm.tsx src/orbit/OrderTicket/__tests__/OrderTicket.test.tsx
git commit -m "fix: validate stop and stop-limit orders have required prices"
```

### Task C3: Order-rejection / error-result regression test (review #4)

**Files:**
- Test: `src/orbit/OrderTicket/__tests__/OrderTicket.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
it("renders the error card and no success state when IBKR returns a rejection row", async () => {
  const { placeOrder } = renderTicket({
    placeResult: { result: [{ error: "10/Order rejected: insufficient margin" }] },
  });
  await placeOrder();
  expect(await screen.findByText(/Order rejected: insufficient margin/)).toBeInTheDocument();
  expect(screen.queryByText("Order Submitted")).not.toBeInTheDocument();
  expect(screen.queryByText("Order Tracker")).not.toBeInTheDocument();
  expect(screen.queryByText("Order Filled")).not.toBeInTheDocument();
  expect(screen.queryByText("Close")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run**

Run: `npm test -- src/orbit/OrderTicket/__tests__/OrderTicket.test.tsx`
Expected: PASS if `ErrorCard`/`SubmittedCard` already behave correctly; if it FAILS (e.g. SubmittedCard shows because the rejection row carried no `order_id` but some other id), capture the exact failure — coordinate with MEDIUM M1 (Submitted-card status gate). The test is the deliverable for this lane regardless.

- [ ] **Step 3: Commit**

```bash
git add src/orbit/OrderTicket/__tests__/OrderTicket.test.tsx
git commit -m "test: cover order rejection result path in ticket"
```

---

# LANE HARD (Phase 1B) — branch `fix/hard`

Covers #5 (no-spot strikes), #7 (side auto-flip race), #8 (place-result shape), #9 (404 endpoints untested), #10 (strike-window unit tests). Post-fill refresh (#6) is implemented inside CRITICAL C1; the partial-fill display test (#10) is in C1. This lane's remaining #10 work is the pure-function strike-window unit tests.

### Task H1: Block + prompt on missing spot (review #5)

**Files:**
- Modify: `src/modules/moonmarket/options/OptionsChainPage.tsx` (~67-71)
- Modify: `src/modules/moonmarket/options/OptionsChainTable.tsx` (auto-load logic ~57-59; render branch)
- Test: `src/modules/moonmarket/options/__tests__/OptionsChainPage.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
it("does not auto-load strikes and shows a prompt when the underlying quote fails", async () => {
  server.use(/* make api.quote(conid) reject */);
  renderOptionsPage({ conid: 265598, symbol: "AAPL" });
  expect(await screen.findByText(/Couldn't determine spot price/i)).toBeInTheDocument();
  // No strike row auto-rendered with contract data:
  expect(screen.queryByTestId(/option-strike-/)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test -- src/modules/moonmarket/options/__tests__/OptionsChainPage.test.tsx`
Expected: FAIL (currently loads first 6 strikes).

- [ ] **Step 3: Thread quote error/no-spot into the table**

In `OptionsChainPage.tsx`, pass new props:

```tsx
underlyingPriceError={quoteQuery.isError || (!quoteQuery.isLoading && underlyingPrice == null)}
```

In `OptionsChainTable.tsx`, accept `underlyingPriceError: boolean`. When true, auto-load nothing and render a prompt instead of strike rows:

```tsx
const autoLoadStrikes = underlyingPriceLoading || underlyingPriceError
  ? new Set<number>()
  : selectStrikesAroundPrice(allStrikes, underlyingPrice, AUTO_LOAD_STRIKE_COUNT);
// ...in the body, before the allStrikes.length branch:
{underlyingPriceError ? (
  <div className="p-4 text-[12px] text-[var(--clr-orange)]">
    Couldn't determine spot price — pick a strike to load, or
    <button type="button" onClick={onRetryQuote} className="ml-1 underline">retry</button>.
  </div>
) : /* existing error/loading/strikes branches */}
```

Add an `onRetryQuote: () => void` prop wired from the page to `quoteQuery.refetch`.

- [ ] **Step 4: Run, verify pass; typecheck**

Run: `npm test -- src/modules/moonmarket/options/__tests__/OptionsChainPage.test.tsx && npm run typecheck`
Expected: PASS / clean.

- [ ] **Step 5: Commit**

```bash
git add src/modules/moonmarket/options/OptionsChainPage.tsx src/modules/moonmarket/options/OptionsChainTable.tsx src/modules/moonmarket/options/__tests__/OptionsChainPage.test.tsx
git commit -m "fix: block options auto-load and prompt when spot price is unavailable"
```

### Task H2: Strike-window pure-function unit tests (review #10)

**Files:**
- Refactor: export `selectStrikesAroundPrice` from `OptionsChainTable.tsx` (or move to a sibling `strikeWindow.ts`).
- Test: new `src/modules/moonmarket/options/__tests__/strikeWindow.test.ts`

- [ ] **Step 1: Export the function** — add `export` to `selectStrikesAroundPrice`.

- [ ] **Step 2: Write tests**

```ts
import { describe, it, expect } from "vitest";
import { selectStrikesAroundPrice } from "../OptionsChainTable";

const S = [175, 180, 185, 190, 195, 200, 205];
it("centers on spot in the middle", () => {
  expect([...selectStrikesAroundPrice(S, 192, 6)]).toEqual([180, 185, 190, 195, 200, 205]);
});
it("clamps when spot is above all strikes", () => {
  expect([...selectStrikesAroundPrice(S, 9999, 6)]).toEqual([180, 185, 190, 195, 200, 205]);
});
it("clamps when spot is below all strikes", () => {
  expect([...selectStrikesAroundPrice(S, 1, 6)]).toEqual([175, 180, 185, 190, 195, 200]);
});
it("tie-breaks to the upper strike when equidistant", () => {
  expect([...selectStrikesAroundPrice([10, 20], 15, 1)]).toEqual([20]);
});
it("returns first N when price is null (caller must gate this)", () => {
  expect([...selectStrikesAroundPrice(S, null, 3)]).toEqual([175, 180, 185]);
});
it("handles count > strikes length", () => {
  expect([...selectStrikesAroundPrice([1, 2], 1, 6)]).toEqual([1, 2]);
});
```

- [ ] **Step 3: Run, verify pass; commit**

```bash
npm test -- src/modules/moonmarket/options/__tests__/strikeWindow.test.ts
git add src/modules/moonmarket/options/OptionsChainTable.tsx src/modules/moonmarket/options/__tests__/strikeWindow.test.ts
git commit -m "test: unit-cover strike window selection edge cases"
```

### Task H3: Side auto-flip race guard (review #7)

**Files:**
- Modify: `src/orbit/OrderTicket/OrderForm.tsx` (side-default effect ~294-302; add an interaction flag)
- Test: `src/orbit/OrderTicket/__tests__/OrderTicket.test.tsx`

- [ ] **Step 1: Write failing test** — render ticket with no `target.side`, a held position, but simulate the user editing quantity *before* portfolio data resolves; assert side stays BUY (not auto-flipped) once the user has interacted.

- [ ] **Step 2: Apply the default only before first interaction.** Reuse the existing `sideTouched` flag and also set it on the first edit of any order field, OR apply the held-position default synchronously when the position data is already present at mount. Minimal approach: gate the effect additionally on a `hasInteracted` ref that flips on the first `onChange` of quantity/price/size inputs:

```tsx
useEffect(() => {
  if (target.side || sideTouched || hasInteractedRef.current || assetClass !== "STK") return;
  const held = portfolioQuery.data?.positions.find((p) => p.conid === target.conid && p.quantity !== 0);
  if (held) setSide("SELL");
}, [assetClass, portfolioQuery.data?.positions, sideTouched, target.conid, target.side]);
```

Set `hasInteractedRef.current = true` in the quantity/cash/bp/price input `onChange` handlers.

- [ ] **Step 3: Run, verify pass; typecheck; commit**

```bash
npm test -- src/orbit/OrderTicket/__tests__/OrderTicket.test.tsx && npm run typecheck
git add src/orbit/OrderTicket/OrderForm.tsx src/orbit/OrderTicket/__tests__/OrderTicket.test.tsx
git commit -m "fix: don't auto-flip order side after user starts editing the ticket"
```

> **Integration note:** this edits `OrderForm.tsx` (also edited by CRITICAL C1/C2). Orchestrator merges CRITICAL first; the side-effect block here is distinct from C1's tracker logic, so conflicts are localized.

### Task H4: Place-result shape disambiguation (review #8)

**Files:**
- Modify: `src/orbit/OrderTicket/OrderForm.tsx` (`placeMutation` onSuccess ~529-536; helpers `firstReplyId`/`firstOrderId` ~44-58)
- Test: `src/orbit/OrderTicket/__tests__/OrderTicket.test.tsx`

- [ ] **Step 1: Write failing tests** — (a) a confirmation-only response `{result:[{id:"reply-1", message:"..."}]}` sets a replyId and does NOT start a tracker; (b) a final response `{result:[{order_id:"o1"}]}` starts a tracker and shows no confirmation card; (c) a numeric-id confirmation `{result:[{id:123}]}` is still treated as a confirmation (currently `firstReplyId` only matches string `id` → would be missed).

- [ ] **Step 2: Branch on response type.** In `placeMutation.onSuccess`, prefer the order id; only treat as a confirmation when there is an `id`/`message` row and no `order_id`:

```tsx
onSuccess: (result) => {
  setActionResult(result);
  const orderId = firstOrderId(result);
  if (orderId) {
    setReplyId(null);
    setTrackedOrder({ orderId, order: orders[0], submittedAt: Date.now() });
  } else {
    setReplyId(firstReplyId(result));
  }
  refreshAccountAfterSubmitted(result);
},
```

Broaden `firstReplyId` to accept a numeric `id` (coerce via `String`), mirroring `firstOrderId`.

- [ ] **Step 3: Run, verify pass; typecheck; commit**

```bash
npm test -- src/orbit/OrderTicket/__tests__/OrderTicket.test.tsx && npm run typecheck
git add src/orbit/OrderTicket/OrderForm.tsx src/orbit/OrderTicket/__tests__/OrderTicket.test.tsx
git commit -m "fix: disambiguate IBKR confirmation vs final order place responses"
```

### Task H5: 404 tests for new MoonMarket endpoints (review #9)

**Files:**
- Test: `backend/tests/test_moonmarket_router.py`

- [ ] **Step 1: Write tests**

```python
def test_revalidate_positions_unknown_account_returns_404():
    resp = _client(fake).post("/moonmarket/accounts/NOPE/positions/revalidate")
    assert resp.status_code == 404
    assert resp.json()["detail"]["error"] == "moonmarket_account_not_found"

def test_order_rules_unknown_account_returns_404():
    resp = _client(fake).get("/moonmarket/accounts/NOPE/contracts/1/order-rules?side=BUY")
    assert resp.status_code == 404
    assert resp.json()["detail"]["error"] == "moonmarket_account_not_found"
```

(Ensure the fake IBKR's account list does not include `NOPE`. Reuse the existing fixture pattern in the file.)

- [ ] **Step 2: Run, verify pass; commit**

```bash
cd backend && uv run python -m pytest tests/test_moonmarket_router.py -q
git add backend/tests/test_moonmarket_router.py
git commit -m "test: cover 404 account guard on revalidate and order-rules endpoints"
```

---

# LANE MEDIUM (Phase 2A) — branch `fix/medium` (off merged Phase-1 HEAD)

Covers M1 (Submitted-card status gate), M2 (cancel/modify invalidate funds+portfolio), M3 (bundled options window endpoint), M5 (ticket Cancel control), M6 (`handleConfirm` liveBlocked guard), and the order_rules docstring softening.

### Task M1: Gate the Submitted card on order status

**Files:**
- Modify: `src/orbit/OrderTicket/OrderResult.tsx` (`SubmittedCard` ~182-192, `firstOrderId`/row parsing)
- Test: `src/orbit/OrderTicket/__tests__/OrderTicket.test.tsx`

- [ ] **Step 1: Failing test** — a place result `{result:[{order_id:"o1", order_status:"Inactive"}]}` should NOT render the green "Order Submitted" success card (render neutral/error instead).
- [ ] **Step 2:** In `SubmittedCard`, read `order_status`/`status` from the row; if it is `Rejected`/`Inactive`/`Cancelled`, render the neutral IBKR-response/error styling instead of the green success card.
- [ ] **Step 3:** Run `npm test -- src/orbit/OrderTicket/__tests__/OrderTicket.test.tsx && npm run typecheck`; commit `fix: only show submitted success card for accepted orders`.

### Task M2: Cancel/modify invalidate funds + portfolio

**Files:**
- Modify: `src/orbit/OrderTicket/useOrderMutations.ts` (`useCancelOrder` ~35-44, `useModifyOrder` ~46-55)
- Test: `src/modules/moonmarket/__tests__/MoonMarketModule.test.tsx` (or a focused test on the hook)

- [ ] **Step 1: Failing test** — cancelling from the Live Orders table invalidates `["moonmarket","funds",accountId]` and `["moonmarket","portfolio",accountId]`.
- [ ] **Step 2:** Add those two `invalidateQueries` calls to `useCancelOrder.onSuccess`; add `funds` to `useModifyOrder.onSuccess`.
- [ ] **Step 3:** Run tests + typecheck; commit `fix: refresh funds and portfolio after cancel/modify`.

### Task M3: Bundled options window endpoint (review #6 fan-out)

**Files:**
- Modify: `backend/services/options.py` — add `contract_window`.
- Modify: `backend/routers/options.py` — add `GET /window/{underlying_conid}`.
- Modify: `backend/models/__init__.py` — add `MoonMarketOptionWindowResponse`.
- Modify: `src/lib/api.ts` — add `moonmarketOptionWindow` + response type.
- Modify: `src/modules/moonmarket/options/useOptionsChain.ts` — add `useOptionWindow`.
- Modify: `src/modules/moonmarket/options/OptionsChainTable.tsx` — fire one window query, pass preloaded data to `StrikeRow`.
- Modify: `src/modules/moonmarket/options/StrikeRow.tsx` — accept optional `preloaded` contract pair; skip its own query when provided.
- Test: `backend/tests/test_options_router.py`, `src/modules/moonmarket/options/__tests__/OptionsChainPage.test.tsx`.

- [ ] **Step 1: Backend model**

```python
class MoonMarketOptionWindowResponse(BaseModel):
    """Batch of call/put contract pairs for a strike window, loaded in one request."""
    underlying_conid: int
    expiration: str
    strikes: dict[str, dict[str, MoonMarketOptionContract]]  # key = strike formatted "%.2f"
```

- [ ] **Step 2: Backend service** — add to `OptionService`:

```python
async def contract_window(
    self, underlying_conid: int, expiration: str, strikes: list[float]
) -> dict[str, dict[str, MoonMarketOptionContract]]:
    result: dict[str, dict[str, MoonMarketOptionContract]] = {}
    for strike in strikes:  # sequential = server-side pacing; one IBKR burst per strike, not all at once
        pair = await self.contract_pair(underlying_conid, expiration, strike)
        if pair:
            result[f"{strike:.2f}"] = pair
    return result
```

- [ ] **Step 3: Backend route** (`routers/options.py`)

```python
@router.get("/window/{underlying_conid}", response_model=MoonMarketOptionWindowResponse)
async def option_window(
    underlying_conid: int,
    expiration: str = Query(..., min_length=1),
    strikes: list[float] = Query(..., min_length=1, max_length=12),
    ibkr: IBKRService = Depends(require_ibkr_auth),
) -> MoonMarketOptionWindowResponse:
    data = await _service(ibkr).contract_window(underlying_conid, expiration, strikes)
    return MoonMarketOptionWindowResponse(
        underlying_conid=underlying_conid, expiration=expiration, strikes=data,
    )
```

- [ ] **Step 4: Backend test** (`tests/test_options_router.py`) — assert `GET /moonmarket/options/window/265598?expiration=JUN24&strikes=180&strikes=185` returns both strikes' pairs, and assert the fake IBKR received the expected number of snapshot calls (pacing path exercised).

- [ ] **Step 5: Frontend api + hook + wiring** — add `moonmarketOptionWindow(conid, expiration, strikes[])` to `api.ts`; add `useOptionWindow(conid, expiration, strikes[])` to `useOptionsChain.ts` (enabled when `strikes.length`); in `OptionsChainTable.tsx` compute the auto-load window (after H1's no-spot gate) and call `useOptionWindow` once; pass each strike's preloaded pair into `StrikeRow` via a new `preloaded?` prop. `StrikeRow` renders preloaded data immediately and only runs its own `useOptionStrike` query for manual (non-window) loads.

- [ ] **Step 6: Frontend test** — `OptionsChainPage.test.tsx`: assert that on load the page issues ONE window request (not 6 per-strike contract requests) and renders the auto-loaded strikes.

- [ ] **Step 7:** Run backend + frontend tests + typecheck; commit `feat: load option auto-window in one paced backend request`.

> **Integration note:** M3 builds on H1's no-spot gate (window must not fire when spot is unknown). Phase 2 starts off merged Phase-1 HEAD, so H1 is present.

### Task M5: Add Cancel control to the order ticket

**Files:**
- Modify: `src/orbit/OrderTicket/OrderForm.tsx` (footer ~763-776; add a cancel handler using `useCancelOrder`)
- Test: `src/orbit/OrderTicket/__tests__/OrderTicket.test.tsx`

- [ ] **Step 1: Failing test** — with a non-terminal tracked order, a "Cancel Order" button is visible, is disabled on a live (non-paper) account, and on click calls `moonmarketCancelOrder` with the tracked order id and clears the tracker.
- [ ] **Step 2:** Add a Cancel button shown when `trackedOrder?.orderId` exists and `orderTracker?.status !== "filled"`; wire `useCancelOrder`, guard on `!selectedAccountId || liveBlocked`, on success toast + `setTrackedOrder(null)` + the same account refresh as C1.
- [ ] **Step 3:** Run tests + typecheck; commit `feat: add cancel control to the order ticket`.

### Task M6: `handleConfirm` liveBlocked guard

**Files:**
- Modify: `src/orbit/OrderTicket/OrderForm.tsx` (`handleConfirm` ~543-564)
- Test: `src/orbit/OrderTicket/__tests__/OrderTicket.test.tsx`

- [ ] **Step 1: Failing test** — `handleConfirm(true)` on a live (non-paper) account does not call `moonmarketReplyOrder`.
- [ ] **Step 2:** Add `if (liveBlocked) return;` at the top of `handleConfirm`.
- [ ] **Step 3:** Run tests + typecheck; commit `fix: block order confirmation on live accounts in handler`.

### Task M7: Soften order_rules account-scope wording

**Files:**
- Modify: `backend/services/moonmarket.py` (`order_rules` docstring ~227-251) and/or `MoonMarketOrderRulesResponse` docstring in `models/__init__.py`.

- [ ] **Step 1:** Change the docstring to state the account id is the requesting context echoed back, NOT a server-side filter (IBKR `/iserver/contract/rules` has no account param). No behavior change, no new test required; run existing `tests/test_moonmarket_router.py` to confirm green. Commit `docs: clarify order_rules account is request context, not a server-side filter`.

---

# LANE LOW (Phase 2B) — branch `fix/low` (off merged Phase-1 HEAD)

Covers L1 (zero/negative price feedback), L2 (memoize strike window), L3 (numeric order_id / lowercase tif tests), L4 (small-positions rail threshold/sort test).

### Task L1: Surface zero/negative price input

**Files:** Modify `src/orbit/OrderTicket/OrderForm.tsx` (price/stop inputs); Test `OrderTicket.test.tsx`.

- [ ] Add inline validation messaging when a required price field parses to `<= 0` (today `numberOrUndefined` silently drops it). Failing test: entering `0` as a limit price for a LMT order shows a message and blocks place. Implement a small inline error under the field. Run + typecheck + commit `fix: surface invalid zero/negative price input in ticket`.

### Task L2: Memoize the auto-load strike window

**Files:** Modify `src/modules/moonmarket/options/OptionsChainTable.tsx` (~57-59).

- [ ] Wrap `autoLoadStrikes` in `useMemo` keyed on `[allStrikes, underlyingPrice, underlyingPriceLoading, underlyingPriceError]`. No behavior change; add a comment why. Run options tests + typecheck + commit `perf: memoize option auto-load window`.

> **Integration note:** L2 and HARD H1 / MEDIUM M3 all edit `OptionsChainTable.tsx`. L2 is Phase 2 off merged HEAD (H1 present); if M3 lands first, rebase L2 onto it. Keep L2 a pure `useMemo` wrap to minimize conflict.

### Task L3: Numeric order_id + lowercase tif tests

**Files:** Test `src/orbit/OrderTicket/__tests__/OrderTicket.test.tsx`; Test `src/modules/moonmarket/__tests__/MoonMarketModule.test.tsx`.

- [ ] Add a test: place result with numeric `{order_id: 123456}` starts a tracker showing `123456`. Add a test: a live order with `tif: "gtc"` hydrates the modify draft TIF select to `GTC` (exercises `normalizeTif` lowercase branch). Run + commit `test: cover numeric order id and lowercase tif normalization`.

### Task L4: Small-positions rail threshold/sort test

**Files:** Test `src/modules/moonmarket/__tests__/MoonMarketModule.test.tsx`.

- [ ] Add a test seeding positions at exactly `0.5%` and `1.2%` (asserted absent from the rail), a `value <= 0` position (absent), cash (absent even when sub-threshold), and two sub-0.5% positions asserted in ascending percent order. Run + commit `test: cover small-positions rail threshold, cash exclusion, and sort`.

---

## Final integration & verification (orchestrator, after all lanes)

- [ ] Merge order: `fix/crit-fills` → `fix/hard` → run full suite → `fix/medium` → `fix/low`.
- [ ] Resolve the known shared-file conflicts in `OrderForm.tsx` / `OrderResult.tsx` / `OrderTicket.test.tsx` (keep all new test blocks; keep CRITICAL's tracker logic as the base, layer HARD/MEDIUM handlers on top).
- [ ] Run the full review command set:

```bash
npm test -- src/modules/moonmarket/__tests__/MoonMarketModule.test.tsx \
  src/modules/moonmarket/__tests__/TransactionsPage.test.tsx \
  src/orbit/OrderTicket/__tests__/OrderTicket.test.tsx \
  src/modules/moonmarket/options/__tests__/OptionsChainPage.test.tsx \
  src/modules/moonmarket/options/__tests__/strikeWindow.test.ts \
  src/lib/api.moonmarket.test.ts
npm run typecheck
cd backend && uv run python -m pytest tests/test_db_migrations.py tests/test_moonmarket_router.py \
  tests/test_orders_router.py tests/test_options_router.py -q
```

Expected: all green, typecheck clean.

---

## Self-review checklist (run before dispatch)

- **Spec coverage:** #1,#2 → C1; #3 → C2; #4 → C3; #5 → H1; #6 → C1(step5); #7 → H3; #8 → H4; #9 → H5; #10 → C1(partial test)+H2; M1 → M1; cancel-invalidation → M2; fan-out → M3; cancel-in-ticket → M5; confirm-guard → M6; order_rules wording → M7; lows → L1-L4. All mapped.
- **Type consistency:** `OrderTrackerState.status` union extended to include `"partial"` (C1) and consumed in `OrderResult.tsx` (C1 step 6). `MoonMarketOptionWindowResponse` defined in models (M3 step1) before use in router/api.
- **Open IBKR assumption to verify during C1:** that a filled order remains in `/iserver/account/orders` with status `Filled` (so `liveOrder` is non-null at fill). If IBKR drops filled orders from that feed, the enrichment-from-trades path (filtered to `>= submittedAt`) becomes the fallback fill signal — C1 already keeps that path, but confirm against a real paper fill.
