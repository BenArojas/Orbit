# Phase 1 progress

Status: in progress. Phase 0 is complete and approved. No Phase 2 work is enabled.

## Dependency inventory

Client Portal remains installed for import until owner parity checks pass.
It is no longer auto-started or used as the production product-data source.
Its current transport is `backend/services/ibkr.py`, wired through `main.py`
and `deps.py`.

| Area | Current owners | Transition needed |
|---|---|---|
| Quotes, history, identity | `routers/market.py`, `routers/indicators.py`, `routers/ws.py`, `services/instrument_identity.py` | TWS-derived quotes/history/contracts through the existing adapter; preserve callers and metadata. |
| Watchlists | `routers/watchlist.py`, `routers/watchlist_config.py` | One-time read-only CP import; local names, member order, and editing thereafter. |
| Alerts and settings | `services/scanner.py`, `routers/triggers.py`, `services/db.py` | Preserve SQLite rules/settings/drawings; switch history and membership to TWS/local storage. Replace optional CP watchlist mirroring with local behavior. |
| Posture | `services/market_assessment.py`, `models/market_assessment.py` | Replace CP history; map `broad` to approved `healthy` across backend and UI. Keep `selective` and `defensive`. |
| Relative strength | `services/rs_leaders.py`, `routers/rs.py` | Retain Fred6725 publication provenance; replace CP symbol/contract resolution. Keep top-30 coverage explicit; absence is not lagging. |
| Sectors | `services/sectors.py`, sector constants | Replace CP bars/contracts; explicit SMH mapping and unknown mappings. |
| Holdings/account/options | `services/moonmarket.py`, `services/options.py`, related routers | TWS account/position metadata, option fields/Greeks, PDT evidence, execution and commission ingestion. |
| Startup and session | `services/gateway.py`, `services/broker_session.py`, `routers/auth.py`, `routers/health.py`, `routers/gateway.py` | Remove CP startup/auth dependencies only after data parity; retain the single TWS adapter connection. |
| Legacy execution | `services/orders.py`, `services/trading_safety.py`, related routers | CP mutation routes remain disabled by Phase 0. Do not reconnect them through a data compatibility layer. |
| Old screener | `services/screener.py`, `routers/screener.py` | Inventory retained; new scans are out of scope under the approved spec. |

The inventory above records the starting dependencies. Production services now
use `TwsDataService` over the existing adapter connection. Legacy reuse/test
callers retain a bounded compatibility dependency until parity is approved.

## Completed: versioned database migration foundation

- Migration 1 adopts existing tables and legacy column/data updates.
- Migration 2 adds local watchlists and ordered raw rows.
- Migration 3 adds execution and commission records.
- Back up before schema/data changes, including committed WAL contents.
- Rehearse on a temporary copy and check integrity/foreign keys.
- Apply atomically under a write reservation; roll back on failure.
- Reject future schema versions; retain the backup for manual recovery.
- Existing settings, alerts, drawings, and legacy hit attribution remain intact.
- No developer or packaged user database was opened or migrated during testing.

Validation uses only temporary databases:

- `tests/test_db_migrations.py` and `tests/test_db_concurrent_writes.py`: 8 passed.
- Existing legacy preservation test in `tests/test_setup_plans.py` and
  `tests/test_moonmarket_router.py`: 18 passed.
- WAL backup, restart, recovery into a separate file, rehearsal failure,
  application failure, and future-version refusal exercised.
- `git diff --check`: passed.
- Existing dependency deprecation warnings remain (pandas-ta and Starlette).

## Implemented data transition

- Product market/indicator/sector/posture/RS reads use TWS, not CP. Legacy scans
  and performance curves explicitly report unavailable, as they are out of scope.
- Snapshots carry UTC receipt time, market-data type, age, and freshness.
  Receipt time is not an exchange timestamp. Entry and place-override API routes
  reject delayed/frozen/stale/unknown/future-dated quotes; reducing flatten
  remains independent of quote eligibility.
- `/ws` translates TWS ticks into the existing product stream contract, including
  connection state and resubscription after reconnect.
