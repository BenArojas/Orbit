# Inflect — Trading Journal Design Spec

> Status: DRAFT — design agreed with Ofek 2026-06-01. Pending plan approval.
> Module: Inflect (Orbit's third module, built after Parallax + MoonMarket).
> Scope: v1 = P&L calendar + trade list/detail + notes/tags journaling.

---

## 1. What Inflect is

Inflect is Orbit's **trading journal**. It answers "how am I actually trading?"
by turning raw IBKR executions into round-trip trades, attributing realized P&L
to calendar days, and letting Ofek annotate each trade with notes, a setup, and
tags.

The reference visual (Ofek's mock) is a **Tradezella-style monthly calendar**:

- Monthly grid, one cell per day, colored green/red by net realized P&L.
- Each day cell shows `$` P&L and a small dot/indicator if trades closed.
- Right rail: per-week rollups (Week 1…6, sum + number of trading days).
- Header: month nav, "This month", and **Monthly stats** (`$214K` total,
  `7 days` traded).

v1 also adds a **trade list** (every round-trip, newest first) and a
**per-trade detail** view (constituent fills, entry/exit, R-multiple, hold
time, plus the notes/tags editor).

## 2. Locked decisions (agreed 2026-06-01)

| # | Decision | Choice | Rationale |
|---|---|---|---|
| D1 | Trade matching | **FIFO**, pluggable | Per-trade granularity + parity with IBKR's own realized-P&L math. Pluggable so avg-cost can be added in v2. |
| D2 | P&L definition | Realized, **net of commissions**, attributed to the round-trip's **close date** | Matches how a daily-P&L calendar reads. Open positions don't appear until closed. |
| D3 | Account scope | **Single account** (reuse MoonMarket's account store) | Multi-account stays v2 per roadmap. |
| D4 | History sync | **Background poll (60s, market-hours-gated) + on-open pull**, both upsert into `fills` | IBKR `/iserver/account/trades` only returns the last 7 days; local `fills` table is the durable projection. |
| D5 | Sync cadence | 60s background floor; respects the **1 req / 5 sec** pacing cap on `/iserver/account/trades` | Cap is enforced by the existing token-bucket limiter; 60s sits far under it. Trade history only changes on a fill, so faster polling is pointless. |
| D10 | Sync window | **Extended hours** (pre- + post-market), not RTH-only | Ofek trades extended hours; gate must cover them. See §12. |
| D11 | Day-bucket timezone | **US/Eastern** (exchange time) | Calendar days align to the trading session, not local wall-clock. |
| D6 | Journaling depth | **Notes + tags** (freeform tags **and** a fixed setup/strategy dropdown) | Ofek wants both a structured setup label and ad-hoc tags. Screenshots/ratings deferred to v2. |
| D7 | Shorts | Supported (sell-to-open → buy-to-close) | FIFO lot queue is sign-aware. |
| D8 | Options | Single-leg P&L included via existing `sec_type`/`conid`; **multi-leg grouping deferred** | Mirrors MoonMarket Plan #6's single-leg-first posture. |
| D9 | Module placement | `/inflect/*` route group; launcher tile flips from "Soon" to enabled | Already stubbed in `OrbitLauncher.tsx`. |

## 3. The 7-day constraint and the durable projection

IBKR's Client Portal `/iserver/account/trades` returns **at most 7 days** of
executions (`bounded_days = max(1, min(days, 7))` in `services/moonmarket.py`).
A journal needs complete history, so the `fills` SQLite table is the source of
truth for Inflect — it is an idempotent, `execution_id`-keyed local projection
that already exists and is already populated by MoonMarket's trades endpoint.

**Risk:** if the app is closed for more than 7 days, executions that aged out of
IBKR's window before the next sync are lost permanently. v1 mitigations:

- Background poll keeps the window fresh whenever the app is open.
- On-open pull guarantees a sync the moment Inflect is viewed.

**Out of scope for v1 (noted for v2):** IBKR Flex Query / CSV import to backfill
gaps and pre-Orbit history. Called out so we don't design the schema in a way
that blocks it — the trade-matcher reads from `fills`, so any future importer
just needs to upsert into `fills` with the same shape.

## 4. Data model

### 4.1 Reused (no change)

- **`fills`** — `execution_id` PK, `account_id`, `conid`, `symbol`, `side`,
  `quantity`, `price`, `net_amount`, `commission`, `sec_type`, `trade_time`,
  `trade_time_ms`, `raw_json`. This is the matcher's only input.
- **`instruments`** — conid → symbol/name/type metadata for display.

### 4.2 New: `journal_entries`

Stores Ofek's annotations. Keyed by a **stable round-trip trade id** so an entry
survives re-derivation of trades from fills.

```
CREATE TABLE IF NOT EXISTS journal_entries (
    trade_id     TEXT PRIMARY KEY,   -- deterministic FIFO round-trip id (see 5.2)
    account_id   TEXT NOT NULL,
    conid        INTEGER NOT NULL,
    setup        TEXT,               -- fixed dropdown value (nullable)
    notes        TEXT,               -- freeform
    tags         TEXT,               -- JSON array of freeform tag strings
    created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_journal_conid ON journal_entries(conid);
```

`setup` options (the fixed dropdown) live in a backend constant so Parallax's fib
methodology vocabulary stays consistent — initial set TBD with Ofek, seed with
e.g. `Fib retracement`, `Fib extension`, `Breakout`, `Mean reversion`,
`News candle`, `Other`. Tags are freeform JSON.

### 4.3 Derived (not persisted in v1): round-trip trades

Round-trip trades are **computed on demand** from `fills` by the FIFO matcher,
not stored. This keeps a single source of truth and avoids stale-trade bugs. If
profiling shows the matcher is too slow over long histories, v2 can add a
materialized `trades` cache table — the API shape won't change.

## 5. FIFO trade-matching engine

### 5.1 Algorithm

Per `conid`, walk fills in chronological order maintaining a signed lot queue:

- A fill that **increases** absolute position size (buy while flat/long, or sell
  while flat/short) **opens** lots → pushed onto the queue.
- A fill that **reduces** absolute position size **closes** against the oldest
  open lots (FIFO) → each closed quantity emits a realized-P&L contribution.
- Realized P&L per closed quantity:
  `(exit_price − entry_price) × qty × direction − allocated_commissions`,
  where `direction = +1` for longs, `−1` for shorts. Commissions are allocated
  proportionally from both the opening and closing fills.
- A round-trip **trade** = the span from first opening lot to the fill that
  flattens the position (qty returns to 0). Partial scale-in/scale-out stays in
  one trade until flat.
- **Still-open** positions (queue non-empty at end) are reported as `OPEN`
  trades with no close date and no realized P&L — excluded from calendar totals.

### 5.2 Stable `trade_id`

`trade_id = f"{account_id}:{conid}:{first_open_execution_id}"`. Deterministic and
stable as long as the opening fill exists, so journal entries stay attached even
as later fills arrive. (Edge case — a brand-new earlier fill arriving for the
same conid after a gap could re-key; acceptable for v1 given the live sync keeps
fills monotonic. Documented as a known limitation.)

### 5.3 Per-trade fields surfaced

`trade_id`, `conid`, `symbol`, `direction` (LONG/SHORT), `status`
(OPEN/CLOSED), `open_time`, `close_time`, `qty`, `avg_entry`, `avg_exit`,
`gross_pnl`, `commissions`, `net_pnl`, `return_pct`, `hold_duration_sec`,
constituent `fills[]`, and the joined `journal_entry` (setup/notes/tags).

`R-multiple` is **deferred**: it needs a planned risk/stop per trade, which we
don't capture in v1 (no manual entry form). Shown as `—` until a risk field is
added. Flagged so the detail view leaves a slot for it.

## 6. Backend API (`/inflect/*`)

Thin routers over an `InflectService`; all SQLite via `DatabaseService`; all
IBKR via `IBKRService`. Typed exceptions only.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/inflect/calendar?account_id&year&month` | Per-day net realized P&L + trade counts for a month, plus weekly rollups and month totals. |
| GET | `/inflect/trades?account_id&from&to&status` | Round-trip trades (FIFO-derived) in a date range, joined with journal entries. |
| GET | `/inflect/trades/{trade_id}?account_id` | One trade with constituent fills + journal entry. |
| PUT | `/inflect/trades/{trade_id}/journal` | Upsert notes/setup/tags for a trade. |
| POST | `/inflect/sync?account_id` | Force an immediate fills sync (used by on-open + manual refresh). |
| GET | `/inflect/setups` | The fixed setup-dropdown vocabulary. |

`calendar` and `trades` both run the FIFO matcher over `fills` filtered to the
account + a date window (matcher reads a little before the window to resolve
positions opened earlier).

## 7. Background sync service

New `InflectSyncService`, modeled on `ScannerService` (asyncio task started in
`main.py` lifespan, `start()`/`stop()`, auth-wait, `_stop_event`):

- Loop interval **60s**; **market-hours gated** (skip/lengthen when US markets
  closed — reuse or add a simple session-window check).
- Each tick: if authenticated, call the same `ibkr → trades → db.upsert_fills`
  path MoonMarket uses (days=7). Pacing limiter already caps `/iserver/account/
  trades` at 1/5s, so this is inherently safe alongside on-open pulls.
- On-open pull: the Inflect module fires `POST /inflect/sync` once on mount
  (TanStack Query mutation), then renders calendar/trades from the DB.

## 8. Frontend (`src/modules/inflect/`)

Mirrors the MoonMarket module shape (`MoonMarketModule.tsx` + layout + pages).

- **`InflectModule.tsx`** — reads account from the shared `useAccountStore`,
  fires on-open sync, routes between Calendar / Trades sub-pages.
- **`InflectLayout.tsx`** — header (month nav, "This month", monthly-stats chips)
  + account selector + sub-tab nav (Calendar | Trades).
- **`CalendarPage.tsx`** + **`CalendarGrid.tsx`** + **`DayCell.tsx`** +
  **`WeekRail.tsx`** — the monthly P&L grid and weekly rollups.
- **`TradesPage.tsx`** + **`TradesTable.tsx`** — round-trip list, sortable,
  click row → detail.
- **`TradeDetail.tsx`** — fills breakdown + P&L stats + **`JournalEditor.tsx`**
  (setup dropdown, freeform notes, tag input).
- **`useInflectCalendar` / `useInflectTrades` / `useInflectSync` /
  `useTradeJournal`** hooks (TanStack Query; mutation invalidates calendar +
  trades on journal save).
- API methods added to `src/lib/api.ts` (`inflectCalendar`, `inflectTrades`,
  `inflectTrade`, `inflectSaveJournal`, `inflectSync`, `inflectSetups`).
- Routing: add `{ path: "/inflect/*", element: <InflectModule /> }` to
  `orbitRouter` in `OrbitShell.tsx`; flip the launcher tile to `enabled`.

Styling reuses the dark/glow Orbit system; calendar green/red uses the existing
trading-color tokens.

## 9. Module boundary compliance (`parallax-hub`)

- Inflect **reads** `instruments`/`fills`; it does not modify Parallax behavior.
- No journal hooks, callbacks, or "save to journal" buttons added to Parallax or
  MoonMarket.
- All instrument linkage by `conid`, never ticker string.
- Inflect rides the existing `/indicators` endpoint if/when it wants entry-time
  indicator context (v2; not in this scope).

## 10. Testing

- Backend: FIFO matcher unit tests (longs, shorts, scale-in/out, partial closes,
  multi-day round-trips, commission allocation, still-open positions, options
  single-leg); calendar aggregation tests; journal upsert tests; sync-service
  start/stop + auth-wait tests. Reuse `AsyncMock` patterns; respect the
  `_run_write` write-lock for `journal_entries`.
- Frontend: store + hook tests, calendar render (P&L coloring, weekly rollups),
  trades table sort, journal editor save → invalidation.
- Per CLAUDE.md Rule 1: no PR without test coverage for changed code.

## 11. Confirmations (resolved 2026-06-01)

1. **Setup dropdown vocabulary** — STILL OPEN. Section 4.2 seed is a guess; Ofek
   to provide the real list. Only blocker remaining before code.
2. **Market-hours gate** — RESOLVED: **include pre- and post-market** (extended
   hours), not RTH-only. Sync runs across the extended-hours window.
3. **Calendar P&L** — RESOLVED: **net of commissions** (D2 confirmed). The mock's
   `$` figures are net.
4. **Trading-day timezone** — RESOLVED: **US/Eastern** (exchange time) for day
   bucketing.

## 12. Market session source (sync gate)

The background sync's "are we in the (extended) trading window?" gate uses IBKR's
trading-schedule data, not a hardcoded clock, so holidays and half-days are
handled correctly. There is **no** direct "is market open now" boolean endpoint
in the Client Portal API; the schedule is derived from:

- **`GET /trsrv/secdef/schedule`** (`assetClass=STK`, `symbol`, optional
  `exchange`) — authoritative. Returns per-session `tradingTimes` (pre-begin /
  begin / end) **and holidays / non-trading days**. Falls under the global
  10 req/s cap; **cache once per day**. Primary source for the gate.
- *(Alternative)* `GET /iserver/contract/{conid}/info-and-rules` — exposes
  `tradingHours` / `liquidHours` strings with `CLOSED` markers per contract.

**Gate logic:** fetch the schedule once per day (for a US-equity proxy symbol,
US/Eastern), derive today's extended-hours window (pre-begin → post-close), and
poll only inside it. **Fallback:** if the schedule call fails, fall back to a
hardcoded US/Eastern extended-hours window (≈04:00–20:00 ET, skip Sat/Sun) so the
sync degrades gracefully rather than stopping.

**The calendar itself needs neither endpoint:** P&L buckets by trade close date
(US/Eastern) and "days traded" is the count of days with closed trades — both
derived purely from `fills`. The schedule is used only for the sync gate (and
optionally to style weekend/holiday cells).
