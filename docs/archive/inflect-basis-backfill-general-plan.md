# Inflect Basis Recovery General Plan

## Goal

Inflect should never invent a short position from incomplete local history. It should recover missing cost basis automatically where IBKR allows, and when IBKR cannot provide enough history, the user should be able to repair the missing basis locally.

This is a general review plan, not the implementation plan. It is meant to be reviewed against healthy product logic and the IBKR API docs before work is split into executable tasks.

## IBKR Facts Checked

- `/iserver/account/trades`
  - Recent executions only.
  - Maximum 7 days.
  - Useful for live/recent fills, not old opening lots.
- `/pa/transactions`
  - Historical transactions by account and conid.
  - One conid per request.
  - Defaults to 90 days when `days` is omitted.
  - Supports a `days` request field, but the official docs do not publish a maximum.
  - Pacing is 1 request per 15 minutes.
- `/portfolio2/{accountId}/positions`
  - Current aggregate position, average cost/price, market value, realized/unrealized P&L.
  - Useful as a sanity check.
  - Not enough to reconstruct historical lots.

References:

- IBKR Web API v1 docs: https://www.interactivebrokers.com/campus/ibkr-api-page/cpapi-v1/
- IBKR pacing docs: https://www.interactivebrokers.com/campus/ibkr-api-page/webapi-doc/

## Core Rules

- A sell that exceeds known local long quantity does not automatically mean the user opened a short.
- The known long portion closes normally.
- The unmatched remainder becomes `Needs basis`.
- Inflect should show `SHORT` only when short exposure is proven by one of:
  - local short lot history,
  - explicit IBKR metadata that marks the fill as opening short,
  - complete imported fill/transaction history showing the short opening.
- Manual repair data is stored locally and keyed by `account_id + conid`, never by ticker string.

## P0: Stop False Shorts

### Backend Matcher

- Change over-sell behavior.
- If local known long quantity is less than a sell quantity:
  - close the known long portion,
  - mark the unmatched remainder as `Needs basis`,
  - do not create an open short.
- **Exception (proven short):** if the flipping sell carries explicit IBKR
  opening-short metadata (`position_effect`/`open_close` = OPEN, `SELL_TO_OPEN`,
  etc.), the remainder is a *proven* short and opens a real SHORT. Metadata is
  the only escape from `Needs basis`.
- Add a BLZE-style regression test.
- Keep true short support for cases where short exposure is proven.

**Status — DONE (2026-06-02, commit pending).** Implemented in
`backend/services/inflect/matcher.py`. The previous behavior silently flipped a
long over-sell into a phantom short; the matcher now routes both a first-seen
flat sell and the over-sell remainder through `_incomplete_basis_trade`, with
commission prorated to the unmatched quantity. The old
`test_flip_long_to_short_splits_into_two_trades` (which asserted the phantom
short) was **inverted** — this was the gate's blocking contradiction: the plan
and the merged code disagreed, and the merged code was wrong.

**Acceptance criteria (P0 matcher):**
- `BUY 100, SELL 150` (no metadata) → exactly one `CLOSED` LONG(100) + one
  `INCOMPLETE_BASIS`/`UNKNOWN`(50); **zero** SHORT. Remainder `gross_pnl` and
  `net_pnl` are `None`; remainder commission = its prorated share.
- First-seen flat `SELL 100` (no metadata) → one `INCOMPLETE_BASIS`(100).
- `BUY 100, SELL 150` **with** `position_effect=OPEN` on the sell → `CLOSED`
  LONG(100) + a real SHORT(50). Metadata path preserved.
- Existing simple long/short/scale round-trips unchanged.
- Covered by `tests/test_inflect_matcher.py`:
  `test_oversell_beyond_known_long_is_needs_basis_not_short`,
  `test_oversell_with_opening_short_metadata_flips_to_proven_short`,
  `test_first_seen_sell_without_opening_baseline_is_incomplete_not_short`.

### UI Status