- Settings has a one-time import button. Import reads every CP watchlist before
  committing any, preserves names/order/raw header rows, and refuses incomplete
  responses and conflicts without marking import complete. Subsequent list edits
  and alert-driven moves are local.
- Posture is `healthy`, `selective`, or `defensive` through backend and UI.
- RS still uses Fred6725 publication provenance, with TWS contract verification.
  API and UI explicitly say top-30 coverage. Omitted names have unknown RS.
- Contract details map semiconductor categories to SMH and label unknown maps.
- Native TWS daily/weekly history is RTH-only. `/data/history/{conid}` reports
  requested/returned coverage and unknown ATH, never a one-year high labeled ATH.
- Holdings include account, currency, security type, multiplier, option
  strike/right/expiry, and explicitly unknown valuation freshness. Unknown values
  remain null; the legacy aggregate portfolio refuses missing valuations.
- Option chains use `reqSecDefOptParams` and verified single-leg contracts.
  Missing model Greeks are explicitly unavailable. No option orders are added.
- Executions and commissions are persisted independently by execution ID and
  joined after restart. Reconnect requests executions again. Unknown ownership
  stays unmatched; historical replay does not emit new-fill notifications.
- `/data/account` exposes raw `DayTradesRemaining` evidence but marks its paper
  verification and freshness unknown. It does not authorize intraday entries.
- Health/auth/session views follow TWS rather than CP authentication. Production
  does not advertise an exclusive CP data mode.

The authenticated fake-broker workflow exercises incomplete import refusal,
import/restart with CP stopped, retained settings/drawings/alerts, repeated alert
evaluation without duplicate hits, quote refusal including place overrides,
native weekly request arguments, SMH metadata, option fields and missing Greeks,
portfolio compatibility, execution/commission deduplication, and stream reconnect.

## Final automated validation

- Focused backend acceptance command: **217 passed**. This includes the Phase 1
  public workflow, migrations/concurrent writes, market posture, RS, alerts,
  watchlists, retained portfolio/options paths, TWS data/stream/reconciliation
  paths, existing order callers, Gateway/session compatibility, and sidecar
  safety-boundary checks.
- `NamesPage.test.tsx` and `MarketPage.test.tsx`: **13 passed**.
- `npm run typecheck`: passed; final `npm run build`: passed.
- `npm run check:policy-drift`: passed.
- `git diff --check`: passed.
- Real source sidecar smoke: two isolated launches passed, including startup,
  authenticated HTTP/WS, credential rotation, legacy-route denial, and graceful
  shutdown. Uses temporary data and sends no broker orders.
- `check-phase1-paper.py --help`: passed. With the owner's confirmation that
  IB Gateway paper was ready and Orbit closed, the real read-only diagnostic
  connected to port 4002 but failed the required paper identity gate.
- Earlier failed checks were incomplete test fakes/old expectations after the
  new quote gate and response fields. Fixtures now supply fresh paper quotes
  and session headers. No production gate was relaxed.
- Warnings remain: pandas-ta/Starlette deprecations, existing React test
  `act`/undefined-query warnings, and Vite chunk-size/static-dynamic import
  warnings. These are not passing latency measurements.
- The Phase 1 packaged app, real-paper data path, and Windows have not been
  tested. Phase 0's packaged-app evidence does not certify these new changes.
- No user database was opened, no Client Portal watchlists were modified, and no
  actual paper/live orders were sent. Real diagnostics used a temporary database.
  Changes remain uncommitted.

### Real Gateway blocker

Two read-only attempts on 2026-11-13 stopped at the identity gate, before market
data/Greeks/history/PDT checks. Sanitized evidence from the second attempt:

```json
{
  "port": 4002,
  "connected": true,
  "paper_port": true,
  "account_count": 1,
  "matching_du_account_count": 0,
  "single_paper_account": false,
  "error": "not_paper_account"
}
```

No account identifier is recorded. A paper port alone is insufficient. Do not
relax the gate or retry until the owner resolves/confirms the Gateway account
identity. This result does not prove whether the connected account is live or
paper; it proves it does not satisfy the Phase 0 `DU`-plus-digits contract.

