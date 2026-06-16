"""
SQLite database service for Orbit.

This is the app's local "memory" — it stores data that IBKR doesn't
store for us and that needs to survive app restarts:

  - Trigger rules (e.g., "alert me when AAPL RSI < 30")
  - Trigger hits (log of when a trigger rule actually fired)
  - Settings (scan interval, default timeframe, etc.)

What we do NOT store locally:
  - Watchlists — managed inside IBKR itself. The app reads them
    live from IBKR's API. No local copy needed.

── Orbit integration ──────────────────────────────────────────────
The `instruments` table is the one piece of the current Parallax-owned
schema that other Orbit modules will read from:

  MoonMarket  → reads instruments to display symbol/name in portfolio
  Inflect     → reads instruments to display symbol/name in journal entries

Both modules use conid as their primary key. Instruments gets populated
lazily here in Parallax whenever we resolve a conid for the first time
(via IBKR search). Other modules are read-only consumers — they never
write to this table.

All database access goes through this module. No other file should
write raw SQL — they call these functions instead.

The database is a single file (currently parallax.db) that lives next to the app.
It's never deleted unless you manually remove it. Closing the app,
restarting your computer — the data stays.
"""

import asyncio
import json
import logging
import sqlite3
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from typing import Any

# Eastern Time — where US equity market sessions are anchored.
# Dedup keys use ET dates so a rule that fires at 23:59 ET and again at
# 00:01 ET rolls over correctly relative to market days, not UTC.
_ET = ZoneInfo("America/New_York")

from config import SQLITE_DB_PATH

log = logging.getLogger("parallax.db")


# ── Market Pulse defaults ──────────────────────────────────────
#
# Default tickers shown in the dashboard's Market Pulse bar.
# Order matches the approved Layout A v2 mockup (SPX-first).
# Kept alongside the other DB defaults so `seed_defaults()` and the
# POST /pulse-config/reset endpoint share one source of truth.
#
# Tuple shape: (label, resolve, sec_type). `sec_type` is an optional
# hint routed through to IBKR's /iserver/secdef/search — the empty
# string means "no hint, default to STK with the fallback chain".
# Non-STK entries must spell it out explicitly:
#   - XAUUSD / XAGUSD are CMDTY metal-spot contracts (OTC).
#   - USD.ILS is a currency pair — IBKR resolves it under STK in the
#     search endpoint despite being a cash product, so no hint needed.
#
# DXY intentionally omitted: IBKR Client Portal Web API does NOT expose
# the ICE Dollar Index (returns {"error": "No symbol found"}). Users
# who want a dollar proxy can add UUP manually.
DEFAULT_PULSE_ITEMS: tuple[tuple[str, str, str], ...] = (
    ("SPX", "SPX", ""),
    ("SPY", "SPY", ""),
    ("QQQ", "QQQ", ""),
    ("DIA", "DIA", ""),
    ("IWM", "IWM", ""),
    ("BTC", "BTC", ""),
    ("ETH", "ETH", ""),
    ("Gold", "XAUUSD", ""),
    ("Silver", "XAGUSD", ""),
    ("USO", "USO", ""),
    ("TLT", "TLT", ""),
    ("USD/ILS", "USD.ILS", ""),
)


