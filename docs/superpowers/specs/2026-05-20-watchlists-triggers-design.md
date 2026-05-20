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

**`trigger_rules`**

```sql
id INTEGER PRIMARY KEY
name TEXT NOT NULL
enabled INTEGER NOT NULL DEFAULT 1
timeframe TEXT NOT NULL                  -- 1D, 1W, 1M
scan_interval_seconds INTEGER NOT NULL   -- default 300
watchlist_name TEXT                      -- IBKR watchlist this rule is scoped to; NULL = per-stock override
conid INTEGER                            -- nullable; only set when watchlist_name IS NULL
symbol TEXT                              -- nullable; display only when conid is set
template_id INTEGER                      -- FK to rule_templates, nullable
ibkr_mirror_target TEXT                  -- opt-in: when set, hits also move/append to this IBKR watchlist
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP

CHECK ((watchlist_name IS NOT NULL) OR (conid IS NOT NULL))
```

The check constraint guarantees every rule has a scope: either a watchlist or an explicit conid (or both — per-stock overrides inside a watchlist-scoped rule are a future extension, not v1).

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

**`trigger_hits`**

```sql
id INTEGER PRIMARY KEY
rule_id INTEGER NOT NULL REFERENCES trigger_rules(id) ON DELETE CASCADE
conid INTEGER NOT NULL
symbol TEXT NOT NULL
triggered_at TIMESTAMP NOT NULL
dedup_key TEXT NOT NULL                  -- rule_id + conid + date + interval
condition_values TEXT NOT NULL           -- JSON: [{indicator, condition, threshold, actual_value}, ...]
watchlist_name TEXT                      -- denormalized for fast filtering; NULL for per-stock rules
dismissed_at TIMESTAMP                   -- nullable
snoozed_until TIMESTAMP                  -- nullable

-- IBKR mirror tracking — populated only when the rule has ibkr_mirror_target set
source_watchlist TEXT
target_watchlist TEXT
moved_back INTEGER NOT NULL DEFAULT 0    -- set when the auto-expire return scanner returns the symbol

UNIQUE(dedup_key)
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

### Schema setup (no data migration needed)

Parallax is pre-launch; there are no production trigger rules or hits in the wild. The schema lands as a clean install:

1. Apply the new schema as the next versioned migration. `trigger_rules` ships with the new shape from the outset (`watchlist_name`, `template_id`, `ibkr_mirror_target`, nullable `conid`/`symbol`, no `indicator`/`condition`/`threshold` columns).
2. Create `trigger_conditions` and `rule_templates` from scratch.
3. `trigger_hits` ships with `condition_values`, `watchlist_name`, `dismissed_at`, `snoozed_until` already in the schema.
4. The legacy `source_watchlist`/`target_watchlist`/`auto_expire_days` columns on `trigger_rules` are *not* carried forward — there's no legacy data to preserve. Move-to-target behavior is reachable via the new `ibkr_mirror_target` field (opt-in per rule).
5. Seed the 6 built-in templates on first boot — `rule_templates` insert is idempotent (`INSERT OR IGNORE` keyed on `(name, is_builtin)`).

If dev SQLite databases already exist on the contributors' machines from earlier testing, the simplest path is to drop and recreate the trigger-related tables as part of the migration. None of that data is production.

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

Baseline: 798 passing / 1 skipped / 0 failing as of `1939916` (the Phase 10 carryover backlog was cleared in `3faaa6d`). The bar is to keep that green and add coverage for new behavior.

**Backend (pytest):**

- Clean schema setup — fresh DB boots with `trigger_conditions`, `rule_templates`, and the new columns; built-in templates seed exactly once across reboots
- Multi-condition evaluation — 2-of-3 fails, 3-of-3 fires, edge case where conditions hit on the same bar with different indicators
- Per-watchlist scope — new watchlist member auto-inherits rules, removed member stops firing
- Per-stock override — rules with `watchlist_name = NULL` and explicit `conid` evaluate exactly as expected
- Dismiss / snooze — dismissed hit not returned by `?status=active`, snoozed hit reappears after `snoozed_until`
- Tag endpoint — returns only active tags; respects dismiss and snooze
- Templates — built-ins seed idempotently, custom save creates a row, delete blocked on `is_builtin = 1`, applying a template returns a fully populated rule payload
- `ibkr_mirror_target` opt-in — when set, hits still call `move_between_watchlists` and the existing auto-expire return-scanner path is exercised; when NULL, no IBKR move occurs
- Trigger-related tests touched during the refactor get migrated to the new schema; tests covering removed code paths get retired

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
3. **New trigger schema** — `trigger_rules` revised shape, `trigger_conditions`, `rule_templates`, `trigger_hits` extensions. Built-in template seeding. Backend tests for the new schema.
4. **Multi-condition evaluation engine** — scanner evaluates `trigger_conditions`, per-watchlist scope expansion, per-stock override path. Test coverage.
5. **Rule modal redesign** — template picker + conditions list + watchlist/stock-mode toggle + optional `ibkr_mirror_target`. Wire to new endpoints.
6. **Template library UI** — custom save/delete from the modal, manage saved templates surface.
7. **Dismiss/snooze + tag endpoint** — `POST .../dismiss`, `POST .../snooze`, `GET /triggers/tags`. Tests.
8. **`<StockTagDots>` shared component** — single source of truth for tag rendering. Tests.
9. **Today page** — context strip, hits grid, filters, timeline, watchlist rail, rules panel. Builds on everything above.
10. **Screener tag visibility** — wire `<StockTagDots>` into result rows and quick-peek slide-over.
11. **Cleanup** — drop unused components from the old dashboard, remove now-orphaned `<WatchlistConfigSection>` (recommendations doc §11 retains the rationale).
