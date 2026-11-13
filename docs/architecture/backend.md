# Backend Architecture

This is the canonical guide for Orbit's Python sidecar. Code and executable
constants win when this document becomes stale.

## Boundary

- One FastAPI sidecar owns broker and SQLite access.
- React never calls IBKR or SQLite directly.
- Routers translate HTTP requests and typed errors; services own domain logic.
- Public and trust boundaries use Pydantic request/response models.
- `sidecar_security.py` authenticates every mutation, private read, and WebSocket.
  Only health/discovery/docs reads and CORS preflights are public. Rust creates
  a per-launch secret, passes it through private stdin, and never logs it.
- WebSockets carry the credential as an offered subprotocol, never a URL query.
- MCP is not mounted on the sidecar listener. Its separate read-only transport
  and runtime portfolio-sharing controls are gated to redesign Phase 7.
- Errors distinguish authentication, network, rate limit, validation, and data
  failures. Do not add a bare `except Exception`.

## Data and Persistence

- Use Polars for dataframe work. pandas is allowed only through the pandas-ta
  bridge.
- `DatabaseService` owns SQLite access; routers do not issue raw SQL.
- Startup applies forward-only numbered migrations using
  `services/db_migrations.py`. Migration 1 adopts the legacy schema.
  Add a new migration for subsequent changes rather than editing the baseline.
- Before a file-backed database migration, SQLite's backup API captures committed
  WAL data into a mode-0600 file in `<database>.backups/`. A write reservation
  prevents intervening writers. The migration is rehearsed on a temporary copy
  with integrity and foreign-key checks, then applied in one transaction.
  Rehearsal or application failure rolls back the original and stops startup.
- `PRAGMA user_version` records the schema number; `schema_migrations` records UTC
  application times. A database from a newer app version is rejected.
  Restart at the current version does not create another backup.
- Recovery: stop Orbit and all database writers first. Restore a selected backup
  through SQLite's backup API into a **new** database file, verify
  `PRAGMA integrity_check`, and keep the original database and its WAL files
  untouched until recovery is confirmed. Never copy a backup over an open
  database or restore only the main file while leaving an old WAL alongside it.
- The service shares one SQLite connection across worker threads. Every access
  to that connection goes through `_run_read` or `_run_write`, which share one
  lock. Do not call `asyncio.to_thread` on the connection directly.
- `conid` is the instrument key. Display identity is owned by
  `InstrumentIdentityService`; symbol-to-conid lookup remains an IBKR concern.

## IBKR and Execution

- `TwsDataService` adapts product reads to `TwsBrokerAdapter`'s one `ib_async`
  connection. Market/indicator/sector/posture/RS reads, holdings, account reads,
  and options use TWS. `/data` exposes history coverage, contracts, raw holdings,
  day-trade rule status (D55), and the durable execution log.
- `get_product_data` is the transitional data dependency. Legacy test/reuse
  callers can still inject `IBKRService`, but production always selects TWS.
  The adapter never forwards a product request to Client Portal.
- `IBKRService` remains the Client Portal HTTP transport for the one-time
  watchlist import and retained explicit legacy lifecycle controls. Startup no
  longer auto-starts its Gateway or tickle loop. Do not delete it before owner
  parity verification.
- Watchlists and optional alert-driven moves are now local SQLite operations.
  Settings exposes the one-time import. It reads all source lists before
  atomically committing any, preserves row order/headers, refuses incomplete
  source responses or conflicts, and never modifies Client Portal.
- Quotes carry market-data type, UTC receipt time, age, freshness, and
  `entry_data_eligible`. Receipt time is not an exchange trade timestamp.
  Paper entry and place-override routes independently require a fresh live
  bid/ask; missing, future-dated, stale, delayed, or frozen data is refused.
  The existing `/ws` interface is bridged to TWS streams with resubscription.
- TWS history uses regular hours and broker-native daily/weekly bars. Coverage
  reports the requested duration, returned span/count, and ATH as unknown until
  listing coverage is independently verified. RS is explicitly top-30-only.
- Migration 2 adds local watchlists; migration 3 adds executions and commissions.
  Broker events and reconnect `reqExecutions` snapshots upsert by execution ID.
  Commissions can arrive before or after executions. Unmatched records stay
  unmatched; Phase 2 supplies plan ownership and realized-loss calculations.
- Holdings include account/currency/security type and option contract fields.
  Unknown valuations/freshness remain unavailable, never zero-valued estimates.
  The legacy aggregate portfolio refuses missing valuations rather than
  inventing totals. Account performance curves and legacy scans are unavailable.
- `DayTradesRemaining` is exposed as raw broker evidence, not reinterpreted as a
  verified rolling-window count. Its freshness and paper boundary behavior remain
  unverified. No intraday authorization can be inferred from that read response.
- `ClientPortalExecutionAdapter` owns execution/account endpoint paths, verbs,
  and wire quirks for retained legacy callers only. TWS portfolio compatibility
  uses `TwsPortfolioReads`, which exposes no order mutations.
- Pacing constants live in `backend/constants/ibkr_pacing.py`; human guidance
  and cold-start troubleshooting live in `docs/ibkr-pacing.md`.
- Client Portal remains temporarily for data/import migration, but its order
  mutation routes are disabled. Legacy TWS live routes are also disabled.
- TWS mutations require a recognized paper port and exactly one connected
  account matching `DU`, an optional single letter, then digits (for example
  `DU123456` or `DUQ123456`). Orders explicitly name that account.
  The adapter rejects live mode even for an internal caller.
- Rust owns sidecar lifetime; the sidecar owns client ID 1. The webview cannot
  choose a broker client ID. Native stdin shutdown/EOF runs graceful cleanup.
- The approved phased replacement is
  `docs/design/2026-11-12-plan-agent/spec.md`; do not enable live trading early.

## Structure

- `backend/routers/`: HTTP and WebSocket boundaries.
- `backend/services/`: domain behavior and external adapters.
- `backend/models/`: shared Pydantic contracts.
- `backend/exceptions.py`: typed error vocabulary.
- `backend/main.py`: sidecar lifecycle and dependency wiring.

## Commands

```bash
npm run tauri dev
cd backend
uv run python -m pytest tests/<focused-file>.py -q
uv run python ../scripts/check-sidecar-boundary.py
```

Standalone backend launchers are diagnostics only and do not give a webview an
authorized mutation credential. The smoke checker uses temporary data and does
not connect to IBKR or place orders.

Use `docs/testing.md` to decide whether a test is needed. Ruff and mypy are not
current project dependencies; do not claim they passed unless they are added and
actually run.

## Detailed Decisions

- `docs/superpowers/specs/2026-06-06-client-portal-execution-adapter-design.md`
- `docs/superpowers/specs/2026-06-06-instrument-identity-module-design.md`
- `docs/superpowers/specs/2026-06-06-trading-safety-module-design.md`
