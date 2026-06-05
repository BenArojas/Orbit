# Inflect Basis Recovery — Implementation Plan

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`)
> syntax. This is the **executable** plan; rationale and decisions live in the
> general plan: [docs/inflect-basis-backfill-general-plan.md](../../inflect-basis-backfill-general-plan.md).

**Goal:** Inflect must never invent a short from incomplete local history; it
recovers missing cost basis automatically via IBKR where allowed, and lets the
user repair it manually where IBKR can't. Plus trade search and storage hygiene.

**Current state (already landed on `feature/inflect-journal`, commit `5f1e0a1`):**

- **P0 matcher — DONE.** `backend/services/inflect/matcher.py` routes a
  first-seen flat sell *and* the over-sell remainder of a long→flat flip to
  `INCOMPLETE_BASIS`/`UNKNOWN` ("Needs basis"). A short opens only with explicit
  IBKR opening-short metadata. Covered by `tests/test_inflect_matcher.py`.
- **`/portfolio2/` pacing — DONE.** Protective `1 req / 5 sec` in
  `backend/constants/ibkr_pacing.py`.

**Remaining:** P0 UI + holdings guard, P1 auto-backfill, P2 manual lots, P3
search, P4 storage.

---

## Guardrails (binding on every task)

1. **Protective classification.** Never surface an unproven short. The matcher's
   metadata-only short rule is locked — do not weaken it.
2. **Protective pacing.** All IBKR calls go through `IBKRService._request(...)`,
   which applies pacing from `constants/ibkr_pacing.py`. `/pa/*` limiters
   **fail fast** (raise `IBKRRateLimitError`, they do *not* block). The backfill
   scheduler owns a **16-minute** cadence (margin over IBKR's 15-min limit), one
   global in-flight `/pa/transactions` call, and **never busy-retries** a rate
   error. A 429 is a 15-minute IP penalty box.
3. **Matcher is single-owner.** `matcher.py` is touched by at most one task at a
   time. P2 should feed the matcher **synthetic fills** rather than edit it (see
   P2). Any unavoidable matcher edit lands on its own commit, tests first.
4. **Migrations are append-only + idempotent.** New tables → `CREATE TABLE IF
   NOT EXISTS` in `DatabaseService._create_tables`. New columns → guarded
   `ALTER TABLE` appended to the `migrations` list in `_migrate`. There is no
   numeric version counter; the pattern is idempotent. Edits to `db.py` land
   sequentially (it is a serialized surface — one task at a time).
5. **Write-lock invariant.** Every DB write dispatches through `_run_write`;
   reads through `_run_read`. Never `asyncio.to_thread` a write directly.
6. **conid is the key.** Queue, lots, audit, and search all key/join on
   `(account_id, conid)`. Symbol text is display/search-only.
7. **Journal stability.** Any rerun that changes the set of `trade_id`s for an
   `(account_id, conid)` must migrate affected `journal_entries` onto the
   successor trade (see P1-F4). Annotations must survive basis recovery.
8. **Audit symmetry.** Both manual repair (P2) *and* auto-backfill (P1) write
   audit rows with before/after summaries.
9. **Tests for everything** (CLAUDE.md Rule 1). Polars not Pandas. Typed
   exceptions only. All data through the sidecar.

---

## Schemas (authoritative — agents implement exactly these)

```sql
-- P1-D: auto-backfill queue (one row per ticker needing basis)
CREATE TABLE IF NOT EXISTS basis_backfill_queue (
    account_id     TEXT NOT NULL,
    conid          INTEGER NOT NULL,
    status         TEXT NOT NULL DEFAULT 'pending',  -- pending|running|resolved|
                                                     -- still_needs_basis|failed|
                                                     -- rate_limited|max_days_rejected
    attempts       INTEGER NOT NULL DEFAULT 0,
    days_used      INTEGER,                           -- 365 or 90 on last attempt
    last_checked_ms INTEGER,
    last_error     TEXT,
    created_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (account_id, conid)
);

-- P2-H: manual starting lots (synthetic opening lots)
CREATE TABLE IF NOT EXISTS basis_lots (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id   TEXT NOT NULL,
    conid        INTEGER NOT NULL,
    side         TEXT NOT NULL,            -- 'LONG' | 'SHORT'
    quantity     REAL NOT NULL,
    entry_date   TEXT NOT NULL,            -- 'YYYY-MM-DD' (date only)
    entry_price  REAL NOT NULL,
    commission   REAL,
    note         TEXT,
    created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_basis_lots_acct_conid ON basis_lots(account_id, conid);

-- P1-F / P2-K: audit trail for every basis change (manual + automatic)
CREATE TABLE IF NOT EXISTS basis_audit (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id  TEXT NOT NULL,
    conid       INTEGER NOT NULL,
    action      TEXT NOT NULL,             -- lot_create|lot_edit|lot_delete|auto_backfill
    source      TEXT,                      -- PA_TRANSACTION|MANUAL
    before_json TEXT,
    after_json  TEXT,
    created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_basis_audit_acct_conid ON basis_audit(account_id, conid);
```

```sql
-- P1-F: tag fills by origin so backfilled rows are distinguishable + cleanable.
-- Append to the _migrate() migrations list (idempotent ALTER):
ALTER TABLE fills ADD COLUMN source TEXT NOT NULL DEFAULT 'IBKR_TRADES';
-- PA-imported rows use source='PA_TRANSACTION'; synthetic manual lots use
-- source='MANUAL_LOT'. Existing rows default to 'IBKR_TRADES'.
```

**Synthetic-fill strategy (keeps the matcher single-owner).** Both PA imports
and manual lots become rows in `fills` that the existing matcher consumes
unchanged:

- A **PA transaction** → a normal fill row, `source='PA_TRANSACTION'`,
  `execution_id = f"PA:{conid}:{trade_time_ms}:{seq}"`.
- A **manual LONG lot** → a BUY fill at `entry_date` 00:00 ET (minus a tiny
  per-creation-order offset), `source='MANUAL_LOT'`, `execution_id=f"LOT:{id}"`.
- A **manual SHORT lot** → a SELL fill carrying `position_effect='OPEN'` so the
  matcher's protective guard treats it as a proven opening short.

This means **P2 needs no matcher edit** — the service synthesizes fills and the
matcher already handles them. If an edge case forces a matcher change, treat it
as the single-owner surface (guardrail 3).

---

## Dependency DAG (drives the parallel waves)

```
P0-B (UI status) ─────────────┐
P0-C (holdings guard) ─────────┤
                               ▼
P1-D (queue schema+sched) ─► P1-F (normalize+rerun+rekey+audit) ─► P1-G (UI)
P1-E (pa_transactions svc) ───┘                                     │
                                                                    ▼
P2-H (basis_lots schema+API) ─► P2-I (synthetic-fill build) ─► P2-J (repair UI)
                                          │                         │
                                          └─► P2-K (audit+tests)    │
                                                                    ▼
P3-L (/inflect/symbols) ──► P3-M (search UI) ──► P3-N (tests)
P4-O (storage stats) ──► P4-P (cleanup API) ──► P4-Q (storage UI)
```

`db.py` is edited by D, F, H (sequential). The matcher is edited by nobody if P2
uses synthetic fills. P3-L depends on F and H schemas. P4 depends on all schemas.

---

## P0 — Stop False Shorts (finish UI + guard)

### P0-B — UI status (frontend)
Files: `src/modules/inflect/TradesTable.tsx`, `TradeDetail.tsx`, `TradesPage.tsx`,
`format.ts`, new `src/modules/inflect/BasisBadge.tsx`; tests under `__tests__/`.

- [ ] **B1.** Map `status==='INCOMPLETE_BASIS'` / `direction==='UNKNOWN'` to a
  `Needs basis` badge. Never render the raw `UNKNOWN`/`INCOMPLETE_BASIS` strings.
- [ ] **B2.** Add a **Needs attention** filter (client-side: `status ===
  'INCOMPLETE_BASIS'`) alongside the existing status tabs in `TradesPage`.
- [ ] **B3.** `TradeDetail` explains it: "Opening basis is missing — this row
  can't be fully classified yet," with a stub link/section for repair (filled by
  P1-G / P2-J).
- [ ] **B4.** Tests: badge renders for an incomplete trade; raw labels never in
  the DOM; Needs-attention filter narrows rows.
- **Acceptance:** No `UNKNOWN`/`INCOMPLETE_BASIS` text in rendered output;
  Needs-basis rows discoverable via the filter; `npm test` + `tsc` green.

### P0-C — Current-holdings guard (backend)
Files: `backend/services/inflect/service.py` (or new
`backend/services/inflect/holdings.py`), `backend/routers/inflect.py`; tests in
`backend/tests/test_inflect_router.py` / a new test.

- [ ] **C1.** Add `current_position(account_id, conid)` that calls
  `ibkr._request("GET", f"/portfolio2/{account_id}/positions")` (pacing is
  automatic) and returns the net signed position for the conid. Cache per
  `(account_id, conid)` in-process; never poll on every render.
- [ ] **C2.** Use it only as a **display guard**: if a derived trade would show
  an open short but the aggregate position is long/flat, suppress the short
  display (with the matcher fix this should already be impossible — this is a
  belt-and-suspenders guard, not the source of truth).
- [ ] **C3.** Typed errors (auth/network/rate-limit) — no bare `except`.
- [ ] **C4.** Tests with a mocked `_request`: long aggregate suppresses a stray
  short; rate-limit error degrades gracefully (guard is skipped, not fatal).
- **Acceptance:** guard never makes its own classification authoritative; pacing
  read uses the `/portfolio2/` limiter; tests green.

---

## P1 — Auto `/pa/transactions` Backfill

### P1-D — Queue schema + scheduler (backend, edits db.py)
Files: `backend/services/db.py` (add `basis_backfill_queue`, CRUD), new
`backend/services/inflect_backfill.py` (`InflectBackfillService`),
`backend/main.py` (lifespan start/stop); tests
`backend/tests/test_inflect_backfill.py`, `test_db_migrations.py`.

- [ ] **D1.** Add `basis_backfill_queue` table + DB methods:
  `enqueue_basis(account_id, conid)`, `claim_next_backfill()` (oldest `pending`
  whose `last_checked_ms` is null or ≥16 min old), `set_backfill_status(...)`,
  `list_backfill_status(account_id)`. Writes via `_run_write`.
- [ ] **D2.** `InflectBackfillService` modeled on `ScannerService`/
  `InflectSyncService`: `start()/stop()/_stop_event`, auth-wait, a loop that
  wakes every 60s but **dispatches at most one `/pa/transactions` per 16 min**
  (single global in-flight). Auto-enqueues every `Needs basis`
  `(account_id, conid)` it discovers from matched trades.
- [ ] **D3.** On `IBKRRateLimitError`: set `rate_limited`, store `retry_after`,
  do not retry until the next eligible tick. Never busy-loop.
- [ ] **D4.** Wire into `main.py` lifespan (start) + shutdown (`await stop()`).
- [ ] **D5.** Tests: enqueue idempotency; `claim_next` respects the 16-min gate;
  rate-limit path sets status without retry; start/stop/auth-wait.
- **Acceptance:** scheduler never issues two `/pa/transactions` within 16 min in
  a simulated clock test; statuses transition correctly; tests green.

### P1-E — `/pa/transactions` service (backend, independent file)
Files: new `backend/services/inflect/pa_transactions.py`; tests
`backend/tests/test_pa_transactions.py`.

- [ ] **E1.** `fetch_transactions(ibkr, account_id, conid, days)` calling
  `ibkr._request("GET", "/pa/transactions", params=...)` (per IBKR: POST/GET per
  their docs — match the existing `_request` usage; one conid per request).
- [ ] **E2.** Strategy: try `days=365`; on a rejection/empty-window signal,
  fall back to `days=90`; surface which window succeeded + a `max_days_rejected`
  flag. Lean protective — assume nothing about the max window.
- [ ] **E3.** Return a typed result (`PaBackfillResult`: rows, days_used,
  rejected_long_history) — no DB writes here (separation from F).
- [ ] **E4.** Typed errors; let `IBKRRateLimitError` propagate to the scheduler.
- [ ] **E5.** Tests with mocked `_request`: 365 success; 365-reject→90 fallback;
  empty result → `still_needs_basis`; rate-limit propagates.
- **Acceptance:** never assumes a window; fallback verified; tests green.

### P1-F — Normalization + rerun + journal re-key + audit (backend, edits db.py)
Files: `backend/services/db.py` (fills `source` column; `basis_audit` table +
writer; journal re-key helper), `backend/services/inflect/service.py`
(normalize + rerun); tests `test_inflect_basis_recovery.py`.

- [ ] **F1.** Migration: `ALTER TABLE fills ADD COLUMN source ... 'IBKR_TRADES'`.
- [ ] **F2.** Normalize PA rows → fill dicts (`source='PA_TRANSACTION'`,
  synthetic `execution_id`), dedupe against existing fills by PK and by a
  content key `(conid, side, qty, price, trade_time_ms)`; upsert via
  `upsert_fills`.
- [ ] **F3.** After import, rerun the matcher for `(account_id, conid)` and
  update the queue status (`resolved` if no `INCOMPLETE_BASIS` remains for that
  conid, else `still_needs_basis`).
- [ ] **F4.** **Journal re-key:** capture `trade_id`s before/after the rerun;
  for any journal entry whose old `trade_id` vanished, migrate it onto the
  successor trade (rule: the resulting trade for that conid with the earliest
  opening execution id covering the same activity). Add
  `rekey_journal_entry(old_id, new_id)` in db.py.
- [ ] **F5.** **Audit:** write a `basis_audit` row (`action='auto_backfill'`,
  `source='PA_TRANSACTION'`, before/after trade summary).
- [ ] **F6.** Tests: dedupe (no double-count vs `/iserver/account/trades`);
  `INCOMPLETE_BASIS` resolves after import; **journal annotation survives the
  trade_id change**; audit row written.
- **Acceptance:** the journal-survival test passes (this is the blocking gate
  item); no duplicate fills; tests green.

### P1-G — Queue/status UI (frontend)
Files: `src/lib/api.ts` (+`inflectBackfillStatus`), `src/hooks/useInflectBackfill.ts`,
`src/modules/inflect/TradeDetail.tsx` + a `BackfillStatus.tsx`; tests.

- [ ] **G1.** Surface per-symbol status: `Backfill queued`, `Checking IBKR`,
  `Last checked`, `Resolved`, `Still needs basis`, `IBKR rejected long history`.
- [ ] **G2.** When still unresolved: "Opening lot may predate IBKR history. Add
  a manual starting lot." (CTA wired by P2-J.)
- [ ] **G3.** Tests: each status renders; polling hook respects an enabled flag.
- **Acceptance:** statuses map 1:1 to backend enum; `npm test`+`tsc` green.

---

## P2 — Manual Starting Lots

### P2-H — `basis_lots` schema + CRUD API (backend, edits db.py)
Files: `backend/services/db.py` (`basis_lots` + CRUD), `backend/models/inflect.py`
(`BasisLot`, `BasisLotUpsertRequest`), `backend/routers/inflect.py`
(`/inflect/basis-lots` GET/POST/PUT/DELETE), `service.py`; tests.

- [ ] **H1.** Table + DB methods `create/list/update/delete_basis_lot`.
- [ ] **H2.** Pydantic models + validation (side ∈ {LONG,SHORT}, qty>0,
  entry_date `YYYY-MM-DD`, entry_price>0, commission optional ≥0).
- [ ] **H3.** Thin router endpoints keyed by `(account_id, conid)`; typed errors.
- [ ] **H4.** Tests: CRUD round-trip; validation rejects bad input.

### P2-I — Synthetic-fill build + rerun (backend; NO matcher edit)
Files: `backend/services/inflect/service.py`; tests
`test_inflect_basis_lots_matching.py`.

- [ ] **I1.** Build synthetic fills from `basis_lots` (LONG→BUY, SHORT→SELL with
  `position_effect='OPEN'`), timestamped at `entry_date` 00:00 ET with a
  per-`created_at` tie-break offset; `source='MANUAL_LOT'`,
  `execution_id=f"LOT:{id}"`. Prepend to the fills list before `match_fills`.
- [ ] **I2.** Lot affects only trades **after** its entry date (timestamp
  ordering gives this for free). Editable after partial consumption (re-derived
  each request — no persisted consumption state).
- [ ] **I3.** On lot create/edit/delete: rerun matcher for `(account_id, conid)`,
  re-key journal entries (reuse F4 helper), and write a `basis_audit` row
  (`action='lot_*'`, `source='MANUAL'`, before/after).
- [ ] **I4.** Tests: a LONG lot lets a previously-`INCOMPLETE_BASIS` sell resolve
  to a CLOSED long; a SHORT lot opens a proven short; deleting a consumed lot
  returns the trade to `Needs basis`; journal survives; audit written.
- **Acceptance:** matcher file untouched; manual-lot resolution + journal
  survival + audit all tested green.

### P2-J — Repair UI (frontend)
Files: `src/lib/api.ts`, `src/hooks/useBasisLots.ts`,
`src/modules/inflect/BasisLotEditor.tsx`, `TradeDetail.tsx`; tests.

- [ ] **J1.** Form (side, qty, entry date only, entry price, optional
  commission/note) in trade detail for a `Needs basis` row.
- [ ] **J2.** Warn-before-save (editing changes resolved history) and
  confirm-before-delete (may return trades to Needs basis).
- [ ] **J3.** On success, invalidate calendar + trades + backfill-status queries.
- [ ] **J4.** Tests: create/edit/delete flows; confirm dialogs; invalidation.

### P2-K — Audit surfacing + regression tests (full-stack)
- [ ] **K1.** `GET /inflect/basis-audit?account_id&conid` + a read-only audit
  view in `TradeDetail`.
- [ ] **K2.** Regression suite covering both repair paths' audit + journal
  survival end-to-end.

---

## P3 — Trade Search

### P3-L — `/inflect/symbols` endpoint (backend; depends on P1-F + P2-H schemas)
Files: `backend/services/inflect/service.py`, `backend/routers/inflect.py`,
`backend/models/inflect.py`; tests.

- [ ] **L1.** `GET /inflect/symbols?account_id&from&to` → distinct
  `{conid, symbol}` traded in the period, unioning `fills` (all sources) and
  `basis_lots`. Joins on conid; symbol is display text.
- [ ] **L2.** Tests: distinctness; period filtering; PA + manual-lot symbols
  included.

### P3-M / P3-N — Search UI + tests (frontend)
Files: `src/modules/inflect/TradesPage.tsx`, new `SymbolSearch.tsx`,
`src/hooks/useInflectSymbols.ts`; tests.

- [ ] **M1.** Ticker text search + period-aware dropdown + clear-filters + the
  Needs-attention filter (from P0-B). Search matches symbol text; filtering
  joins on conid.
- [ ] **N1.** Tests: search narrows by symbol; dropdown reflects the period;
  clear resets.

---

## P4 — Storage & Retention

### P4-O — Storage stats (backend; depends on all schemas)
Files: `backend/services/inflect/storage.py` or `db.py` helper, router; tests.

- [ ] **O1.** `GET /inflect/storage` → SQLite file size, per-table row counts,
  estimated raw-JSON payload bytes (`fills.raw_json` length sum).
- [ ] **O2.** Tests on a temp DB.

### P4-P — Cleanup API (backend)
- [ ] **P1.** `POST /inflect/storage/cleanup` deletes old **raw payloads**
  (`fills.raw_json` before a date) only. **Never** deletes `basis_lots`,
  `basis_audit`, or data backing open positions. Requires explicit confirm flag;
  offer an export-first response.
- [ ] **P2.** Tests: protected rows survive; only `raw_json` cleared; confirm
  required.

### P4-Q — Storage UI (frontend)
- [ ] **Q1.** Dashboard (size, counts, payload estimate) + guarded cleanup with
  confirm + export-first. Tests.

---

## Verification (per wave + final)

- [ ] After each backend task: `cd backend && uv run python -m pytest <files> -q`
  (note: bare `uv run pytest` fails — use `python -m pytest`). `ruff` is not
  installed; skip lint.
- [ ] After each frontend task: `npm test -- <area>` and `npx tsc --noEmit`.
- [ ] Final: full `uv run python -m pytest -q` + `npm test` + `tsc` green.
- [ ] Manual (paper account, needs a live IBKR session): trigger a Needs-basis
  trade, confirm auto-backfill resolves it without a 429, and a manual lot
  repairs a pre-history position; confirm a journal note survives both.

## Definition of done

- All P0–P4 boxes complete; the **journal-survives-rekey** and **no-429-within-
  16-min** tests pass (the two blocking gate items).
- Matcher file unchanged by P1–P4 (synthetic-fill strategy held).
- Audit covers both repair paths; no unproven shorts anywhere in the UI.
- CLAUDE.md Rules 1–7 satisfied; pacing reads only from `ibkr_pacing.py`.
