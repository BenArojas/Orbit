# Today Page, Watchlists & Triggers Overhaul — Design

> Status: design approved 2026-05-20. Brainstorm transcript captured here as the source of truth before plan writing.
> Source: brainstorm session 2026-05-20 with Ben.
> Companion doc: [`2026-05-20-watchlists-triggers-recommendations.md`](./2026-05-20-watchlists-triggers-recommendations.md) — parked v2/follow-up items.

## 1. Why this exists

Dashboard, Screener, and Analysis pages are built. The watchlists/triggers feature is the thing that ties them together — it's the answer to *"why am I scanning these stocks and what do I do with the names I keep?"*

Current pain points:
- Trigger rules are bound to a single `conid`. Watching "RSI < 30 on every name in My Stocks" requires N hand-built rules.
- Creating a rule takes 6+ steps (re-type symbol, resolve, fill thresholds, pick source/target watchlists, choose timeframe, save).
- The dashboard's 310 px sidebar carries five panels (gateway, master watchlist, trigger hits, trigger rules, expiry config). Cognitive load is high; the panels compete for attention.
- A trigger hit shows *what* fired but not *why it matters* — no confluence framing, no chart context, no recommended action.
- "What deserves my attention right now?" is not a question the current dashboard answers in 30 seconds.

The goal is a feature that supports three usage patterns equally well: morning cockpit (open once, scan, leave), live alert workstation (react throughout the day), and exploratory (screener-driven discovery that lands in a watchlist).

## 2. Decisions locked during brainstorm

| Decision | Choice |
|---|---|
| Daily workflow assumption | Mixed — must support cockpit / live / exploratory |
| Rule scope | **Per-watchlist primary**, with per-stock overrides for special cases |
| Trigger action | **Tag in place + collect** into a "Today's Hits" feed. No IBKR watchlist moves by default. Per-rule opt-in IBKR mirror remains available |
| Rule logic | **Multi-condition (AND-joined)**. A rule = a setup definition. Fires only when all conditions are true on the same bar |
| Templates | **Curated library + custom save**. Six built-ins shipped. User can save any rule as a template |
| Page structure | **Today replaces Dashboard** as the default post-auth landing. The current dashboard is renamed **Market** and keeps gauges/sectors/RRG |
| Master IBKR Watchlist placement | **Where it earns its space**: Analysis page (left sidebar, current behavior), Today page (right rail), nowhere else. `cmd+K` palette is parked for future |
| Watchlist tags | **Visible everywhere a stock appears**: Today, Analysis watchlist sidebar, Screener results, Screener quick-peek. Shared `<StockTagDots>` component fed by a single `useStockTags` hook |
| Connection front-page | **Extracted as task #1.** Pre-auth page replaces the in-sidebar `GatewaySetup`. Everything downstream assumes `authenticated = true`. Borrows MoonMarket's `<PublicRoute>`/`<ProtectedRoute>` split, adapted to Parallax's Zustand tab nav |
| Dismiss/snooze state | **Persisted to SQLite** (not in-memory). Survives reload, queryable as history |

## 3. New top-level navigation

```
Connection (pre-auth) → Today (default) → Market → Analysis → Screener → Settings
```

- **Connection** — new. Houses the existing gateway setup UI. Only shown when not authenticated. On auth success → routes to last-known authenticated tab, or Today on first launch.
- **Today** — new. Default post-auth landing. Replaces the current Dashboard. Absorbs Market Pulse, gauges, and the Alert Log into a single cockpit view.
- **Market** — renamed from the current Dashboard. Holds Sector Performance, RRG, and any deeper structural market view we build later. No watchlist sidebar. No alert log.
- **Analysis**, **Screener**, **Settings** — unchanged structurally. Analysis keeps its watchlist sidebar.

Implementation: `useNavigationStore` adds `'connection' | 'today' | 'market'` to its tab union and drops `'dashboard'` (with a one-time migration of any persisted nav state). `DashboardPage.tsx` is split: structural content (`SectorPerformancePanel`, `RRGPanel`) moves to a new `MarketPage.tsx`; the alert log, gateway setup, master watchlist, trigger rules, and watchlist expiry components are removed from there and either rehomed (Today page) or deprecated (expiry — folded into the per-rule modal as an advanced field).

## 4. Connection front-page

A single page rendered before any other UI when `useGateway()` reports `!isAuthenticated`.

**Components:**