Resolution (D53): the owner's Gateway log showed a paper ID of the form `DU` +
one letter + digits. With owner approval the gate now accepts an optional single
letter after `DU`. Port and single-account checks are unchanged.

### Real paper results (2026-11-13, port 4002, read-only, temporary DB)

| Check | Result |
|---|---|
| Paper identity (D53) | **Pass**: one account, matches the paper pattern, paper port |
| Quotes SPY/QQQ/NVDA/IREN | Received, but **delayed**. At the time, entry was refused; per D54 fresh delayed data now authorizes paper entries with a visible label. Live entries need a live market-data subscription shared to the paper account |
| Daily history | 1Y: 251 bars; 10Y: ~2,512 bars (IREN 1,253, listed late 2021) |
| Weekly history (native `1 week`) | 15Y: 783 bars (IREN 261) |
| ATH | Reported unknown at the time; superseded by D56 derivation (below) |
| SMH mapping | **Pass** for NVDA |
| Other sector mapping | SPY/QQQ (ETFs) unknown, as designed. IREN mapped to XLF from IBKR's own category. That is IBKR's classification, not Orbit's, and needs owner review |
| PDT | **Unavailable**. None of 24 account-summary or 159 account-value tags contain day-trade fields — consistent with the rule's retirement (resolved by D55, see the follow-up section below) |
| Option Greeks | Not verified. First run picked an expiring contract with a non-listed strike (diagnostic bug, fixed). The retry did not complete (see below) |
| Positions | 6 holdings read; no option positions to check metadata against |
| Executions/commissions | 0 observed today; reconnect snapshot path ran, but there was nothing to deduplicate |

Bugs found and fixed during these runs:
- An IBKR symbol-search timeout was reported as "symbol not found". It now
  returns a visible connection failure (regression check added).
- The diagnostic option check now targets an expiry about 30 days out and
  tries the nearest strikes that actually exist.

The follow-up runs failed: first "client ID 1 already in use" (likely the
session left by the crashed run), then a connect timeout. Retries stopped
after two failures. Gateway needs owner attention before the option-Greeks
check and a clean full run.

## Pending real-paper acceptance

| Exit check | Automated evidence | Real paper status |
|---|---|---|
| Import names, ordering, alerts after restart, CP stopped | Passed on temporary DB/fake CP | Owner parity check pending |
| Three approved posture states | Backend and UI checks passed | Real TWS-derived assessment pending |
| Entry data gate: fresh live/delayed allowed and labeled; frozen/stale/unknown refused (D54) | API checks passed | Real-paper delayed evidence below |
| Longer daily/weekly history and indicator warm-up | Native request/coverage contract checked | Representative symbol depth pending |
| ATH | Derived from IBKR's earliest-data timestamp; verified only when the window reaches it (D56) | Re-run pending, see below |
| RS top-30 limitation and omitted-name meaning | API/UI checked | Real TWS listing resolution pending |
| SMH mapping | Fake contract category checked | Real contract categories pending |
| Option contract fields and Greeks | Fields checked; snapshot fallback verified at API boundary | **Verified live on paper** (above) |
| PDT rolling-window behavior | Rule retired by FINRA effective 2026-06-04; status reported, no gate (D55) | Resolved by decision, see below |
| Executions/commissions | Duplicate events and restart persistence checked | Actual reconnect snapshot pending |

Paper-account data verification needs an authenticated IB Gateway paper
connection. Data checks do not authorize placing test orders; the Phase 2
order-shape spike requires its own explicit paper test.

### Read-only paper diagnostic

Close Orbit first so there is no competing client ID 1 connection. Log into
IB Gateway paper on 4002 (or TWS paper on 7497), then from `backend/`:

```bash
uv run python ../scripts/check-phase1-paper.py --port 4002 --confirm-orbit-closed
```

The diagnostic uses a temporary database and reports counts/coverage only, not
account identifiers, positions, executions, or credentials. It never calls
place/modify/cancel. It requests SPY, QQQ, NVDA, and IREN daily and weekly history,
checks available option Greeks, and records the day-trade rule status.
The initial real runs stopped at the identity gate, as recorded above.