- Hide raw backend labels such as `UNKNOWN` and `INCOMPLETE_BASIS`.
- Show a clear `Needs basis` badge.
- Add a `Needs attention` filter.
- Trade detail should explain the issue: opening basis is missing and the row cannot be fully classified yet.

### Current Holdings Sanity Check

- Use `/portfolio2/{accountId}/positions` as a validator.
- If the current aggregate position for the conid is long or flat, do not display an unproven open short.
- This is not the source of truth for matching; it is a guard against visibly wrong classification.
- **Pacing — DONE.** `/portfolio2/` is now in `backend/constants/ibkr_pacing.py`
  at a protective `1 req / 5 sec` (the portfolio/account read family), not the
  10/sec global cap. IBKR does not publish a separate limit for this newer
  endpoint, so we lean protective. Agent C must read pacing from there and must
  cache the position result per `(account_id, conid)` so the guard never
  re-polls on every render.

### Parallel Agent Split

- Agent A: matcher behavior and regression tests.
- Agent B: UI status labels, badge, and filter.
- Agent C: current holdings sanity validator.

## P1: Auto `/pa/transactions` Backfill

### Runtime

- Runs in the backend sidecar whenever Orbit is open.
- It does not depend on the Inflect page being visible.
- Inflect UI only displays queue and result status.

### Pacing Ownership (critical)

- `/pa/transactions` is paced `1 req / 15 min` in
  `backend/constants/ibkr_pacing.py` as kind `per_minutes`, which **fails fast**
  — the `paced` decorator raises `IBKRRateLimitError(retry_after=900)` rather
  than blocking the call for 15 minutes. The backfill scheduler therefore
  **cannot lean on the limiter to space requests**; the scheduler itself owns
  the cadence.
- Lean protective: the scheduler dispatches at most one `/pa/transactions` call
  per **16 minutes** (a ~1 minute margin over the 15-minute window) so clock
  skew or a slightly-early tick can never trip a 429. A 429 from IBKR is a
  15-minute IP penalty box — under-polling is always cheaper than recovering
  from one.
- On any `IBKRRateLimitError`, do not retry: set the item to `rate_limited`,
  record `retry_after`, and let the next scheduled tick pick it up. Never busy-
  retry a paced endpoint.
- One global in-flight `/pa/transactions` call at a time across all accounts and
  conids (a single shared scheduler, not per-account schedulers), so two
  accounts cannot collide inside the same window.

### Queue

- Create a local queue item per `(account_id, conid)` that needs basis.
- Queue every `Needs basis` ticker automatically.
- Process at most one item per 16-minute tick (see Pacing Ownership) to respect
  IBKR pacing with protective margin.
- Track queue status:
  - `pending`,
  - `running`,
  - `resolved`,
  - `still_needs_basis`,
  - `failed`,
  - `rate_limited`,
  - `max_days_rejected`.

### IBKR Request Strategy

- First try `/pa/transactions` with `days=365`.
- If IBKR rejects that window, fallback to `days=90`.
- Store the rejection so the UI can warn that long history was unavailable.
- Do not assume 365 days is guaranteed, because the official docs do not publish a maximum.

### Normalization

- Normalize returned buy/sell transactions into local historical transaction rows.
- Mark source as `PA_TRANSACTION`.
- Do not duplicate recent `/iserver/account/trades` fills.
- After import, rerun matching for that `account_id + conid`.
- **Write an audit entry for the auto-backfill** (see Audit Symmetry). Automatic
  recovery changes derived P&L exactly as a manual lot does, so it must be
  recorded with the same before/after detail — not left silent.
- **Re-key affected journal entries** (see Journal-Entry Stability). Recovering
  basis can change a trade's `trade_id`, which would orphan its journal
  annotation; the import step must migrate the journal row to the new id.

### UI Status

- Show per-trade/per-symbol status:
  - `Backfill queued`,
  - `Checking IBKR`,
  - `Last checked`,
  - `Resolved`,
  - `Still needs basis`,
  - `IBKR rejected long history`.