- `src/pages/ConnectionPage.tsx` — wraps the existing `GatewaySetup` content (lifted out of `DashboardPage.tsx`) plus the diagnostics introduced in Phase 7.5 / 8.10 (gateway PID status, factory reset, restart).
- `src/components/shell/AuthGuard.tsx` — a wrapper around the shell's page renderer. Reads `isAuthenticated` from `useGateway()`. If `false`, forces `currentTab = 'connection'`. If `true` and `currentTab === 'connection'`, restores `previousAuthenticatedTab` from `useNavigationStore` (defaults to `'today'`).
- Loading gate: while the first `gateway-status` query is in flight, render a centered spinner from the shell — no flicker through Today before bouncing to Connection.
- Mid-session disconnect handling: existing non-blocking banner (Phase 7.1) stays for transient drops. Only a hard logout or factory reset routes back to Connection.

**Patterns borrowed from MoonMarket's auth:**

1. Two-state route guard with a loading gate (`ProtectedRoute.tsx` pattern).
2. Restore-last-page on re-auth (their `state.from`; ours is `previousAuthenticatedTab`).
3. On logout: `queryClient.removeQueries({predicate: q => q.queryKey[0] !== 'gateway-status'})`. Verify this predicate also covers the new `'stock-tags'`, `'trigger-templates'`, and `'today-hits'` keys we introduce.
4. TanStack Query as the auth source of truth (no separate React context).

**Where we diverge from MoonMarket:**

- Parallax embeds gateway setup inline (vs. MoonMarket opening `localhost:5001` in a new tab). We keep the embedded UX.
- Zustand tab nav, not React Router. The guard is a render-side decision in the shell, not a route declaration.
- Richer gateway lifecycle UI (PID adoption, factory reset, orphan recovery) lives on Connection from day one.

## 5. Today page anatomy

```
┌─────────────────────────────────────────────────────────────────┐
│ PARALLAX   ●Today   Market   Analysis   Screener   Settings    │
├─────────────────────────────────────────────────────────────────┤
│ [SPX] [VIX] [Breadth] [Strength] [Rotation] [TopSec] [WorstSec] │ ← context strip
├──────────────────────────────────────────────┬──────────────────┤
│ Setups firing — 7 today, 3 high-confluence   │  Watchlist       │
│ [All] [High conf] [Swing] [Momentum] [MR]    │  Swing Setups ▾  │
│ ┌─────────────┐ ┌─────────────┐              │  AAPL ●● 184.20  │
│ │ AAPL hit    │ │ NVDA hit    │  hero cards  │  NVDA ● 920.40   │
│ └─────────────┘ └─────────────┘              │  ...             │
│ ┌─────────────┐ ┌─────────────┐              ├──────────────────┤
│ │ META hit    │ │ TSLA hit    │              │  Rules           │
│ └─────────────┘ └─────────────┘              │  ● Golden P.  3  │
├──────────────────────────────────────────────┤  ● Breakout+V 2  │
│ Timeline (chronological feed)                │  + Add rule      │
└──────────────────────────────────────────────┴──────────────────┘
```

### Components

| Component | Role | Source of truth |
|---|---|---|
| `<TodayContextStrip>` | 7-cell market context: SPX, VIX, Breadth proxy, Market Strength, Sector Rotation summary, Top sector, Worst sector. Replaces `<MarketPulse>` + `<ArcGaugeRow>` in one denser strip | Existing `/market/quotes` (bundled), `/sectors/performance`, gauge endpoints |
| `<TodayHits>` | Hero card grid. Each card shows symbol, rule name, confluence %, condition pills with actual values, mini-sparkline, action buttons (Open chart / Snooze / Dismiss) | `GET /triggers/hits?status=active` |
| `<TodayHitsFilters>` | Pills above the grid: All / High conf / by watchlist / by indicator family | Client-side filter over the same query |
| `<TodayTimeline>` | Chronological hit feed. Absorbs the current `<AlertLog>` behavior. Click row → `navigateToAnalysis(conid)` | Same query, sorted by `triggered_at` desc |
| `<TodayWatchlistRail>` | Right rail (≈240 px). Reuses `<WatchlistSidebar>` component with watchlist switcher + virtualized rows + inline `<StockTagDots>` | Existing watchlist API |
| `<TodayRulesPanel>` | Below the rail. Compact rule list — LED, name, hit count today, click to edit. "+ Add rule" opens the new template-aware modal | `GET /triggers/rules` (new shape) |

### Behavior