class DatabaseService:
    """
    Async-friendly SQLite service.

    SQLite itself is synchronous (it blocks while reading/writing), so we
    run all queries in a thread pool using asyncio.to_thread(). This way
    the rest of the app doesn't freeze while waiting for the database.

    Created once during FastAPI startup, shared across the whole app.
    """

    def __init__(self, db_path: str = SQLITE_DB_PATH) -> None:
        self.db_path = db_path
        self._conn: sqlite3.Connection | None = None
        # Phase 8 hotfix: the service shares one sqlite3.Connection across
        # asyncio.to_thread worker threads (check_same_thread=False). The
        # Python sqlite3 module's connection object is NOT safe for
        # concurrent use — two workers calling .execute() / .commit() on
        # the same connection simultaneously can raise
        # `sqlite3.ProgrammingError: bad parameter or other API misuse`
        # (SQLITE_MISUSE, error code 21). This bit us during sectors
        # cold-start where 11 parallel get_conid() calls fan out to 11
        # parallel upsert_cached_conid() writes. Serialize all writes
        # behind this asyncio.Lock so only one thread touches the shared
        # connection at a time. Reads bypass the lock — SQLite's WAL mode
        # serialises read-vs-write at the file level, and the existing
        # _fetchone / _fetchall paths are short-lived reads.
        self._write_lock = asyncio.Lock()

    # ── Lifecycle ────────────────────────────────────────────

    async def initialize(self) -> None:
        """
        Open the database connection and create tables if they don't exist.
        Called once during app startup (in main.py lifespan).
        """
        self._conn = await asyncio.to_thread(self._connect)
        await asyncio.to_thread(self._create_tables)
        await asyncio.to_thread(self._migrate)
        log.info("SQLite database initialized at %s", self.db_path)

    async def connect(self) -> None:
        """Alias for :meth:`initialize` used by tests and newer call sites."""
        await self.initialize()

    async def fetch_all(self, query: str, params: tuple = ()) -> list[dict]:
        """Run a SELECT and return a list of dict rows."""
        def _do() -> list[dict]:
            assert self._conn is not None
            cur = self._conn.execute(query, params)
            cols = [d[0] for d in cur.description] if cur.description else []
            return [dict(zip(cols, row)) for row in cur.fetchall()]
        return await self._run_read(_do)

    async def execute(self, query: str, params: tuple = ()) -> None:
        """Run a one-off write."""
        def _do() -> None:
            assert self._conn is not None
            with self._conn:
                self._conn.execute(query, params)
        await self._run_write(_do)

    async def close(self) -> None:
        """Close the database connection. Called during app shutdown."""
        if self._conn:
            await asyncio.to_thread(self._conn.close)
            self._conn = None
            log.info("SQLite connection closed.")

    def _connect(self) -> sqlite3.Connection:
        """
        Create a new SQLite connection with useful settings.

        - WAL mode: Allows reading and writing at the same time (faster).
        - Row factory: Lets us access columns by name instead of index.
        - Foreign keys: Enforces relationships between tables.
        """
        conn = sqlite3.connect(self.db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row  # Access columns by name: row["symbol"]
        conn.execute("PRAGMA journal_mode=WAL")  # Better concurrent access
        conn.execute("PRAGMA foreign_keys=ON")  # Enforce table relationships
        return conn

    def _create_tables(self) -> None:
        """
        Create all database tables if they don't already exist.
        This is safe to call every time the app starts — it won't
        destroy existing data.

        Tables:
          1. trigger_rules — Your alert conditions (per individual stock)
          2. trigger_hits  — Log of fired alerts (with deduplication)
          3. settings      — App preferences (key-value pairs)
        """
        assert self._conn is not None

        self._conn.executescript("""
            -- ─── Trigger Rules ─────────────────────────────────────
            -- A rule = a setup definition. It has 1..N conditions
            -- (in trigger_conditions) joined by AND. A rule is scoped
            -- either to an entire watchlist (watchlist_name set, conid NULL)
            -- or to a single stock (conid set, watchlist_name NULL).
            --
            -- When a rule fires, by default the stock is TAG-IN-PLACE:
            -- a row lands in trigger_hits, surfaces on Today, and tag
            -- dots show wherever the stock appears. No IBKR watchlist
            -- mutation. Per rule, the user can opt into ibkr_mirror_target
            -- to also push the stock into a real IBKR watchlist.
            CREATE TABLE IF NOT EXISTS trigger_rules (
                id                    INTEGER PRIMARY KEY AUTOINCREMENT,
                name                  TEXT NOT NULL,
                enabled               INTEGER NOT NULL DEFAULT 1,
                timeframe             TEXT NOT NULL DEFAULT '1D',
                scan_interval_seconds INTEGER NOT NULL DEFAULT 300,
                watchlist_name        TEXT,                       -- NULL = per-stock override
                conid                 INTEGER,                    -- NULL when watchlist-scoped
                symbol                TEXT,                       -- display only; nullable
                template_id           INTEGER REFERENCES rule_templates(id) ON DELETE SET NULL,
                ibkr_mirror_target    TEXT,                       -- opt-in IBKR mirror
                created_at            TEXT DEFAULT (datetime('now')),
                updated_at            TEXT DEFAULT (datetime('now')),
                CHECK (watchlist_name IS NOT NULL OR conid IS NOT NULL)
            );

            -- ─── Trigger Conditions ────────────────────────────────
            -- 1..N rows per rule, ALL must pass on the same bar.
            CREATE TABLE IF NOT EXISTS trigger_conditions (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                rule_id             INTEGER NOT NULL REFERENCES trigger_rules(id) ON DELETE CASCADE,
                order_index         INTEGER NOT NULL DEFAULT 0,
                indicator           TEXT NOT NULL,
                condition           TEXT NOT NULL,
                threshold           REAL,
                news_candle_method  TEXT
            );

            -- ─── Rule Templates ────────────────────────────────────
            -- Curated starter setups + user-saved customs.
            -- conditions_json is a JSON array of {indicator, condition,
            -- threshold, news_candle_method?} objects matching the
            -- trigger_conditions row shape.
            CREATE TABLE IF NOT EXISTS rule_templates (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                name              TEXT NOT NULL,
                description       TEXT,
                category          TEXT NOT NULL,
                is_builtin        INTEGER NOT NULL DEFAULT 0,
                default_timeframe TEXT NOT NULL DEFAULT '1D',
                conditions_json   TEXT NOT NULL,
                created_at        TEXT DEFAULT (datetime('now')),
                UNIQUE(name, is_builtin)
            );

            -- ─── Trigger Hits ──────────────────────────────────────
            -- Log of every fired (rule, conid, bar) tuple, deduped.
            -- condition_values is JSON: each condition's measured value
            -- at fire time so the UI can render "all 3: RSI=28, ema_21@181, vol=1.8x".
            CREATE TABLE IF NOT EXISTS trigger_hits (
                id                 INTEGER PRIMARY KEY AUTOINCREMENT,
                rule_id            INTEGER NOT NULL REFERENCES trigger_rules(id) ON DELETE CASCADE,
                conid              INTEGER NOT NULL,
                symbol             TEXT NOT NULL,
                triggered_at       TEXT DEFAULT (datetime('now')),
                dedup_key          TEXT NOT NULL UNIQUE,
                condition_values   TEXT NOT NULL,                 -- JSON array
                watchlist_name     TEXT,                          -- denormalized for filtering
                dismissed_at       TEXT,
                snoozed_until      TEXT,
                -- IBKR mirror tracking — populated only when rule has ibkr_mirror_target set
                source_watchlist   TEXT,
                target_watchlist   TEXT,
                moved_back         INTEGER NOT NULL DEFAULT 0,
                expires_at         TEXT
            );

            -- ─── Settings ──────────────────────────────────────────
            -- Key-value store for app preferences.
            -- Examples: scan_interval=300, default_timeframe=1D
            CREATE TABLE IF NOT EXISTS settings (
                key         TEXT PRIMARY KEY,
                value       TEXT NOT NULL,
                updated_at  TEXT DEFAULT (datetime('now'))
            );

            -- ─── AI Provider Settings (Orbit v2 cloud shell) ───────
            -- Non-secret provider configuration only. `api_key_ref` is an
            -- opaque OS-keychain reference that will be populated in a later
            -- slice. Plaintext or encrypted key material is never stored here.
            CREATE TABLE IF NOT EXISTS ai_provider_configs (
                provider_name  TEXT PRIMARY KEY,
                display_name   TEXT NOT NULL,
                kind           TEXT NOT NULL,
                enabled        INTEGER NOT NULL DEFAULT 0,
                selected_model TEXT,
                api_key_ref    TEXT,
                routing_role   TEXT NOT NULL DEFAULT 'disabled',
                settings_json  TEXT NOT NULL DEFAULT '{}',
                created_at     TEXT DEFAULT (datetime('now')),
                updated_at     TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS ai_routing_policy (
                id                         INTEGER PRIMARY KEY CHECK (id = 1),
                routing_mode               TEXT NOT NULL DEFAULT 'local_only',
                local_fallback_enabled     INTEGER NOT NULL DEFAULT 1,
                per_call_cost_cap_usd      REAL NOT NULL DEFAULT 1.0,
                monthly_cost_cap_usd       REAL NOT NULL DEFAULT 25.0,
                updated_at                 TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS ai_usage_log (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                provider_name       TEXT NOT NULL,
                model               TEXT,
                task_type           TEXT NOT NULL,
                routing_mode        TEXT NOT NULL,
                input_tokens        INTEGER,
                output_tokens       INTEGER,
                estimated_cost      REAL,
                actual_cost         REAL,
                currency            TEXT NOT NULL DEFAULT 'USD',
                status              TEXT NOT NULL,
                provider_request_id TEXT,
                error_code          TEXT,
                created_at          TEXT DEFAULT (datetime('now'))
            );

            -- ─── Instruments Cache ─────────────────────────────────
            -- Local cache of IBKR's instrument metadata.
            -- Avoids hitting IBKR's search API repeatedly for the same stock.
            --
            -- conid is the primary key — IBKR's unique integer for each security.
            -- This is the UNIVERSAL KEY across the entire Orbit:
            --   Parallax uses conid in trigger_rules, trigger_hits, indicators
            --   MoonMarket will use conid in fills, positions, orders
            --   Inflect will use conid in journal_entries
            --
            -- Populated lazily: when Parallax resolves a conid for the first
            -- time (via /market/search or /market/conid), it writes a row here.
            -- If the row already exists, it updates the timestamp.
            --
            -- Other Orbit modules read from this table but never write to it.
            -- IBKR is the source of truth — this is just a local cache.
            CREATE TABLE IF NOT EXISTS instruments (
                conid          INTEGER PRIMARY KEY,    -- IBKR's unique contract ID
                symbol         TEXT NOT NULL,           -- Ticker (AAPL, SPY, QQQ)
                company_name   TEXT DEFAULT '',         -- Full name ("Apple Inc")
                sec_type       TEXT DEFAULT 'STK',      -- STK, ETF, OPT, FUT, etc.
                cached_at      TEXT DEFAULT (datetime('now'))
            );

            -- ─── MoonMarket Fills ─────────────────────────────────
            -- Local execution/fill store for MoonMarket and future
            -- Inflect journal reads. IBKR remains the source of truth;
            -- this table is an idempotent local projection keyed by
            -- (account_id, execution_id). conid is the Orbit-wide instrument key.
            CREATE TABLE IF NOT EXISTS fills (
                execution_id  TEXT NOT NULL,
                account_id    TEXT NOT NULL,
                conid         INTEGER NOT NULL,
                symbol        TEXT,
                description   TEXT,
                side          TEXT NOT NULL,
                quantity      REAL NOT NULL,
                price         REAL,
                net_amount    REAL,
                commission    REAL,
                sec_type      TEXT,
                trade_time    TEXT NOT NULL,
                trade_time_ms INTEGER,
                source        TEXT NOT NULL DEFAULT 'IBKR_TRADES',
                raw_json      TEXT,
                created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (account_id, execution_id)
            );

            -- ─── Conid Cache (Phase 8 / Task 1.5) ──────────────────
            -- Lookup-direction cache for conid resolution. The
            -- `instruments` table above is a result-direction cache
            -- (PK=conid, used when you have a conid and want metadata).
            -- This table inverts that: PK=(symbol, sec_type), used when
            -- you have a symbol and want the conid.
            --
            -- TTL is forever — IBKR conids are stable across sessions.
            -- Force-refresh is available via IBKRService.get_conid(
            -- force_refresh=True) for the rare case where IBKR re-issues
            -- a conid (e.g. after a corporate action).
            --
            -- `sec_type` is the INPUT secType hint passed to the
            -- resolver (may be empty string for "no hint"). `asset_class`
            -- is the OUTPUT — IBKR's reported secType for the winning
            -- match (STK / IND / CASH / CRYPTO / etc.). They differ when
            -- the user provides no hint and IBKR resolves to a specific
            -- class, e.g. ("BTC", "") → asset_class="CRYPTO".
            --
            -- `resolved_at` is a Unix-epoch integer for cheap "how stale
            -- is this row" checks; comparable across SQLite versions
            -- without timezone juggling.
            CREATE TABLE IF NOT EXISTS conid_cache (
                symbol         TEXT NOT NULL,
                sec_type       TEXT NOT NULL DEFAULT '',
                conid          INTEGER NOT NULL,
                asset_class    TEXT NOT NULL DEFAULT '',
                name           TEXT NOT NULL DEFAULT '',
                resolved_at    INTEGER NOT NULL,
                PRIMARY KEY (symbol, sec_type)
            );

            -- ─── Indexes ───────────────────────────────────────────
            -- Indexes are like a book's table of contents — they help
            -- the database find things faster without reading every row.
            CREATE INDEX IF NOT EXISTS idx_trigger_rules_watchlist
                ON trigger_rules(watchlist_name) WHERE watchlist_name IS NOT NULL;
            CREATE INDEX IF NOT EXISTS idx_trigger_rules_conid
                ON trigger_rules(conid) WHERE conid IS NOT NULL;
            CREATE INDEX IF NOT EXISTS idx_trigger_rules_enabled
                ON trigger_rules(enabled);
            CREATE INDEX IF NOT EXISTS idx_trigger_conditions_rule
                ON trigger_conditions(rule_id);
            CREATE INDEX IF NOT EXISTS idx_trigger_hits_rule
                ON trigger_hits(rule_id);
            CREATE INDEX IF NOT EXISTS idx_trigger_hits_conid
                ON trigger_hits(conid);
            CREATE INDEX IF NOT EXISTS idx_trigger_hits_active
                ON trigger_hits(dismissed_at, snoozed_until);
            CREATE INDEX IF NOT EXISTS idx_trigger_hits_triggered_at
                ON trigger_hits(triggered_at);
            CREATE INDEX IF NOT EXISTS idx_trigger_hits_expires_at
                ON trigger_hits(expires_at);
            CREATE INDEX IF NOT EXISTS idx_rule_templates_builtin
                ON rule_templates(is_builtin, category);

            CREATE INDEX IF NOT EXISTS idx_instruments_symbol
                ON instruments(symbol);
            CREATE INDEX IF NOT EXISTS idx_fills_account_time
                ON fills(account_id, trade_time_ms DESC);
            CREATE INDEX IF NOT EXISTS idx_fills_conid_time
                ON fills(conid, trade_time_ms DESC);

            -- ─── Watchlist Config (Phase 6.8) ──────────────────────
            -- Per-target-watchlist override for auto-expire.
            --
            -- When a rule fires, the stock moves source → target.  If the
            -- target watchlist has a row here, its auto_expire_days wins
            -- over the rule's own auto_expire_days. Rules that target a
            -- watchlist with no config row keep using the per-rule value.
            --
            -- This lets the user say "anything that lands in 'Fast Setups'
            -- expires after 2 days" regardless of which rule put it there.
            CREATE TABLE IF NOT EXISTS watchlist_config (
                name               TEXT PRIMARY KEY,
                auto_expire_days   INTEGER,                 -- NULL = no override (fall back to rule)
                updated_at         TEXT DEFAULT (datetime('now'))
            );

            -- ─── Locked Fibonacci Drawings ─────────────────────────
            -- When the user "locks" a fib drawing, it persists across
            -- app restarts and renders on ALL timeframes (per Ofek's
            -- spec). Unlocked fibs are ephemeral — they live only in
            -- the frontend state and get recomputed on chart load.
            --
            -- conid + timeframe + tool_type + swing pair uniquely
            -- identifies a locked fib. The UNIQUE constraint prevents
            -- accidentally locking the exact same swing twice.
            CREATE TABLE IF NOT EXISTS locked_fibonacci_drawings (
                id                 INTEGER PRIMARY KEY AUTOINCREMENT,
                conid              INTEGER NOT NULL,
                timeframe          TEXT NOT NULL,          -- "1D", "1W", "1M"
                tool_type          TEXT NOT NULL DEFAULT 'retracement', -- "retracement" | "extension"
                swing_high_price   REAL NOT NULL,
                swing_high_time    INTEGER NOT NULL,       -- Unix seconds
                swing_low_price    REAL NOT NULL,
                swing_low_time     INTEGER NOT NULL,       -- Unix seconds
                direction          TEXT NOT NULL,           -- "up" | "down"
                user_note          TEXT,                    -- Optional user annotation
                locked_at          TEXT DEFAULT (datetime('now')),

                UNIQUE(conid, timeframe, tool_type, swing_high_time, swing_low_time)
            );

            CREATE INDEX IF NOT EXISTS idx_locked_fibs_conid
                ON locked_fibonacci_drawings(conid);

            -- ─── Market Pulse Config (Phase 8.9+) ──────────────────
            -- User-configurable ticker list for the dashboard's top
            -- Market Pulse bar. Each row is one ticker; `position`
            -- determines display order (0-indexed, left → right).
            --
            -- `label`   — what shows on the bar (e.g. "USD/ILS")
            -- `resolve` — the string handed to /market/conid to look up
            --             the IBKR conid (forex uses BASE.QUOTE, e.g.
            --             "USD.ILS"). Kept as a ticker string here;
            --             conid resolution happens at query time so a
            --             user's paper-vs-live accounts don't poison
            --             the config.
            CREATE TABLE IF NOT EXISTS pulse_config (
                position    INTEGER PRIMARY KEY,
                label       TEXT NOT NULL,
                resolve     TEXT NOT NULL,
                -- `sec_type` is an optional IBKR secType hint ('', 'STK',
                -- 'IND', 'BOND') routed to /iserver/secdef/search so we
                -- can disambiguate (e.g. GLD as the ARCA ETF, not HKFE
                -- futures). Empty string = no hint; the resolver falls
                -- through its usual STK-then-unfiltered chain.
                sec_type    TEXT NOT NULL DEFAULT '',
                updated_at  TEXT DEFAULT (datetime('now'))
            );

            -- ─── Chart Drawings (drawing-tools-plan.md Branch 1) ───────
            -- Stores user drawing tools per instrument.
            -- anchors_json: JSON list of {time (Unix s), price} objects.
            -- style_json:   JSON dict matching DrawingStyle model (nullable).
            -- kind:         Matches the upstream class name lowercased+underscored
            --               e.g. "horizontal_line", "trend_line", "ray" etc.
            CREATE TABLE IF NOT EXISTS chart_drawings (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                conid        INTEGER NOT NULL,
                kind         TEXT NOT NULL,
                anchors_json TEXT NOT NULL,
                style_json   TEXT,
                created_at   TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at   TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_chart_drawings_conid
                ON chart_drawings(conid);

            -- ─── Inflect Journal Entries ───────────────────────────
            -- Inflect's only owned table. Stores the user's per-trade
            -- annotations (setup label, freeform notes, freeform tags).
            --
            -- Keyed by a stable round-trip `trade_id`
            -- (account_id:conid:first_open_execution_id) so an entry
            -- survives re-derivation of trades from `fills` — Inflect
            -- never persists the round-trip trades themselves, it
            -- recomputes them on demand via the FIFO matcher.
            --
            -- conid is the Orbit-wide instrument key; the index on it
            -- lets the trades list bulk-fetch entries for a set of
            -- conids and join them back by trade_id in memory.
            --
            -- `tags` is a JSON array of freeform tag strings.
            CREATE TABLE IF NOT EXISTS journal_entries (
                trade_id     TEXT PRIMARY KEY,
                account_id   TEXT NOT NULL,
                conid        INTEGER NOT NULL,
                setup        TEXT,
                notes        TEXT,
                tags         TEXT,
                created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_journal_conid
                ON journal_entries(conid);

            -- ─── Inflect Basis Backfill Queue ─────────────────────
            -- One queue row per (account_id, conid) that the matcher marked
            -- as Needs basis. The scheduler owns pacing for /pa/transactions.
            CREATE TABLE IF NOT EXISTS basis_backfill_queue (
                account_id      TEXT NOT NULL,
                conid           INTEGER NOT NULL,
                status          TEXT NOT NULL DEFAULT 'pending',
                attempts        INTEGER NOT NULL DEFAULT 0,
                days_used       INTEGER,
                last_checked_ms INTEGER,
                last_error      TEXT,
                created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (account_id, conid)
            );

            CREATE INDEX IF NOT EXISTS idx_basis_backfill_status
                ON basis_backfill_queue(status, last_checked_ms, created_at);

            -- ─── Inflect Manual Basis Lots ────────────────────────
            -- User-entered starting lots for positions whose opening basis
            -- predates recoverable IBKR history. P2-I converts these rows to
            -- synthetic matcher fills; this table is CRUD-only in P2-H.
            CREATE TABLE IF NOT EXISTS basis_lots (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id   TEXT NOT NULL,
                conid        INTEGER NOT NULL,
                side         TEXT NOT NULL,
                quantity     REAL NOT NULL,
                entry_date   TEXT NOT NULL,
                entry_price  REAL NOT NULL,
                commission   REAL,
                note         TEXT,
                created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_basis_lots_acct_conid
                ON basis_lots(account_id, conid);

            -- ─── Inflect Basis Audit ──────────────────────────────
            -- Audit symmetry for automatic PA recovery and manual basis repair.
            CREATE TABLE IF NOT EXISTS basis_audit (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id  TEXT NOT NULL,
                conid       INTEGER NOT NULL,
                action      TEXT NOT NULL,
                source      TEXT,
                before_json TEXT,
                after_json  TEXT,
                created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_basis_audit_acct_conid
                ON basis_audit(account_id, conid);
        """)
        self._conn.commit()
        log.info("Database tables verified/created.")

    def _migrate(self) -> None:
        """
        Safe incremental migrations for existing databases.

        Each ALTER TABLE here is guarded by a try/except so it's safe to run
        on every startup — it's a no-op if the column already exists.
        SQLite doesn't support IF NOT EXISTS on ALTER TABLE, so we catch the
        OperationalError that fires when you try to add a duplicate column.
        """
        assert self._conn is not None
        migrations = [
            # Phase 8.9 / Commit D: sec_type hint for pulse items
            "ALTER TABLE pulse_config ADD COLUMN sec_type TEXT NOT NULL DEFAULT ''",
            # Inflect P1-F: distinguish IBKR recent fills from PA/manual basis rows.
            "ALTER TABLE fills ADD COLUMN source TEXT NOT NULL DEFAULT 'IBKR_TRADES'",
        ]
        for sql in migrations:
            try:
                self._conn.execute(sql)
                self._conn.commit()
                log.info("Migration applied: %s", sql)
            except sqlite3.OperationalError:
                pass  # column already exists — safe to skip

        self._migrate_fills_account_execution_pk()

        # Legacy pulse defaults briefly used BTC.USD / ETH.USD, but IBKR's
        # secdef search resolves the crypto spot contracts under BTC / ETH.
        # Normalise those persisted defaults in place so existing users stop
        # carrying forward a broken config after upgrading.
        self._conn.execute(
            "UPDATE pulse_config SET resolve = 'BTC' "
            "WHERE label = 'BTC' AND resolve = 'BTC.USD' AND sec_type = ''"
        )
        self._conn.execute(
            "UPDATE pulse_config SET resolve = 'ETH' "
            "WHERE label = 'ETH' AND resolve = 'ETH.USD' AND sec_type = ''"
        )
        self._conn.commit()

    def _migrate_fills_account_execution_pk(self) -> None:
        """Rebuild legacy fills tables keyed only by execution_id.

        SQLite cannot alter a primary key in place. Existing rows keep their
        account_id, so the rebuild preserves current local history while making
        duplicate execution ids safe across accounts.
        """
        assert self._conn is not None
        columns = self._conn.execute("PRAGMA table_info(fills)").fetchall()
        execution_pk = next(
            (int(row["pk"]) for row in columns if row["name"] == "execution_id"),
            0,
        )
        account_pk = next(
            (int(row["pk"]) for row in columns if row["name"] == "account_id"),
            0,
        )
        if execution_pk != 1 or account_pk != 0:
            return

        self._conn.executescript("""
            ALTER TABLE fills RENAME TO fills_legacy_single_execution_pk;

            CREATE TABLE fills (
                execution_id  TEXT NOT NULL,
                account_id    TEXT NOT NULL,
                conid         INTEGER NOT NULL,
                symbol        TEXT,
                description   TEXT,
                side          TEXT NOT NULL,
                quantity      REAL NOT NULL,
                price         REAL,
                net_amount    REAL,
                commission    REAL,
                sec_type      TEXT,
                trade_time    TEXT NOT NULL,
                trade_time_ms INTEGER,
                source        TEXT NOT NULL DEFAULT 'IBKR_TRADES',
                raw_json      TEXT,
                created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (account_id, execution_id)
            );

            INSERT OR REPLACE INTO fills (
                execution_id, account_id, conid, symbol, description, side,
                quantity, price, net_amount, commission, sec_type, trade_time,
                trade_time_ms, source, raw_json, created_at, updated_at
            )
            SELECT
                execution_id, account_id, conid, symbol, description, side,
                quantity, price, net_amount, commission, sec_type, trade_time,
                trade_time_ms, source, raw_json, created_at, updated_at
            FROM fills_legacy_single_execution_pk;

            DROP TABLE fills_legacy_single_execution_pk;

            CREATE INDEX IF NOT EXISTS idx_fills_account_time
                ON fills(account_id, trade_time_ms DESC);
            CREATE INDEX IF NOT EXISTS idx_fills_conid_time
                ON fills(conid, trade_time_ms DESC);
        """)
        self._conn.commit()
        log.info("Migration applied: fills primary key is now (account_id, execution_id)")

    # ── Internal helpers ─────────────────────────────────────

    def _execute(self, sql: str, params: tuple = ()) -> sqlite3.Cursor:
        """Run a single SQL statement. Used internally."""
        assert self._conn is not None
        return self._conn.execute(sql, params)

    def _fetchone(self, sql: str, params: tuple = ()) -> dict | None:
        """Run a query and return one row as a dictionary, or None."""
        cursor = self._execute(sql, params)
        row = cursor.fetchone()
        return dict(row) if row else None

    def _fetchall(self, sql: str, params: tuple = ()) -> list[dict]:
        """Run a query and return all rows as a list of dictionaries."""
        cursor = self._execute(sql, params)
        return [dict(row) for row in cursor.fetchall()]

    async def _run_write(self, fn):
        """Serialise a synchronous SQLite write through the global write
        lock and dispatch it to the asyncio thread pool.

        Phase 8 hotfix: Python's `sqlite3.Connection` is not safe for
        concurrent use from multiple threads, even with
        `check_same_thread=False`. Two `asyncio.to_thread` workers
        hitting the same connection's cursor simultaneously can raise
        SQLITE_MISUSE ('bad parameter or other API misuse') or
        'cannot start a transaction within a transaction'. All write
        helpers in this class now go through this helper so the
        connection is touched by at most one worker at a time.

        Reads also go through this same lock — earlier we let them
        bypass for "read concurrency" but in practice the dashboard
        cold-start fires ~14 parallel `get_cached_conid` calls which
        was the source of intermittent SQLITE_MISUSE errors (observed
        for the /market/conid/USO route). SQLite reads on the shared
        connection are microsecond-fast, so the lost concurrency is
        negligible.
        """
        async with self._write_lock:
            return await asyncio.to_thread(fn)

    async def _run_read(self, fn):
        """Serialise a synchronous SQLite read through the same lock as
        writes. See _run_write for the rationale — concurrent reads on
        the same Connection object corrupt cursor state."""
        async with self._write_lock:
            return await asyncio.to_thread(fn)

    # ── MoonMarket Fills ─────────────────────────────────────

    async def upsert_fills(self, rows: list[dict[str, Any]]) -> int:
        """Insert or update normalized MoonMarket fills by execution id."""
        accepted = [row for row in rows if self._valid_fill_row(row)]

        def _do() -> int:
            assert self._conn is not None
            with self._conn:
                for row in accepted:
                    self._conn.execute(
                        """
                        INSERT INTO fills (
                            execution_id, account_id, conid, symbol, description,
                            side, quantity, price, net_amount, commission, sec_type,
                            trade_time, trade_time_ms, source, raw_json
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(account_id, execution_id) DO UPDATE SET
                            conid = excluded.conid,
                            symbol = excluded.symbol,
                            description = excluded.description,
                            side = excluded.side,
                            quantity = excluded.quantity,
                            price = excluded.price,
                            net_amount = excluded.net_amount,
                            commission = excluded.commission,
                            sec_type = excluded.sec_type,
                            trade_time = excluded.trade_time,
                            trade_time_ms = excluded.trade_time_ms,
                            source = excluded.source,
                            raw_json = excluded.raw_json,
                            updated_at = CURRENT_TIMESTAMP
                        """,
                        (
                            row["execution_id"],
                            row["account_id"],
                            int(row["conid"]),
                            row.get("symbol"),
                            row.get("description"),
                            row["side"],
                            float(row["quantity"]),
                            row.get("price"),
                            row.get("net_amount"),
                            row.get("commission"),
                            row.get("sec_type"),
                            row["trade_time"],
                            row.get("trade_time_ms"),
                            row.get("source") or "IBKR_TRADES",
                            self._encode_raw_json(row.get("raw_json")),
                        ),
                    )
            return len(accepted)

        return await self._run_write(_do)

    async def list_fills(self, account_id: str, days: int = 7) -> list[dict[str, Any]]:
        """Return recent fills for an account, newest first."""
        bounded_days = max(1, min(int(days), 7))
        cutoff_ms = int((datetime.now(timezone.utc) - timedelta(days=bounded_days)).timestamp() * 1000)

        def _do() -> list[dict[str, Any]]:
            assert self._conn is not None
            cur = self._conn.execute(
                """
                SELECT *
                FROM fills
                WHERE account_id = ?
                  AND (trade_time_ms IS NULL OR trade_time_ms >= ?)
                ORDER BY trade_time_ms DESC, trade_time DESC
                """,
                (account_id, cutoff_ms),
            )
            cols = [d[0] for d in cur.description]
            return [dict(zip(cols, row)) for row in cur.fetchall()]

        return await self._run_read(_do)

    async def list_fills_for_account_range(
        self, account_id: str, start_ms: int, end_ms: int
    ) -> list[dict[str, Any]]:
        """Return an account's fills within [start_ms, end_ms], oldest first.

        This is the FIFO matcher's only input. Order is chronological
        (ascending trade_time_ms) because the matcher walks fills forward
        maintaining a signed lot queue. Fills with NULL trade_time_ms are
        excluded — the matcher cannot place them on the timeline, and the
        upsert path always populates trade_time_ms for IBKR executions.

        Reads bypass the write lock (see _run_read).
        """
        def _do() -> list[dict[str, Any]]:
            assert self._conn is not None
            cur = self._conn.execute(
                """
                SELECT *
                FROM fills
                WHERE account_id = ?
                  AND trade_time_ms IS NOT NULL
                  AND trade_time_ms >= ?
                  AND trade_time_ms <= ?
                ORDER BY trade_time_ms ASC, trade_time ASC
                """,
                (account_id, int(start_ms), int(end_ms)),
            )
            cols = [d[0] for d in cur.description]
            return [dict(zip(cols, row)) for row in cur.fetchall()]

        return await self._run_read(_do)

    @staticmethod
    def _valid_fill_row(row: dict[str, Any]) -> bool:
        required = ("execution_id", "account_id", "conid", "side", "quantity", "trade_time")
        return all(row.get(key) not in (None, "") for key in required)

    @staticmethod
    def _encode_raw_json(value: Any) -> str | None:
        if value is None:
            return None
        if isinstance(value, str):
            return value
        return json.dumps(value, sort_keys=True)

    # ── Inflect Basis Backfill Queue ─────────────────────────

    async def enqueue_basis(self, account_id: str, conid: int) -> None:
        """Create an idempotent basis-backfill queue row for account + conid."""
        def _do() -> None:
            assert self._conn is not None
            with self._conn:
                self._conn.execute(
                    """
                    INSERT OR IGNORE INTO basis_backfill_queue
                        (account_id, conid, status)
                    VALUES (?, ?, 'pending')
                    """,
                    (account_id, int(conid)),
                )

        await self._run_write(_do)

    async def claim_next_backfill(self, now_ms: int | None = None) -> dict | None:
        """Claim the oldest eligible pending backfill item.

        Eligibility is intentionally conservative: only pending rows whose
        last check is absent or at least 16 minutes old can be claimed.
        """
        now = now_ms if now_ms is not None else int(
            datetime.now(timezone.utc).timestamp() * 1000
        )
        cutoff_ms = int(now) - (16 * 60 * 1000)

        def _do() -> dict | None:
            assert self._conn is not None
            with self._conn:
                row = self._conn.execute(
                    """
                    SELECT account_id, conid
                    FROM basis_backfill_queue
                    WHERE status = 'pending'
                      AND (last_checked_ms IS NULL OR last_checked_ms <= ?)
                    ORDER BY created_at ASC, account_id ASC, conid ASC
                    LIMIT 1
                    """,
                    (cutoff_ms,),
                ).fetchone()
                if row is None:
                    return None

                self._conn.execute(
                    """
                    UPDATE basis_backfill_queue
                    SET status = 'running',
                        attempts = attempts + 1,
                        last_checked_ms = ?,
                        last_error = NULL,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE account_id = ? AND conid = ?
                    """,
                    (int(now), row["account_id"], int(row["conid"])),
                )
                claimed = self._conn.execute(
                    """
                    SELECT *
                    FROM basis_backfill_queue
                    WHERE account_id = ? AND conid = ?
                    """,
                    (row["account_id"], int(row["conid"])),
                ).fetchone()
                return dict(claimed) if claimed else None

        return await self._run_write(_do)

    async def set_backfill_status(
        self,
        account_id: str,
        conid: int,
        *,
        status: str,
        days_used: int | None = None,
        last_checked_ms: int | None = None,
        last_error: str | None = None,
    ) -> None:
        """Update one backfill queue row's status fields."""
        def _do() -> None:
            assert self._conn is not None
            with self._conn:
                self._conn.execute(
                    """
                    UPDATE basis_backfill_queue
                    SET status = ?,
                        days_used = ?,
                        last_checked_ms = COALESCE(?, last_checked_ms),
                        last_error = ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE account_id = ? AND conid = ?
                    """,
                    (
                        status,
                        days_used,
                        last_checked_ms,
                        last_error,
                        account_id,
                        int(conid),
                    ),
                )

        await self._run_write(_do)

    async def insert_basis_audit(
        self,
        *,
        account_id: str,
        conid: int,
        action: str,
        source: str | None,
        before_json: str | None,
        after_json: str | None,
    ) -> None:
        """Append one basis recovery/repair audit row."""
        def _do() -> None:
            assert self._conn is not None
            with self._conn:
                self._conn.execute(
                    """
                    INSERT INTO basis_audit
                        (account_id, conid, action, source, before_json, after_json)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (account_id, int(conid), action, source, before_json, after_json),
                )

        await self._run_write(_do)

    async def list_backfill_status(self, account_id: str) -> list[dict[str, Any]]:
        """Return basis-backfill queue rows for one account."""
        def _do() -> list[dict[str, Any]]:
            assert self._conn is not None
            cur = self._conn.execute(
                """
                SELECT *
                FROM basis_backfill_queue
                WHERE account_id = ?
                ORDER BY created_at ASC, conid ASC
                """,
                (account_id,),
            )
            cols = [d[0] for d in cur.description]
            return [dict(zip(cols, row)) for row in cur.fetchall()]

        return await self._run_read(_do)

    # ── Inflect Manual Basis Lots ────────────────────────────

    async def create_basis_lot(
        self,
        *,
        account_id: str,
        conid: int,
        side: str,
        quantity: float,
        entry_date: str,
        entry_price: float,
        commission: float | None,
        note: str | None,
    ) -> dict[str, Any]:
        """Insert one manual starting lot and return the stored row."""
        def _do() -> dict[str, Any]:
            assert self._conn is not None
            with self._conn:
                cur = self._conn.execute(
                    """
                    INSERT INTO basis_lots (
                        account_id, conid, side, quantity, entry_date,
                        entry_price, commission, note
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        account_id,
                        int(conid),
                        side,
                        float(quantity),
                        entry_date,
                        float(entry_price),
                        commission,
                        note,
                    ),
                )
                row = self._conn.execute(
                    "SELECT * FROM basis_lots WHERE id = ?",
                    (cur.lastrowid,),
                ).fetchone()
                assert row is not None
                return dict(row)

        return await self._run_write(_do)

    async def list_basis_lots(
        self, account_id: str, conid: int
    ) -> list[dict[str, Any]]:
        """Return manual starting lots for one account + conid."""
        def _do() -> list[dict[str, Any]]:
            assert self._conn is not None
            cur = self._conn.execute(
                """
                SELECT *
                FROM basis_lots
                WHERE account_id = ? AND conid = ?
                ORDER BY entry_date ASC, created_at ASC, id ASC
                """,
                (account_id, int(conid)),
            )
            cols = [d[0] for d in cur.description]
            return [dict(zip(cols, row)) for row in cur.fetchall()]

        return await self._run_read(_do)

    async def update_basis_lot(
        self,
        *,
        lot_id: int,
        account_id: str,
        conid: int,
        side: str,
        quantity: float,
        entry_date: str,
        entry_price: float,
        commission: float | None,
        note: str | None,
    ) -> dict[str, Any] | None:
        """Replace one manual starting lot for the owning account."""
        def _do() -> dict[str, Any] | None:
            assert self._conn is not None
            with self._conn:
                self._conn.execute(
                    """
                    UPDATE basis_lots
                    SET conid = ?,
                        side = ?,
                        quantity = ?,
                        entry_date = ?,
                        entry_price = ?,
                        commission = ?,
                        note = ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ? AND account_id = ?
                    """,
                    (
                        int(conid),
                        side,
                        float(quantity),
                        entry_date,
                        float(entry_price),
                        commission,
                        note,
                        int(lot_id),
                        account_id,
                    ),
                )
                row = self._conn.execute(
                    """
                    SELECT *
                    FROM basis_lots
                    WHERE id = ? AND account_id = ?
                    """,
                    (int(lot_id), account_id),
                ).fetchone()
                return dict(row) if row else None

        return await self._run_write(_do)

    async def delete_basis_lot(self, lot_id: int, account_id: str) -> bool:
        """Delete one manual starting lot for the owning account."""
        def _do() -> bool:
            assert self._conn is not None
            with self._conn:
                cur = self._conn.execute(
                    """
                    DELETE FROM basis_lots
                    WHERE id = ? AND account_id = ?
                    """,
                    (int(lot_id), account_id),
                )
                return cur.rowcount > 0

        return await self._run_write(_do)

    # ── Inflect Journal Entries ──────────────────────────────
    #
    # Inflect's only owned table. Round-trip trades are derived on demand
    # from `fills`; these rows are the durable per-trade annotations the
    # user writes. Keyed by the stable round-trip trade_id so an entry
    # survives re-derivation. Writes serialise through the write lock;
    # reads decode the `tags` JSON column into a list of strings.

    async def upsert_journal_entry(
        self,
        *,
        trade_id: str,
        account_id: str,
        conid: int,
        setup: str | None,
        notes: str | None,
        tags: list[str] | None,
    ) -> None:
        """Insert or update a journal entry, keyed by stable trade_id.

        `tags` is stored as a JSON array string. Passing None or an empty
        list clears the stored tags. created_at is preserved on update;
        updated_at is always refreshed.
        """
        tags_json = json.dumps(list(tags)) if tags else None

        def _upsert() -> None:
            assert self._conn is not None
            with self._conn:
                self._conn.execute(
                    """
                    INSERT INTO journal_entries
                        (trade_id, account_id, conid, setup, notes, tags, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(trade_id) DO UPDATE SET
                        account_id = excluded.account_id,
                        conid = excluded.conid,
                        setup = excluded.setup,
                        notes = excluded.notes,
                        tags = excluded.tags,
                        updated_at = CURRENT_TIMESTAMP
                    """,
                    (trade_id, account_id, int(conid), setup, notes, tags_json),
                )

        await self._run_write(_upsert)

    async def get_journal_entry(self, trade_id: str) -> dict | None:
        """Return one journal entry by trade_id, or None. Tags decoded to a list."""
        def _do() -> dict | None:
            row = self._fetchone(
                "SELECT * FROM journal_entries WHERE trade_id = ?",
                (trade_id,),
            )
            if row is None:
                return None
            row["tags"] = self._decode_tags(row.get("tags"))
            return row

        return await self._run_read(_do)

    async def rekey_journal_entry(self, old_trade_id: str, new_trade_id: str) -> None:
        """Move one journal annotation to a successor derived trade id."""
        if old_trade_id == new_trade_id:
            return

        def _do() -> None:
            assert self._conn is not None
            with self._conn:
                existing = self._conn.execute(
                    "SELECT * FROM journal_entries WHERE trade_id = ?",
                    (old_trade_id,),
                ).fetchone()
                if existing is None:
                    return

                conflict = self._conn.execute(
                    "SELECT trade_id FROM journal_entries WHERE trade_id = ?",
                    (new_trade_id,),
                ).fetchone()
                if conflict is not None:
                    self._conn.execute(
                        """
                        UPDATE journal_entries
                        SET account_id = ?,
                            conid = ?,
                            setup = ?,
                            notes = ?,
                            tags = ?,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE trade_id = ?
                        """,
                        (
                            existing["account_id"],
                            int(existing["conid"]),
                            existing["setup"],
                            existing["notes"],
                            existing["tags"],
                            new_trade_id,
                        ),
                    )
                    self._conn.execute(
                        "DELETE FROM journal_entries WHERE trade_id = ?",
                        (old_trade_id,),
                    )
                    return

                self._conn.execute(
                    """
                    UPDATE journal_entries
                    SET trade_id = ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE trade_id = ?
                    """,
                    (new_trade_id, old_trade_id),
                )

        await self._run_write(_do)

    async def get_journal_entries_for_conids(
        self, conids: list[int], account_id: str | None = None
    ) -> list[dict]:
        """Bulk-fetch journal entries for a set of conids (indexed lookup).

        The trades list joins these back to trades by trade_id + account_id
        in memory. Passing account_id prevents annotations from another
        account leaking onto same-conid trades.
        Returns [] for an empty input. Tags decoded to a list.
        """
        if not conids:
            return []

        def _do() -> list[dict]:
            placeholders = ",".join("?" for _ in conids)
            params: list[Any] = [int(c) for c in conids]
            account_clause = ""
            if account_id is not None:
                account_clause = " AND account_id = ?"
                params.append(account_id)
            rows = self._fetchall(
                f"""
                SELECT *
                FROM journal_entries
                WHERE conid IN ({placeholders}){account_clause}
                """,
                tuple(params),
            )
            for r in rows:
                r["tags"] = self._decode_tags(r.get("tags"))
            return rows

        return await self._run_read(_do)

    @staticmethod
    def _decode_tags(value: Any) -> list[str]:
        """Decode the stored tags JSON column into a list of strings.

        Never raises — a corrupt or non-list payload degrades to []
        rather than breaking the trades query.
        """
        if not value:
            return []
        try:
            data = json.loads(value)
        except (ValueError, TypeError):
            return []
        if not isinstance(data, list):
            return []
        return [str(t) for t in data]

    # ── Trigger Rules ─────────────────────────────────────

    async def get_trigger_rules(self, enabled_only: bool = False) -> list[dict]:
        def _do():
            assert self._conn is not None
            q = "SELECT * FROM trigger_rules"
            if enabled_only:
                q += " WHERE enabled=1"
            q += " ORDER BY id DESC"
            cur = self._conn.execute(q)
            cols = [d[0] for d in cur.description]
            rules = [dict(zip(cols, row)) for row in cur.fetchall()]
            for r in rules:
                r["conditions"] = self._read_conditions(r["id"])
            return rules
        return await self._run_read(_do)

    async def get_trigger_rule(self, rule_id: int) -> dict | None:
        def _do():
            assert self._conn is not None
            cur = self._conn.execute("SELECT * FROM trigger_rules WHERE id=?", (rule_id,))
            cols = [d[0] for d in cur.description]
            row = cur.fetchone()
            if not row:
                return None
            rule = dict(zip(cols, row))
            rule["conditions"] = self._read_conditions(rule_id)
            return rule
        return await self._run_read(_do)

    def _read_conditions(self, rule_id: int) -> list[dict]:
        """Synchronous helper — caller must hold the read or write lock."""
        assert self._conn is not None
        cur = self._conn.execute(
            "SELECT indicator, condition, threshold, news_candle_method "
            "FROM trigger_conditions WHERE rule_id=? ORDER BY order_index",
            (rule_id,),
        )
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]

    async def get_trigger_rules_for_watchlist(self, watchlist_name: str) -> list[dict]:
        def _do():
            assert self._conn is not None
            cur = self._conn.execute(
                "SELECT * FROM trigger_rules WHERE watchlist_name=? AND enabled=1",
                (watchlist_name,),
            )
            cols = [d[0] for d in cur.description]
            rules = [dict(zip(cols, row)) for row in cur.fetchall()]
            for r in rules:
                r["conditions"] = self._read_conditions(r["id"])
            return rules
        return await self._run_read(_do)

    async def create_trigger_rule(
        self,
        *,
        name: str,
        watchlist_name: str | None,
        conid: int | None,
        symbol: str | None,
        template_id: int | None,
        ibkr_mirror_target: str | None,
        timeframe: str,
        scan_interval_seconds: int,
        enabled: bool,
        conditions: list[dict],
    ) -> int:
        def _do():
            assert self._conn is not None
            with self._conn:
                cur = self._conn.execute(
                    """INSERT INTO trigger_rules
                       (name, watchlist_name, conid, symbol, template_id,
                        ibkr_mirror_target, timeframe, scan_interval_seconds, enabled)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (name, watchlist_name, conid, symbol, template_id,
                     ibkr_mirror_target, timeframe, scan_interval_seconds, int(enabled)),
                )
                rule_id = cur.lastrowid
                for idx, c in enumerate(conditions):
                    self._conn.execute(
                        """INSERT INTO trigger_conditions
                           (rule_id, order_index, indicator, condition, threshold, news_candle_method)
                           VALUES (?, ?, ?, ?, ?, ?)""",
                        (rule_id, idx, c["indicator"], c["condition"],
                         c.get("threshold"), c.get("news_candle_method")),
                    )
                return rule_id
        return await self._run_write(_do)

    async def update_trigger_rule(self, rule_id: int, **fields) -> bool:
        """Partial update. If `conditions` is provided, replace all conditions atomically."""
        ALLOWED = {
            "name", "enabled", "timeframe", "scan_interval_seconds",
            "watchlist_name", "conid", "symbol", "template_id",
            "ibkr_mirror_target",
        }
        unknown = set(fields) - ALLOWED - {"conditions"}
        if unknown:
            raise ValueError(f"unknown update fields: {sorted(unknown)}")
        conditions = fields.pop("conditions", None)
        if not fields and conditions is None:
            return False
        def _do():
            assert self._conn is not None
            with self._conn:
                if fields:
                    set_clause = ", ".join(f"{k}=?" for k in fields)
                    self._conn.execute(
                        f"UPDATE trigger_rules SET {set_clause}, updated_at=datetime('now') WHERE id=?",
                        (*fields.values(), rule_id),
                    )
                if conditions is not None:
                    if not conditions:
                        raise ValueError("rule must have at least one condition")
                    self._conn.execute("DELETE FROM trigger_conditions WHERE rule_id=?", (rule_id,))
                    for idx, c in enumerate(conditions):
                        self._conn.execute(
                            """INSERT INTO trigger_conditions
                               (rule_id, order_index, indicator, condition, threshold, news_candle_method)
                               VALUES (?, ?, ?, ?, ?, ?)""",
                            (rule_id, idx, c["indicator"], c["condition"],
                             c.get("threshold"), c.get("news_candle_method")),
                        )
                cur = self._conn.execute("SELECT 1 FROM trigger_rules WHERE id=?", (rule_id,))
                return cur.fetchone() is not None
        return await self._run_write(_do)

    async def delete_trigger_rule(self, rule_id: int) -> bool:
        def _do():
            assert self._conn is not None
            with self._conn:
                cur = self._conn.execute("DELETE FROM trigger_rules WHERE id=?", (rule_id,))
                return cur.rowcount > 0
        return await self._run_write(_do)

    # ── Trigger Hits ──────────────────────────────────────

    async def record_trigger_hit(
        self,
        *,
        rule_id: int,
        conid: int,
        symbol: str,
        dedup_key: str,
        condition_values: list[dict],
        watchlist_name: str | None,
        source_watchlist: str | None = None,
        target_watchlist: str | None = None,
        expires_at: str | None = None,
    ) -> int | None:
        """Insert a hit. Returns hit id, or None if dedup_key already existed."""
        import json as _json
        def _do():
            assert self._conn is not None
            with self._conn:
                try:
                    cur = self._conn.execute(
                        """INSERT INTO trigger_hits
                           (rule_id, conid, symbol, dedup_key, condition_values,
                            watchlist_name, source_watchlist, target_watchlist, expires_at)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        (rule_id, conid, symbol, dedup_key, _json.dumps(condition_values),
                         watchlist_name, source_watchlist, target_watchlist, expires_at),
                    )
                    return cur.lastrowid
                except sqlite3.IntegrityError:
                    # UNIQUE(dedup_key) — already fired today for this rule+conid+interval
                    return None
        return await self._run_write(_do)

    async def get_trigger_hits(
        self,
        limit: int = 200,
        status: str = "active",
        watchlist: str | None = None,
    ) -> list[dict]:
        """status: active | dismissed | snoozed | all."""
        import json as _json
        def _do():
            assert self._conn is not None
            clauses: list[str] = []
            params: list = []
            if status == "active":
                clauses.append("dismissed_at IS NULL")
                clauses.append("(snoozed_until IS NULL OR snoozed_until < datetime('now'))")
            elif status == "dismissed":
                clauses.append("dismissed_at IS NOT NULL")
            elif status == "snoozed":
                clauses.append("snoozed_until IS NOT NULL AND snoozed_until >= datetime('now')")
            # status == "all": no clauses
            if watchlist:
                clauses.append("h.watchlist_name=?")
                params.append(watchlist)
            where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
            q = f"""
                SELECT h.*, r.name AS rule_name
                FROM trigger_hits h
                LEFT JOIN trigger_rules r ON r.id = h.rule_id
                {where}
                ORDER BY h.triggered_at DESC, h.id DESC
                LIMIT ?
            """
            cur = self._conn.execute(q, (*params, limit))
            cols = [d[0] for d in cur.description]
            rows = [dict(zip(cols, row)) for row in cur.fetchall()]
            for r in rows:
                r["condition_values"] = _json.loads(r["condition_values"])
            return rows
        return await self._run_read(_do)

    async def dismiss_trigger_hit(self, hit_id: int) -> bool:
        def _do():
            assert self._conn is not None
            with self._conn:
                cur = self._conn.execute(
                    "UPDATE trigger_hits SET dismissed_at=datetime('now') WHERE id=?",
                    (hit_id,),
                )
                return cur.rowcount > 0
        return await self._run_write(_do)

    async def snooze_trigger_hit(self, hit_id: int, minutes: int) -> bool:
        def _do():
            assert self._conn is not None
            with self._conn:
                cur = self._conn.execute(
                    "UPDATE trigger_hits "
                    "SET snoozed_until=datetime('now', ? || ' minutes') WHERE id=?",
                    (f"+{minutes}", hit_id),
                )
                return cur.rowcount > 0
        return await self._run_write(_do)

    async def get_expired_hits(self) -> list[dict]:
        """
        Return trigger_hits with expires_at in the past that haven't been
        moved back yet. Used by the scanner's IBKR-mirror return pass to
        auto-revert symbols out of their target watchlist when their
        auto-expire window elapses.

        Only hits that opted into IBKR mirror (rule has ibkr_mirror_target
        set, populated source/target_watchlist on the hit) reach this path —
        tag-only hits leave expires_at NULL and never appear here.
        """
        import json as _json

        def _do():
            assert self._conn is not None
            cur = self._conn.execute(
                """
                SELECT h.*, r.name AS rule_name, r.ibkr_mirror_target
                FROM trigger_hits h
                LEFT JOIN trigger_rules r ON r.id = h.rule_id
                WHERE h.expires_at IS NOT NULL
                  AND h.expires_at <= datetime('now')
                  AND h.moved_back = 0
                ORDER BY h.expires_at ASC
                """,
            )
            cols = [d[0] for d in cur.description]
            rows = [dict(zip(cols, row)) for row in cur.fetchall()]
            for r in rows:
                r["condition_values"] = _json.loads(r["condition_values"])
            return rows

        return await self._run_read(_do)

    async def mark_moved_back(self, hit_id: int) -> bool:
        """Flip moved_back=1 on a hit once the IBKR return-move completes."""
        def _do():
            assert self._conn is not None
            with self._conn:
                cur = self._conn.execute(
                    "UPDATE trigger_hits SET moved_back = 1 WHERE id = ?",
                    (hit_id,),
                )
                return cur.rowcount > 0

        return await self._run_write(_do)

    async def get_active_tags(self, conids: list[int]) -> dict[int, list[dict]]:
        """Return {conid: [{rule_id, rule_name, indicators[], fired_at}]} for active hits."""
        import json as _json
        if not conids:
            return {}
        def _do():
            assert self._conn is not None
            placeholders = ",".join("?" * len(conids))
            cur = self._conn.execute(
                f"""SELECT h.conid, h.rule_id, r.name AS rule_name,
                           h.condition_values, h.triggered_at
                    FROM trigger_hits h
                    LEFT JOIN trigger_rules r ON r.id = h.rule_id
                    WHERE h.conid IN ({placeholders})
                      AND h.dismissed_at IS NULL
                      AND (h.snoozed_until IS NULL OR h.snoozed_until < datetime('now'))
                    ORDER BY h.triggered_at DESC""",
                tuple(conids),
            )
            cols = [d[0] for d in cur.description]
            out: dict[int, list[dict]] = {c: [] for c in conids}
            for row in cur.fetchall():
                r = dict(zip(cols, row))
                indicators = [v["indicator"] for v in _json.loads(r["condition_values"])]
                out[r["conid"]].append({
                    "rule_id": r["rule_id"],
                    "rule_name": r["rule_name"],
                    "indicators": indicators,
                    "fired_at": r["triggered_at"],
                })
            return out
        return await self._run_read(_do)

    # ── Rule Templates ────────────────────────────────────

    async def list_rule_templates(self) -> list[dict]:
        import json as _json
        def _do():
            assert self._conn is not None
            cur = self._conn.execute(
                "SELECT * FROM rule_templates ORDER BY is_builtin DESC, category, name"
            )
            cols = [d[0] for d in cur.description]
            rows = [dict(zip(cols, row)) for row in cur.fetchall()]
            for r in rows:
                r["conditions"] = _json.loads(r["conditions_json"])
                r["is_builtin"] = bool(r["is_builtin"])
                del r["conditions_json"]
            return rows
        return await self._run_read(_do)

    async def create_rule_template(
        self, *, name: str, description: str | None, category: str,
        default_timeframe: str, conditions: list[dict],
    ) -> int:
        import json as _json
        def _do():
            assert self._conn is not None
            with self._conn:
                cur = self._conn.execute(
                    """INSERT INTO rule_templates
                       (name, description, category, is_builtin, default_timeframe, conditions_json)
                       VALUES (?, ?, ?, 0, ?, ?)""",
                    (name, description, category, default_timeframe, _json.dumps(conditions)),
                )
                return cur.lastrowid
        return await self._run_write(_do)

    async def delete_rule_template(self, template_id: int) -> bool:
        """Builtins (is_builtin=1) are protected — deletion no-ops."""
        def _do():
            assert self._conn is not None
            with self._conn:
                cur = self._conn.execute(
                    "DELETE FROM rule_templates WHERE id=? AND is_builtin=0",
                    (template_id,),
                )
                return cur.rowcount > 0
        return await self._run_write(_do)

    # ── Settings Operations ──────────────────────────────────

    async def get_setting(self, key: str, default: str | None = None) -> str | None:
        """
        Get a single setting value by key.
        Returns the default if the key doesn't exist.
        """
        row = await self._run_read(
            lambda: self._fetchone(
                "SELECT value FROM settings WHERE key = ?",
                (key,),
            )
        )
        return row["value"] if row else default

    async def get_all_settings(self) -> dict[str, str]:
        """Get all settings as a key→value dictionary."""
        rows = await asyncio.to_thread(
            self._fetchall, "SELECT key, value FROM settings"
        )
        return {row["key"]: row["value"] for row in rows}

    async def set_setting(self, key: str, value: str) -> None:
        """
        Save a setting. If the key already exists, update it.
        Uses SQLite's "upsert" — insert if new, update if exists.
        """
        def _upsert() -> None:
            self._execute(
                """INSERT INTO settings (key, value, updated_at)
                   VALUES (?, ?, datetime('now'))
                   ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')""",
                (key, value, value),
            )
            assert self._conn is not None
            self._conn.commit()

        await self._run_write(_upsert)

    async def delete_setting(self, key: str) -> bool:
        """Delete a setting. Returns True if it existed."""
        def _delete() -> bool:
            cursor = self._execute(
                "DELETE FROM settings WHERE key = ?", (key,)
            )
            assert self._conn is not None
            self._conn.commit()
            return cursor.rowcount > 0

        return await self._run_write(_delete)

    # ── AI Provider Settings ─────────────────────────────────

    _AI_PROVIDER_DEFAULTS: tuple[dict[str, Any], ...] = (
        {
            "provider_name": "ollama",
            "display_name": "Ollama",
            "kind": "local",
            "enabled": 1,
            "selected_model": None,
            "api_key_ref": None,
            "routing_role": "default",
            "settings_json": "{}",
        },
        {
            "provider_name": "openrouter",
            "display_name": "OpenRouter",
            "kind": "cloud",
            "enabled": 0,
            "selected_model": None,
            "api_key_ref": None,
            "routing_role": "disabled",
            "settings_json": "{}",
        },
        {
            "provider_name": "openai",
            "display_name": "OpenAI",
            "kind": "cloud",
            "enabled": 0,
            "selected_model": None,
            "api_key_ref": None,
            "routing_role": "disabled",
            "settings_json": "{}",
        },
        {
            "provider_name": "anthropic",
            "display_name": "Anthropic",
            "kind": "cloud",
            "enabled": 0,
            "selected_model": None,
            "api_key_ref": None,
            "routing_role": "disabled",
            "settings_json": "{}",
        },
        {
            "provider_name": "gemini",
            "display_name": "Gemini",
            "kind": "cloud",
            "enabled": 0,
            "selected_model": None,
            "api_key_ref": None,
            "routing_role": "disabled",
            "settings_json": "{}",
        },
        {
            "provider_name": "grok",
            "display_name": "Grok",
            "kind": "cloud",
            "enabled": 0,
            "selected_model": None,
            "api_key_ref": None,
            "routing_role": "disabled",
            "settings_json": "{}",
        },
    )

    async def ensure_ai_settings_defaults(self) -> None:
        """Seed non-secret AI provider config and routing policy defaults."""
        def _do() -> None:
            assert self._conn is not None
            with self._conn:
                for provider in self._AI_PROVIDER_DEFAULTS:
                    self._conn.execute(
                        """INSERT INTO ai_provider_configs (
                               provider_name, display_name, kind, enabled,
                               selected_model, api_key_ref, routing_role,
                               settings_json, created_at, updated_at
                           )
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
                           ON CONFLICT(provider_name) DO NOTHING""",
                        (
                            provider["provider_name"],
                            provider["display_name"],
                            provider["kind"],
                            provider["enabled"],
                            provider["selected_model"],
                            provider["api_key_ref"],
                            provider["routing_role"],
                            provider["settings_json"],
                        ),
                    )
                self._conn.execute(
                    """INSERT INTO ai_routing_policy (
                           id, routing_mode, local_fallback_enabled,
                           per_call_cost_cap_usd, monthly_cost_cap_usd, updated_at
                       )
                       VALUES (1, 'local_only', 1, 1.0, 25.0, datetime('now'))
                       ON CONFLICT(id) DO NOTHING"""
                )

        await self._run_write(_do)

    async def list_ai_provider_configs(self) -> list[dict[str, Any]]:
        """Return AI provider configuration rows in UI display order."""
        await self.ensure_ai_settings_defaults()

        rows = await self._run_read(
            lambda: self._fetchall(
                """SELECT provider_name, display_name, kind, enabled,
                          selected_model, api_key_ref, routing_role, settings_json
                   FROM ai_provider_configs
                   ORDER BY CASE provider_name
                     WHEN 'ollama' THEN 0
                     WHEN 'openrouter' THEN 1
                     WHEN 'openai' THEN 2
                     WHEN 'anthropic' THEN 3
                     WHEN 'gemini' THEN 4
                     WHEN 'grok' THEN 5
                     ELSE 99
                   END"""
            )
        )
        return [
            {
                **row,
                "enabled": bool(row["enabled"]),
                "settings": json.loads(row["settings_json"] or "{}"),
            }
            for row in rows
        ]

    async def get_ai_routing_policy(self) -> dict[str, Any]:
        """Return the singleton AI routing policy row."""
        await self.ensure_ai_settings_defaults()
        row = await self._run_read(
            lambda: self._fetchone(
                """SELECT routing_mode, local_fallback_enabled,
                          per_call_cost_cap_usd, monthly_cost_cap_usd
                   FROM ai_routing_policy
                   WHERE id = 1"""
            )
        )
        assert row is not None
        return {
            "routing_mode": row["routing_mode"],
            "local_fallback_enabled": bool(row["local_fallback_enabled"]),
            "per_call_cost_cap_usd": float(row["per_call_cost_cap_usd"]),
            "monthly_cost_cap_usd": float(row["monthly_cost_cap_usd"]),
        }

    async def update_ai_routing_policy(
        self,
        *,
        routing_mode: str,
        local_fallback_enabled: bool,
        per_call_cost_cap_usd: float,
        monthly_cost_cap_usd: float,
    ) -> dict[str, Any]:
        """Persist non-secret AI routing and cost-cap settings."""
        await self.ensure_ai_settings_defaults()

        def _do() -> None:
            assert self._conn is not None
            with self._conn:
                self._conn.execute(
                    """UPDATE ai_routing_policy
                       SET routing_mode = ?,
                           local_fallback_enabled = ?,
                           per_call_cost_cap_usd = ?,
                           monthly_cost_cap_usd = ?,
                           updated_at = datetime('now')
                       WHERE id = 1""",
                    (
                        routing_mode,
                        1 if local_fallback_enabled else 0,
                        per_call_cost_cap_usd,
                        monthly_cost_cap_usd,
                    ),
                )

        await self._run_write(_do)
        return await self.get_ai_routing_policy()

    async def update_ai_provider_key_ref(
        self,
        *,
        provider_name: str,
        api_key_ref: str | None,
        enabled: bool,
    ) -> dict[str, Any]:
        """Persist only a provider's opaque key reference and enabled flag."""
        await self.ensure_ai_settings_defaults()

        def _do() -> None:
            assert self._conn is not None
            with self._conn:
                self._conn.execute(
                    """UPDATE ai_provider_configs
                       SET api_key_ref = ?,
                           enabled = ?,
                           routing_role = ?,
                           updated_at = datetime('now')
                       WHERE provider_name = ?""",
                    (
                        api_key_ref,
                        1 if enabled else 0,
                        "manual" if enabled else "disabled",
                        provider_name,
                    ),
                )

        await self._run_write(_do)
        providers = await self.list_ai_provider_configs()
        return next(
            provider for provider in providers
            if provider["provider_name"] == provider_name
        )

    async def insert_ai_usage_log(
        self,
        *,
        provider_name: str,
        model: str | None,
        task_type: str,
        routing_mode: str,
        input_tokens: int | None,
        output_tokens: int | None,
        estimated_cost: float | None,
        actual_cost: float | None,
        status: str,
        provider_request_id: str | None,
        error_code: str | None,
    ) -> dict[str, Any]:
        """Insert one AI usage row and return it."""
        def _do() -> dict[str, Any]:
            assert self._conn is not None
            with self._conn:
                cur = self._conn.execute(
                    """INSERT INTO ai_usage_log (
                           provider_name, model, task_type, routing_mode,
                           input_tokens, output_tokens, estimated_cost,
                           actual_cost, status, provider_request_id, error_code
                       )
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        provider_name,
                        model,
                        task_type,
                        routing_mode,
                        input_tokens,
                        output_tokens,
                        estimated_cost,
                        actual_cost,
                        status,
                        provider_request_id,
                        error_code,
                    ),
                )
                row = self._conn.execute(
                    """SELECT id, provider_name, model, task_type, routing_mode,
                              input_tokens, output_tokens, estimated_cost,
                              actual_cost, currency, status, provider_request_id,
                              error_code, created_at
                       FROM ai_usage_log
                       WHERE id = ?""",
                    (cur.lastrowid,),
                ).fetchone()
                assert row is not None
                return dict(row)

        return await self._run_write(_do)

    async def list_ai_usage_log(self, *, limit: int = 50) -> list[dict[str, Any]]:
        """Return recent AI usage rows newest-first."""
        return await self._run_read(
            lambda: self._fetchall(
                """SELECT id, provider_name, model, task_type, routing_mode,
                          input_tokens, output_tokens, estimated_cost,
                          actual_cost, currency, status, provider_request_id,
                          error_code, created_at
                   FROM ai_usage_log
                   ORDER BY id DESC
                   LIMIT ?""",
                (limit,),
            )
        )

    async def get_ai_usage_monthly_totals(self) -> dict[str, float]:
        """Return current-month estimated and actual AI spend totals."""
        row = await self._run_read(
            lambda: self._fetchone(
                """SELECT
                          COALESCE(SUM(estimated_cost), 0) AS estimated_total,
                          COALESCE(SUM(actual_cost), 0) AS actual_total
                   FROM ai_usage_log
                   WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')"""
            )
        )
        assert row is not None
        return {
            "monthly_estimated_cost_usd": float(row["estimated_total"]),
            "monthly_actual_cost_usd": float(row["actual_total"]),
        }

    async def get_ai_usage_monthly_effective_spend(self) -> float:
        """Return cost-cap spend: actual cost when present, else estimate."""
        row = await self._run_read(
            lambda: self._fetchone(
                """SELECT
                          COALESCE(SUM(COALESCE(actual_cost, estimated_cost, 0)), 0)
                              AS effective_total
                   FROM ai_usage_log
                   WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
                     AND status != 'blocked'"""
            )
        )
        assert row is not None
        return float(row["effective_total"])

    # ── Fibonacci Config (Branch 3) ─────────────────────────────
    #
    # User-editable fib scoring weights live in the generic `settings`
    # table under key="fib_weights" as a JSON blob. We keep the
    # JSON-serialization concern inside these helpers so callers can
    # work with plain dicts.

    _FIB_WEIGHTS_SETTING_KEY = "fib_weights"

    async def get_fib_weights(
        self, defaults: dict[str, float]
    ) -> dict[str, float]:
        """
        Return the persisted Fibonacci scoring weights, or `defaults` if
        no row has been stored yet (or the stored JSON is corrupt).

        On any parse error this falls back to defaults rather than
        raising — the scorer must never blow up because settings are
        malformed; the user can re-save valid weights to recover.
        """
        import json as _json

        raw = await self.get_setting(self._FIB_WEIGHTS_SETTING_KEY)
        if raw is None:
            return dict(defaults)
        try:
            data = _json.loads(raw)
        except (ValueError, TypeError):
            log.warning(
                "fib_weights setting is corrupt JSON — falling back to defaults"
            )
            return dict(defaults)
        if not isinstance(data, dict):
            log.warning(
                "fib_weights setting is not a JSON object — falling back to defaults"
            )
            return dict(defaults)
        # Coerce values to float, drop unknown keys, keep defaults for
        # any missing factor name so the result is always complete.
        out: dict[str, float] = dict(defaults)
        for k, v in data.items():
            if k not in defaults:
                continue
            try:
                out[k] = float(v)
            except (TypeError, ValueError):
                continue
        return out

    async def set_fib_weights(self, weights: dict[str, float]) -> None:
        """
        Persist the Fibonacci scoring weights as JSON.

        This is a low-level write — validation (range, sum, factor
        names) happens in the router/service layer before reaching here.
        """
        import json as _json

        payload = _json.dumps(weights, sort_keys=True)
        await self.set_setting(self._FIB_WEIGHTS_SETTING_KEY, payload)

    # ── Watchlist Config Operations (Phase 6.8) ─────────────────

    async def get_all_watchlist_configs(self) -> list[dict]:
        """Return every configured watchlist (name + override days)."""
        return await asyncio.to_thread(
            self._fetchall,
            "SELECT name, auto_expire_days, updated_at FROM watchlist_config ORDER BY name",
        )

    async def get_watchlist_config(self, name: str) -> dict | None:
        """Look up a single watchlist's config row. None if not configured."""
        return await asyncio.to_thread(
            self._fetchone,
            "SELECT name, auto_expire_days, updated_at FROM watchlist_config WHERE name = ?",
            (name,),
        )

    async def upsert_watchlist_config(
        self, name: str, auto_expire_days: int | None
    ) -> None:
        """
        Create or update the override for a target watchlist.

        auto_expire_days=None is meaningful here: it stores an explicit
        "no auto-expire for this watchlist" override that wins over the
        per-rule value. To remove the override entirely, call
        delete_watchlist_config().
        """
        def _upsert() -> None:
            self._execute(
                """INSERT INTO watchlist_config (name, auto_expire_days, updated_at)
                   VALUES (?, ?, datetime('now'))
                   ON CONFLICT(name) DO UPDATE SET
                       auto_expire_days = excluded.auto_expire_days,
                       updated_at = datetime('now')""",
                (name, auto_expire_days),
            )
            assert self._conn is not None
            self._conn.commit()

        await self._run_write(_upsert)

    async def delete_watchlist_config(self, name: str) -> bool:
        """
        Remove a watchlist's override. Rules that target this watchlist
        will fall back to their own auto_expire_days after this.
        """
        def _delete() -> bool:
            cursor = self._execute(
                "DELETE FROM watchlist_config WHERE name = ?", (name,)
            )
            assert self._conn is not None
            self._conn.commit()
            return cursor.rowcount > 0

        return await self._run_write(_delete)

    # ── Instrument Cache Operations ────────────────────────────
    #
    # Orbit integration: This is the ONLY table that other Orbit modules
    # (MoonMarket, Inflect) will read from. Parallax is the sole writer.
    # The market router auto-populates this on every search/conid resolution.

    async def get_instrument(self, conid: int) -> dict | None:
        """
        Look up a cached instrument by conid.
        Returns None if we haven't resolved this conid yet.
        """
        return await asyncio.to_thread(
            self._fetchone,
            "SELECT * FROM instruments WHERE conid = ?",
            (conid,),
        )

    async def get_instruments_by_conids(self, conids: list[int]) -> list[dict]:
        """
        Bulk lookup — get cached instruments for a list of conids.
        Only returns rows that exist in cache (doesn't hit IBKR).
        """
        if not conids:
            return []
        placeholders = ",".join("?" for _ in conids)
        return await asyncio.to_thread(
            self._fetchall,
            f"SELECT * FROM instruments WHERE conid IN ({placeholders})",
            tuple(conids),
        )

    async def upsert_instrument(
        self,
        conid: int,
        symbol: str,
        company_name: str = "",
        sec_type: str = "STK",
    ) -> None:
        """
        Cache an instrument. If it already exists, refresh the timestamp.
        Called automatically by the market router when resolving conids.

        This is the ONLY write path — other Orbit modules don't call this.
        """
        def _upsert() -> None:
            self._execute(
                """INSERT INTO instruments (conid, symbol, company_name, sec_type, cached_at)
                   VALUES (?, ?, ?, ?, datetime('now'))
                   ON CONFLICT(conid) DO UPDATE SET
                       symbol = ?,
                       company_name = ?,
                       sec_type = ?,
                       cached_at = datetime('now')""",
                (conid, symbol, company_name, sec_type,
                 symbol, company_name, sec_type),
            )
            assert self._conn is not None
            self._conn.commit()

        await self._run_write(_upsert)

    async def search_instruments_local(self, query: str) -> list[dict]:
        """
        Search the local cache by symbol or company name.
        Useful for quick typeahead before hitting IBKR's slower search API.
        """
        pattern = f"%{query}%"
        return await asyncio.to_thread(
            self._fetchall,
            """SELECT * FROM instruments
               WHERE symbol LIKE ? OR company_name LIKE ?
               ORDER BY symbol LIMIT 20""",
            (pattern, pattern),
        )

    # ── Conid Cache CRUD (Phase 8 / Task 1.5) ─────────────────
    # Lookup-direction cache: (symbol, sec_type) → conid. Conid mappings
    # are stable across IBKR sessions, so the TTL is effectively forever.
    # IBKRService.get_conid() reads here first; on miss, hits IBKR and
    # writes via upsert_cached_conid. force_refresh bypasses the read.

    async def get_cached_conid(
        self, symbol: str, sec_type: str = ""
    ) -> dict | None:
        """Look up a previously-resolved conid by (symbol, sec_type).

        Returns the row as a dict (`conid`, `asset_class`, `name`,
        `resolved_at`) or None on miss. Both lookup keys are uppercased
        on the way in so the cache is case-insensitive on symbol but
        preserves the exact stored sec_type hint string.
        """
        return await self._run_read(
            lambda: self._fetchone(
                "SELECT * FROM conid_cache WHERE symbol = ? AND sec_type = ?",
                (symbol.upper(), sec_type.upper()),
            )
        )

    async def upsert_cached_conid(
        self,
        symbol: str,
        sec_type: str,
        conid: int,
        asset_class: str = "",
        name: str = "",
    ) -> None:
        """Cache a resolved conid keyed by (symbol, sec_type).

        Idempotent: if the same (symbol, sec_type) is resolved again
        (e.g. force_refresh), the existing row is updated in place and
        `resolved_at` is bumped to now. Conids are stable across IBKR
        sessions, so under normal use the conid value never changes —
        only the timestamp does.
        Concurrency: serialised behind `self._write_lock` (via
        `_run_write`) so 11 parallel sectors get_conid() calls don't
        trip SQLITE_MISUSE on the shared connection. See `__init__`
        for the full rationale.
        """
        def _upsert() -> None:
            now = int(datetime.now(timezone.utc).timestamp())
            self._execute(
                """INSERT INTO conid_cache
                       (symbol, sec_type, conid, asset_class, name, resolved_at)
                   VALUES (?, ?, ?, ?, ?, ?)
                   ON CONFLICT(symbol, sec_type) DO UPDATE SET
                       conid = excluded.conid,
                       asset_class = excluded.asset_class,
                       name = excluded.name,
                       resolved_at = excluded.resolved_at""",
                (symbol.upper(), sec_type.upper(), conid, asset_class, name, now),
            )
            assert self._conn is not None
            self._conn.commit()

        await self._run_write(_upsert)

    # ── Locked Fibonacci CRUD ─────────────────────────────────

    async def save_locked_fib(
        self,
        conid: int,
        timeframe: str,
        tool_type: str,
        swing_high_price: float,
        swing_high_time: int,
        swing_low_price: float,
        swing_low_time: int,
        direction: str,
        user_note: str | None = None,
    ) -> int:
        """
        Lock a fib drawing. Returns the new row ID.

        If the exact same swing (conid + timeframe + tool_type + timestamps)
        is already locked, the INSERT is rejected by the UNIQUE constraint
        and we return the existing row's ID.
        """
        def _insert() -> int:
            try:
                cursor = self._execute(
                    """INSERT INTO locked_fibonacci_drawings
                       (conid, timeframe, tool_type, swing_high_price, swing_high_time,
                        swing_low_price, swing_low_time, direction, user_note)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (conid, timeframe, tool_type, swing_high_price, swing_high_time,
                     swing_low_price, swing_low_time, direction, user_note),
                )
                assert self._conn is not None
                self._conn.commit()
                assert cursor.lastrowid is not None
                return cursor.lastrowid
            except sqlite3.IntegrityError:
                # Already locked — find and return the existing row
                row = self._fetchone(
                    """SELECT id FROM locked_fibonacci_drawings
                       WHERE conid=? AND timeframe=? AND tool_type=?
                         AND swing_high_time=? AND swing_low_time=?""",
                    (conid, timeframe, tool_type, swing_high_time, swing_low_time),
                )
                return row["id"] if row else -1

        return await self._run_write(_insert)

    async def delete_locked_fib(self, lock_id: int) -> bool:
        """Unlock (delete) a locked fib by its row ID."""
        def _delete() -> bool:
            cursor = self._execute(
                "DELETE FROM locked_fibonacci_drawings WHERE id = ?", (lock_id,)
            )
            assert self._conn is not None
            self._conn.commit()
            return cursor.rowcount > 0

        return await self._run_write(_delete)

    async def delete_locked_fibs_for_conid(self, conid: int) -> int:
        """Delete every locked fib for an instrument. Returns the count removed."""
        def _delete() -> int:
            cursor = self._execute(
                "DELETE FROM locked_fibonacci_drawings WHERE conid = ?", (conid,)
            )
            assert self._conn is not None
            self._conn.commit()
            return cursor.rowcount

        return await self._run_write(_delete)

    async def list_locked_fibs(self, conid: int) -> list[dict]:
        """
        Get all locked fib drawings for a given instrument (by conid).

        Locked fibs show on ALL timeframes, so the frontend fetches them
        once per instrument — not per timeframe.
        """
        return await asyncio.to_thread(
            self._fetchall,
            """SELECT * FROM locked_fibonacci_drawings
               WHERE conid = ?
               ORDER BY locked_at DESC""",
            (conid,),
        )

    async def get_locked_fib(self, lock_id: int) -> dict | None:
        """Get a single locked fib by ID."""
        return await asyncio.to_thread(
            self._fetchone,
            "SELECT * FROM locked_fibonacci_drawings WHERE id = ?",
            (lock_id,),
        )

    # ── Chart Drawing Operations (drawing-tools-plan.md Branch 1) ────

    async def save_drawing(
        self,
        conid: int,
        kind: str,
        anchors_json: str,
        style_json: str | None = None,
    ) -> int:
        """
        Insert a new drawing and return its auto-assigned id.

        anchors_json / style_json must already be serialised to JSON strings
        by the router before calling this method.
        """
        import json as _json  # local import — avoid top-level shadowing

        def _insert() -> int:
            assert self._conn is not None
            cursor = self._conn.execute(
                """INSERT INTO chart_drawings (conid, kind, anchors_json, style_json)
                   VALUES (?, ?, ?, ?)""",
                (conid, kind, anchors_json, style_json),
            )
            self._conn.commit()
            assert cursor.lastrowid is not None
            return cursor.lastrowid

        return await self._run_write(_insert)

    async def update_drawing(
        self,
        drawing_id: int,
        anchors_json: str | None = None,
        style_json: str | None = None,
    ) -> bool:
        """
        Partial update — only the fields supplied are written.
        Returns True if a row was updated, False if the id was not found.
        """
        from datetime import datetime as _dt

        def _update() -> bool:
            assert self._conn is not None
            fields: list[str] = ["updated_at = ?"]
            params: list[object] = [_dt.utcnow().strftime("%Y-%m-%d %H:%M:%S")]

            if anchors_json is not None:
                fields.append("anchors_json = ?")
                params.append(anchors_json)
            if style_json is not None:
                fields.append("style_json = ?")
                params.append(style_json)

            params.append(drawing_id)
            cursor = self._conn.execute(
                f"UPDATE chart_drawings SET {', '.join(fields)} WHERE id = ?",
                params,
            )
            self._conn.commit()
            return cursor.rowcount > 0

        return await self._run_write(_update)

    async def delete_drawing(self, drawing_id: int) -> bool:
        """
        Delete a drawing by id.
        Returns True if the row existed and was deleted; False otherwise.
        """
        def _delete() -> bool:
            assert self._conn is not None
            cursor = self._conn.execute(
                "DELETE FROM chart_drawings WHERE id = ?", (drawing_id,)
            )
            self._conn.commit()
            return cursor.rowcount > 0

        return await self._run_write(_delete)

    async def get_drawing(self, drawing_id: int) -> dict | None:
        """Return a single drawing row by id, or None if not found."""
        return await asyncio.to_thread(
            self._fetchone,
            "SELECT * FROM chart_drawings WHERE id = ?",
            (drawing_id,),
        )

    async def list_drawings(self, conid: int) -> list[dict]:
        """
        Return all drawings for an instrument, ordered oldest-first so the
        frontend renders them in insertion order (predictable z-order on load).
        """
        return await asyncio.to_thread(
            self._fetchall,
            """SELECT * FROM chart_drawings
               WHERE conid = ?
               ORDER BY created_at ASC""",
            (conid,),
        )

    # ── Pulse Config Operations (Phase 8.9+) ─────────────────

    async def get_pulse_config(self) -> list[dict]:
        """
        Return all pulse-bar items in display order (left → right).

        Each row is a plain dict: {position, label, resolve, sec_type}.
        `sec_type` defaults to "" when unset (unset means "no hint",
        resolver uses its STK-then-unfiltered fallback chain).
        If the table is empty (first run before seed), returns [].
        """
        return await asyncio.to_thread(
            self._fetchall,
            "SELECT position, label, resolve, sec_type "
            "FROM pulse_config ORDER BY position ASC",
        )

    async def replace_pulse_config(
        self, items: list[tuple[str, str, str]],
    ) -> None:
        """
        Replace the entire pulse-bar config atomically.

        `items` is a list of (label, resolve, sec_type) tuples in the
        desired display order. `sec_type` is an optional IBKR secType
        hint — pass "" when not needed. Positions are re-indexed from 0
        on every write so the caller never has to think about holes.
        We run DELETE + INSERT inside one transaction so a failure
        mid-write can't leave the bar empty.
        """
        def _replace() -> None:
            assert self._conn is not None
            try:
                self._conn.execute("BEGIN")
                self._conn.execute("DELETE FROM pulse_config")
                self._conn.executemany(
                    "INSERT INTO pulse_config "
                    "(position, label, resolve, sec_type) VALUES (?, ?, ?, ?)",
                    [
                        (i, label, resolve, sec_type)
                        for i, (label, resolve, sec_type) in enumerate(items)
                    ],
                )
                self._conn.commit()
            except sqlite3.Error:
                self._conn.rollback()
                raise

        await self._run_write(_replace)

    async def reset_pulse_config(self) -> list[dict]:
        """
        Reset the pulse bar to DEFAULT_PULSE_ITEMS and return the new list.
        Used by POST /pulse-config/reset.
        """
        await self.replace_pulse_config(list(DEFAULT_PULSE_ITEMS))
        return await self.get_pulse_config()

    # ── Seed default settings ────────────────────────────────

    async def seed_defaults(self) -> None:
        """
        Insert default settings if they don't exist yet.
        Called once during app startup, after tables are created.
        """
        defaults = {
            "scan_interval": "300",           # Global scanner interval (seconds) — matches frontend key
            "default_timeframe": "1D",        # Default chart timeframe
            "default_period": "3M",           # Default chart period
            "notifications_enabled": "true",  # Phase 6.5: global desktop notification toggle
            "theme_mode": "dark",             # Phase 8.9+: 'dark' | 'light'
        }
        for key, value in defaults.items():
            existing = await self.get_setting(key)
            if existing is None:
                await self.set_setting(key, value)
                log.info("Seeded default setting: %s = %s", key, value)

        # Seed pulse config only if the table is empty. Users who have
        # already customized their bar keep their layout across restarts.
        existing_pulse = await self.get_pulse_config()
        if not existing_pulse:
            await self.replace_pulse_config(list(DEFAULT_PULSE_ITEMS))
            log.info("Seeded default pulse config (%d items)", len(DEFAULT_PULSE_ITEMS))