- If still unresolved, show: `Opening lot may predate IBKR history. Add a manual starting lot.`

### Parallel Agent Split

- Agent D: queue schema and sidecar scheduler.
- Agent E: IBKR `/pa/transactions` service and pacing integration.
- Agent F: transaction normalization and matcher integration.
- Agent G: UI queue and status display.

## P2: Manual Starting Lots

### Purpose

Manual starting lots are the fallback when IBKR history cannot recover the opening lot.

### Supported Lots

- Manual long starting lot.
- Manual short starting lot.

### UI Fields

- Side: `Long` or `Short`.
- Quantity.
- Entry date only.
- Entry price.
- Commission optional.
- Note optional.

### Matching Behavior

- The manual lot is inserted into the matcher as a synthetic opening lot at the start of the selected entry date.
- It affects only trades after that entry date.
- Multiple manual lots on the same date use creation order as the tie-breaker.
- Long lots are consumed by sells.
- Short lots are consumed by buys.
- A fully consumed lot becomes archived history.

### Editing

- Manual lots are editable after partial consumption.
- On create/edit/delete, rerun matching for that `account_id + conid`.
- Editing a lot can change resolved trades after that lot's entry date, so the UI should warn before saving.
- Delete requires confirmation because it may return trades to `Needs basis`.

### Audit Trail

- Record every create, edit, and delete.
- Store before/after values for edits.
- Keep enough context to explain why historical matching changed.

### Parallel Agent Split

- Agent H: `basis_lots` schema and API.
- Agent I: matcher support for manual long/short starting lots.
- Agent J: repair UI in trade detail.
- Agent K: audit trail and regression tests.

## P3: Trade Search

### Backend

- Add `/inflect/symbols?account_id&from&to`.
- Return distinct traded `conid + symbol` for the selected period.
- Include symbols from fills, imported PA transactions, and manual basis lots where relevant.

### UI

- Add ticker text search.
- Add period-aware ticker dropdown.
- Add clear filters action.
- Add `Needs attention` filter.

### Identity Rule

- Search can match visible symbol text.
- Filtering and data joins use `conid`.

### Parallel Agent Split

- Agent L: symbols endpoint.
- Agent M: trades table search and dropdown UI.
- Agent N: search/filter tests.

## P4: Storage And Retention

### Storage Dashboard

- Show SQLite DB size.
- Show row counts by table.
- Estimate raw JSON payload storage.

### Cleanup

- Allow deleting old raw payloads before a selected date.
- Never delete active basis lots.
- Never delete data required for open positions.
- Require confirmation before destructive cleanup.
- Prefer an export option before cleanup.

### Parallel Agent Split

- Agent O: storage stats endpoint.
- Agent P: cleanup API.
- Agent Q: storage UI.

## Cross-Cutting Resolutions

These resolve quality-gate blockers that span phases. They are binding on every
agent below, not optional.

### Journal-Entry Stability (blocking)

- A round-trip `trade_id` is `{account_id}:{conid}:{first_open_execution_id}`. A
  `Needs basis` pseudo-trade is keyed on the *sell* execution id; once basis is
  recovered (P1 backfill or P2 manual lot), the same activity becomes a real
  round-trip keyed on the *opening* execution id — so **the `trade_id` changes**.
- `journal_entries` is the one persisted Inflect table and is keyed by
  `trade_id`. Without handling, recovery orphans the user's setup/notes/tags.
- Required: whenever a rerun changes the set of `trade_id`s for an
  `(account_id, conid)`, migrate any journal entry whose old id disappeared onto
  the successor trade that now covers the same opening activity. Define the
  successor rule (e.g. earliest opening execution id among the resulting
  trades). Cover with a regression test: annotate a `Needs basis` row, recover
  basis, assert the annotation survives on the recovered trade.

### Audit Symmetry (blocking)