- Cards default-sorted by confluence × recency. Filter pills reorder/scope.
- Snooze and dismiss persist to SQLite (see schema). Dismissed cards don't reappear until manually un-dismissed via the timeline (which still lists them). Snoozed cards reappear after `snoozed_until`.
- WS `trigger_alert` invalidates `["today-hits"]` so the feed updates in real time.
- Empty state: "No setups firing yet. Triggers run every 5 min during market hours." with a CTA to view/add rules.

## 6. Trigger data model

### Tables

**`trigger_rules` (modified)**

```sql
-- existing columns kept
id, name, enabled, timeframe, scan_interval_seconds, created_at, updated_at

-- new
watchlist_name TEXT             -- IBKR watchlist this rule is scoped to; NULL = per-stock override
template_id INTEGER             -- FK to rule_templates, nullable
ibkr_mirror_target TEXT         -- opt-in: when set, hits also move/append to this IBKR watchlist (revival of the old move behavior)

-- existing become nullable (only set when rule is per-stock override)
conid INTEGER                   -- nullable now
symbol TEXT                     -- nullable now

-- removed from this table (moved to trigger_conditions)
indicator, condition, threshold, news_candle_method

-- kept for migration only, deprecated by new code
source_watchlist, target_watchlist, auto_expire_days
```

**`trigger_conditions` (NEW)** — 1..N rows per rule, ALL must pass on the same bar:

```sql
id INTEGER PRIMARY KEY
rule_id INTEGER NOT NULL REFERENCES trigger_rules(id) ON DELETE CASCADE
order_index INTEGER NOT NULL    -- display order
indicator TEXT NOT NULL         -- rsi, macd, ema_9, ema_21, ema_50, ema_200, fibonacci, volume, bbands, vwap, atr, stoch, obv, adx, news_candle
condition TEXT NOT NULL         -- above, below, crosses_above, crosses_below, fires
threshold REAL                  -- numeric threshold
news_candle_method TEXT         -- nullable, only for news_candle indicator
```

**`trigger_hits` (modified)**

```sql
-- existing columns kept
id, rule_id, conid, symbol, triggered_at, dedup_key,
source_watchlist, target_watchlist, moved_back  -- (these populated only when ibkr_mirror_target is set)

-- new
condition_values TEXT NOT NULL  -- JSON: [{indicator, condition, threshold, actual_value}, ...]
watchlist_name TEXT             -- denormalized for fast filtering; NULL for per-stock rules
dismissed_at TIMESTAMP          -- nullable
snoozed_until TIMESTAMP         -- nullable
```

**`rule_templates` (NEW)**

```sql
id INTEGER PRIMARY KEY
name TEXT NOT NULL
description TEXT
category TEXT NOT NULL          -- momentum, mean_reversion, breakout, fibonacci, news, custom
is_builtin INTEGER NOT NULL     -- 1 for curated, 0 for user-saved
default_timeframe TEXT NOT NULL -- 1D, 1W, 1M
conditions_json TEXT NOT NULL   -- JSON array of {indicator, condition, threshold, news_candle_method?}
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
```

### Curated template library (v1)

Seeded on first boot. Each maps to indicators we already compute.

1. **Golden Pocket Bounce** *(fibonacci)* — RSI < 35 AND price within 1% of 0.618 fib level AND volume > 1.2× 20-bar avg
2. **Mean Reversion** *(mean_reversion)* — RSI < 30 AND close above 200 EMA
3. **Trend Pullback to 21EMA** *(momentum)* — low touches 21 EMA AND close above 50 EMA AND close above 200 EMA
4. **Breakout + Volume** *(breakout)* — close crosses_above 20-day high AND volume > 1.5× 20-bar avg
5. **Earnings Gap Reaction** *(news)* — news_candle (gap method) > 2% AND volume > 1.5× avg
6. **Oversold Bounce** *(mean_reversion)* — RSI crosses_above 30 AND close above 50 EMA

### Migration

Run once on first launch of the new version:

1. For each row in `trigger_rules`, insert one row into `trigger_conditions` with the legacy `(indicator, condition, threshold, news_candle_method)` and `order_index = 0`.
2. Set `trigger_rules.ibkr_mirror_target = target_watchlist` for every row so existing move-to-target behavior continues unchanged.
3. Set `trigger_rules.watchlist_name = NULL` (per-stock override mode) so the rule still binds to its single `conid`. No user-visible behavior change on day one.
4. Backfill `trigger_hits.condition_values` from the legacy single-condition columns.
5. Backfill `trigger_hits.watchlist_name` from the rule's `watchlist_name` (NULL for migrated rules; the user opts into watchlist scope explicitly afterward).
6. Drop the now-unused columns from `trigger_rules` *only after* one full release cycle of read compatibility. (Phase-2 cleanup migration.)
7. Seed the 6 built-in templates if `rule_templates` is empty.

