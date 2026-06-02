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
- Add a BLZE-style regression test.
- Keep true short support for cases where short exposure is proven.

### UI Status

- Hide raw backend labels such as `UNKNOWN` and `INCOMPLETE_BASIS`.
- Show a clear `Needs basis` badge.
- Add a `Needs attention` filter.
- Trade detail should explain the issue: opening basis is missing and the row cannot be fully classified yet.

### Current Holdings Sanity Check

- Use `/portfolio2/{accountId}/positions` as a validator.
- If the current aggregate position for the conid is long or flat, do not display an unproven open short.
- This is not the source of truth for matching; it is a guard against visibly wrong classification.

### Parallel Agent Split

- Agent A: matcher behavior and regression tests.
- Agent B: UI status labels, badge, and filter.
- Agent C: current holdings sanity validator.

## P1: Auto `/pa/transactions` Backfill

### Runtime

- Runs in the backend sidecar whenever Orbit is open.
- It does not depend on the Inflect page being visible.
- Inflect UI only displays queue and result status.

### Queue

- Create a local queue item per `(account_id, conid)` that needs basis.
- Queue every `Needs basis` ticker automatically.
- Process at most one item every 15 minutes to respect IBKR pacing.
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

## Main Risks

- `/pa/transactions` maximum `days` value is undocumented.
- Backfill may still fail for positions opened before the available IBKR history.
- Manual lots can change historical matching after their entry date.
- Current aggregate holdings help prevent bad display, but they do not prove historical lots.
- Auditability matters because manual repairs affect derived P&L.

## Decisions Already Locked

- False over-sell short classification must stop.
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