- Both repair paths change derived P&L: P2 manual lots **and** P1 auto-backfill.
- The audit trail (P2) must cover **both**. Auto-backfill writes an audit entry
  per `(account_id, conid)` it resolves, with before/after trade summaries, the
  source (`PA_TRANSACTION`), and the IBKR window used. No silent history rewrite.

### Single-Owner Surfaces & Serialization (blocking)

- **Matcher** (`backend/services/inflect/matcher.py`) is touched by P0 (Agent A),
  P1 rerun (Agent F), and P2 synthetic lots (Agent I). It is a **single-owner,
  serialized** surface — these changes land sequentially on one branch, never as
  three parallel edits to the same file.
- **DB migrations** — P1 (queue, `PA_TRANSACTION` source), P2 (`basis_lots`,
  audit), and P4 (no new tables but reads all of them) each add schema. Migration
  version numbers are a **single serialized counter**; agents coordinate so two
  migrations never claim the same version.

### Agent Dependency DAG (the "parallel" split is not flat)

The per-phase "Parallel Agent Split" lists are optimistic. Real ordering:

- **P0:** A (matcher) → B (UI labels, depends on A's status/direction contract);
  C (holdings guard) feeds B's display decision. A before B.
- **P1:** D (queue schema) → E (IBKR service) → F (normalize + rerun, depends on
  D, E, **and** P0/A's matcher). G (UI) depends on D's status enum. Serial chain.
- **P2:** H (schema) → I (matcher support, depends on A) → J (UI) → K (audit +
  tests). Serial.
- **P3:** L (`/inflect/symbols`) reads PA-transaction rows (P1/F) **and**
  `basis_lots` (P2/H) — so L depends on P1 and P2 schemas; not parallel to them.
- **P4:** O (storage dashboard) enumerates every table from P1/P2/K — depends on
  all prior schemas.

Freeze the trade `status`/`direction` enum and each new table schema **before**
their UI/consumer agents start.

## Main Risks

- `/pa/transactions` maximum `days` value is undocumented. Mitigated by the
  365→90 fallback and `max_days_rejected` status; lean protective and never
  assume a window is accepted.
- `/pa/transactions` and other `/pa/*` limiters **fail fast** (raise, not block);
  the scheduler owns the 16-minute cadence (see P1 Pacing Ownership). A 429 is a
  15-minute IP penalty box — under-poll deliberately.
- Backfill may still fail for positions opened before the available IBKR history.
  Mitigated by P2 manual starting lots.
- Manual lots **and** auto-backfill can change historical matching after their
  entry date. Mitigated by warn-before-save, audit symmetry, and rerun.
- Recovering basis can change a trade's `trade_id` and orphan its journal entry
  (see Journal-Entry Stability). Must be handled on every rerun.
- Current aggregate holdings help prevent bad display, but they do not prove
  historical lots.
- Auditability matters because both manual and automatic repairs affect derived
  P&L.

## Decisions Already Locked

- False over-sell short classification must stop. **(Done in matcher.)** A short
  is opened only with explicit IBKR opening-short metadata; otherwise the
  over-sell remainder is `Needs basis`.
- Backfill scheduler dispatches at most one `/pa/transactions` call per 16
  minutes (protective margin over the 15-minute limit) and never busy-retries a
  rate-limit error.
- Recovering basis must preserve journal annotations across a `trade_id` change.
- Auto-backfill is audited with the same before/after detail as a manual repair.
- `/pa/transactions` backfill runs automatically for every `Needs basis` ticker.
- Backfill runs whenever Orbit is open.
- Backfill tries `days=365` first, with fallback to `90` if rejected.
- Manual starting lots support both long and short.
- Manual lots use date-only entry.
- Manual lots affect only trades after their entry date.
- Manual lots are editable after partial consumption.
- Trades table needs ticker search, period-aware symbol dropdown, and a `Needs attention` filter.

## Not In Scope Yet

- Full formal spec.
- Detailed implementation plan.
- Execution.
- Flex Web Service integration.
- CSV/import workflow.