After migration, the user can edit any rule and switch it to `watchlist_name = "Swing Setups"` (now a dropdown of their IBKR watchlists) and toggle off `ibkr_mirror_target` to enter the new tag-in-place model.

## 7. Trigger evaluation engine

In `backend/services/scanner.py`:

For each enabled rule:

1. **Expand the conid set:**
   - If `watchlist_name` is set → fetch current IBKR watchlist membership for that name (cached); each member is a target conid for this rule's evaluation.
   - If `conid` is set → just that one.
2. **For each (rule, conid):**
   - Fetch indicators at the rule's `timeframe` (existing indicator-compute path).
   - Evaluate **every** `trigger_conditions` row against the latest bar.
   - Fire **only if all pass**. Record `condition_values` with the actual measured value of each condition's indicator at fire time.
3. **Dedup** using the existing `dedup_key` mechanism (`rule_id + conid + date + interval`).
4. **If `ibkr_mirror_target` is set**, also call the existing `move_between_watchlists` for IBKR sync (auto-expire return scanner still applies).
5. **Broadcast** WS `trigger_alert` (existing path).

Per-watchlist rule changes the scanner's hot-loop cost: instead of `N rules` it's `sum(members_per_watchlist) + per_stock_rules`. Indicator compute is already batched by conid in the existing engine, so this stays within current performance envelope as long as a watchlist's member count is reasonable (< ~50 per list).

## 8. Tag visibility everywhere

### Backend

`GET /triggers/tags?conids=12345,67890,...` →

```json
{
  "12345": [
    {
      "rule_id": 7,
      "rule_name": "Golden Pocket Bounce",
      "indicators": ["rsi","fibonacci","volume"],
      "fired_at": "2026-05-20T13:31:02Z"
    }
  ],
  "67890": []
}
```

- Returns active tags only: hits where `dismissed_at IS NULL AND (snoozed_until IS NULL OR snoozed_until < CURRENT_TIMESTAMP)`.
- Cached server-side for ~5s (consistent with other read endpoints).
- Indexed on `(conid, dismissed_at, snoozed_until)`.

### Frontend

`useStockTags(conids: number[])` — TanStack Query:

```ts
queryKey: ["stock-tags", conidsKey]
queryFn: ({ signal }) => api.getStockTags(conids, signal)
staleTime: 15_000
refetchInterval: 30_000
```

Invalidated on WS `trigger_alert` (same pattern as `AlertLog`).

`<StockTagDots conid={n} max={3} />` — small colored dots, one per fired rule, colored by the rule's dominant indicator family using the existing color map (`TRIGGER_DISPLAY` from `TriggerWatchlist.tsx`, extracted to a shared module). Hover → tooltip with rule name and `condition_values`. Overflow → `+N` pill.

### Surfaces

- `WatchlistSidebar` (Analysis page) — dots in each row
- `TodayWatchlistRail` (Today page) — same component, same hook
- `ScreenerResultsTable` — new tag-badge cell, only rendered when the conid is in any of the user's IBKR watchlists (gate on `watchlistMembership(conid)` already exists in `src/lib/api.ts`)
- Screener quick-peek slide-over — tag chips above the symbol header

## 9. Backend endpoint surface

### New