## Follow-up: delayed entries, day-trade rule, ATH (2026-11-13)

Three product decisions resolved the open items above:

- **D54 delayed entries.** Fresh live and streaming-delayed quotes authorize
  paper entries; the UI shows a "Delayed" label. Frozen, delayed-frozen, stale,
  unknown, and invalid bid/ask still block. The owner will subscribe to live
  market data; delayed is a working fallback, not a block.
- **D55 day-trade rule.** FINRA retired day-trade counting and the $25,000 PDT
  minimum effective 2026-06-04 (Rule 4210 amendment, Notice 26-10; SEC approval
  2026-04-14; broker phase-in allowed until 2027-10-20). That explains the
  missing `DayTradesRemaining` tags on paper. The PDT gate is dropped; account
  reads report the rule status and any legacy tag, and intraday risk is governed
  by Orbit's own guardrails plus the broker's real-time intraday margin checks.
  This supersedes the PDT rows above and the original spec PDT bullet.
- **D56 ATH.** History coverage now requests IBKR's earliest-data timestamp
  (`reqHeadTimeStamp`). When the window reaches it, the window high is a
  verified all-time high; otherwise coverage is `partial` or `unknown` and
  `ath` stays null. The window high is always reported separately.

The diagnostic also gained a pre-connect check: it refuses to run when another
API client holds the Gateway connection (the earlier "client ID 1 in use" and
connect-timeout failures), verifies the session after connect, and always
disconnects.

### Real paper re-run (2026-11-13, port 4002, read-only, temporary DB, exit 0)

| Check | Result |
|---|---|
| Gateway connection | **Pass** on client ID 1; pre-connect check found no competing client |
| Paper identity | **Pass** (unchanged gate) |
| Day-trade rule (D55) | Reported `retired` with the Notice 26-10 reference; legacy day-trade tag absent on paper, consistent with the rule change |
| Quotes (D54) | All four symbols delayed and fresh with `entry_data_eligible: true`; the visible "Delayed" label applies |
| ATH (D56) | IREN 10Y daily: **verified ATH 76.87**, earliest IBKR data 2021-11-17 (matches IREN's 2021 listing). SPY/QQQ/NVDA windows are `partial` with earliest-data dates 1993-01-29 / 1999-03-10 / 1999-01-22 (their listings) and `ath: null`; the window high is reported alongside |
| Option Greeks | **Unavailable** — Gateway reports error 10090 (partial subscription; OPRA data not subscribed). Needs the options market-data subscription, not a code change |
| Positions | 6 holdings; no option positions |
| Executions/commissions | 0 observed; reconnect snapshot path ran with nothing to deduplicate |

### Live-data re-run (2026-11-13 19:17 UTC, after market-data subscription, exit 0)

| Check | Result |
|---|---|
| Quotes | **Live** — all four symbols report `market_data_type: "live"`, fresh, `entry_data_eligible: true`. The subscription and share-to-paper step work end to end |
| ATH (D56) | IREN 10Y daily verified ATH 76.87 again; other windows `partial` as designed |
| Option Greeks | **Verified live** — see the follow-up below. The OPRA entitlement was active all along; Orbit's snapshot path was at fault |
| Identity / connection / day-trade rule | Unchanged passes |

### Option Greeks follow-up (2026-11-13, same session)

A targeted check (NVDA call ~30 days out) proved streaming option data was
already live with full model Greeks, while the snapshot path returned nothing.
Root cause: `get_quote` only requested delayed-frozen (type 4) snapshots,
which options never answer — the request timed out and looked like an
entitlement problem. `get_quote` now falls through data types 4 → 1 → 3
until one returns values (regression test added).

Real-paper evidence after the fix: snapshot and stream agree — NVDA 2026-12-11
165C live bid 10.20 / ask 10.35 / last 10.31, delta 0.5068, gamma 0.0143,
theta −0.2091, vega 0.1800, IV 0.618.