- `GET    /triggers/templates` — list curated + user templates
- `POST   /triggers/templates` — save a custom template (from a rule's shape or a free-form payload)
- `DELETE /triggers/templates/{id}` — only allowed when `is_builtin = 0`
- `GET    /triggers/tags?conids=...` — active tags for the given conids
- `POST   /triggers/hits/{id}/dismiss` — sets `dismissed_at = CURRENT_TIMESTAMP`
- `POST   /triggers/hits/{id}/snooze` — body `{duration_minutes: int}`; sets `snoozed_until`

### Modified

- `POST  /triggers/rules` — payload now `{name, watchlist_name?, conid?, template_id?, ibkr_mirror_target?, timeframe, scan_interval_seconds, conditions: [{indicator, condition, threshold, news_candle_method?}]}`
- `PATCH /triggers/rules/{id}` — same shape, partial. Replacing `conditions` replaces the whole set (delete+insert in a transaction).
- `GET   /triggers/hits` — new filters: `?status=active|dismissed|snoozed|all` (default `active`), `?watchlist=name`

### Unchanged

- `GET /triggers/rules`, `DELETE /triggers/rules/{id}`, `GET /triggers/scanner/status`, watchlist routers, watchlist-config router.

Pydantic models in `backend/models/` updated to match the new payload shape. Frontend API client in `src/lib/api.ts` mirrors the changes; type-only changes propagate to consumers.

## 10. Testing

Per project rule 1: tests for everything.

**Backend (pytest):**

- Schema migration — legacy single-condition rules survive, `condition_values` backfills correctly, `ibkr_mirror_target` preserves move behavior
- Multi-condition evaluation — 2-of-3 fails, 3-of-3 fires, edge case where conditions hit on the same bar with different indicators
- Per-watchlist scope — new watchlist member auto-inherits rules, removed member stops firing
- Dismiss / snooze — dismissed hit not returned by `?status=active`, snoozed hit reappears after `snoozed_until`
- Tag endpoint — returns only active tags; respects dismiss and snooze
- Templates — builtin templates seed on first boot (idempotent), custom save creates a row, delete blocked on builtins, applying a template returns a fully populated rule payload
- Pre-existing broken trigger tests (per Phase 10 carryover list) — catalog them; collateral fixes for the test-code bugs (`'IBKRRequestError' object has no attribute 'detail'`, `MagicMock` instead of `AsyncMock` in scanner, etc.) get repaired as part of this work since we're already touching the test files

**Frontend (vitest):**

- `<StockTagDots>` renders 0/1/2/3+N states
- `useStockTags` invalidates on WS `trigger_alert`
- Today page renders empty / loading / error / populated states
- Rule modal — template prefill, add/remove condition, watchlist-vs-stock-mode toggle, IBKR-mirror toggle
- `<AuthGuard>` routes to Connection when unauthenticated, restores last tab on re-auth, gates first render behind the loading spinner

## 11. Out of scope (parked)

See [`2026-05-20-watchlists-triggers-recommendations.md`](./2026-05-20-watchlists-triggers-recommendations.md) for the full list with motivation and rough sizing. Top entries:

1. Smart Screener "Add + watch" — one-click adds a result to a watchlist *and* proposes a starter rule set
2. Analysis page "Create rule from current view" — right-click a chart level, prefill threshold
3. Cmd+K palette — fuzzy symbol/rule search across all watchlists
4. Cross-rule confluence detection — surface when 2+ different rules fire on the same conid simultaneously
5. Setup-archetype starter watchlists — auto-suggested watchlist names + default rules
6. Real inline mini-charts on hit cards (current spec uses cheap SVG sparklines)
7. Per-rule health stats — fire rate / win rate / dismissal rate over time
8. Snooze presets — 1h / EOD / tomorrow / 1 week shortcuts
9. AI-assisted rule generation, analogous to the AI screener filter feature
10. Watchlist-aware AI prompts on Analysis (already in `parallax-v2-roadmap`)

## 12. Task ordering (preview for plan-writing)

The plan writer should sequence work so each step is independently shippable and reviewable:

1. **Connection front-page extraction** — auth guard, page move, no behavior changes downstream. *Foundation for everything else.*
2. **Market page rename** — split `DashboardPage` into `MarketPage` (gauges/sectors/RRG only) + leave a stub for Today. Clean break before Today is built.
3. **Schema migration + new trigger data model** — backend only, with full test coverage. Legacy behavior unchanged because `ibkr_mirror_target` carries the old move behavior.
4. **Multi-condition evaluation engine** — scanner updated to evaluate `trigger_conditions`. Per-watchlist expansion. Test coverage.
5. **Rule modal redesign** — template picker + conditions list + watchlist/stock-mode toggle. Wire to new endpoints.
6. **Template library** — seed built-ins, custom save/delete endpoints, UI in the modal.
7. **Dismiss/snooze + tag endpoint** — `POST .../dismiss`, `POST .../snooze`, `GET /triggers/tags`. Tests.
8. **`<StockTagDots>` shared component** — single source of truth for tag rendering. Tests.
9. **Today page** — context strip, hits grid, filters, timeline, watchlist rail, rules panel. Builds on everything above.
10. **Screener tag visibility** — wire `<StockTagDots>` into result rows and quick-peek slide-over.
11. **Cleanup** — delete deprecated columns in a follow-up migration after one release cycle of read compatibility; drop unused components from the old dashboard.
