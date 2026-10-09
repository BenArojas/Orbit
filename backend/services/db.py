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
from services.setup_evidence import US_EXTENDED, evidence_is_current, setup_timestamps

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
                revision              INTEGER NOT NULL DEFAULT 1,
                setup_plan_id         INTEGER REFERENCES setup_plans(id) ON DELETE RESTRICT,
                owner_account_id      TEXT,
                account_mode          TEXT,
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
                news_candle_method  TEXT,
                is_invalidation_condition INTEGER NOT NULL DEFAULT 0
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
                rule_revision      INTEGER,
                rule_evaluation_id INTEGER REFERENCES rule_evaluations(id) ON DELETE SET NULL,
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

            CREATE TABLE IF NOT EXISTS setup_plans (
                id                      INTEGER PRIMARY KEY AUTOINCREMENT,
                owner_account_id        TEXT NOT NULL,
                account_mode            TEXT NOT NULL CHECK (account_mode IN ('paper', 'live')),
                conid                   INTEGER NOT NULL,
                symbol                  TEXT NOT NULL,
                setup_type              TEXT NOT NULL,
                waiting_intention       TEXT NOT NULL,
                monitoring_mode         TEXT NOT NULL CHECK (monitoring_mode IN ('manual', 'automatic')),
                invalidation_reference  TEXT,
                invalidation_condition_json TEXT,
                rule_id                 INTEGER UNIQUE REFERENCES trigger_rules(id) ON DELETE RESTRICT,
                lifecycle               TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active', 'archived')),
                revision                INTEGER NOT NULL DEFAULT 1,
                created_at              TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at              TEXT NOT NULL DEFAULT (datetime('now')),
                archived_at             TEXT
            );

            CREATE TABLE IF NOT EXISTS trigger_match_state (
                rule_id INTEGER NOT NULL REFERENCES trigger_rules(id) ON DELETE CASCADE,
                rule_revision INTEGER NOT NULL,
                conid INTEGER NOT NULL,
                matched INTEGER NOT NULL CHECK (matched IN (0, 1)),
                episode INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (rule_id, rule_revision, conid)
            );

            CREATE TABLE IF NOT EXISTS trigger_rule_revisions (
                rule_id         INTEGER NOT NULL REFERENCES trigger_rules(id) ON DELETE CASCADE,
                revision        INTEGER NOT NULL,
                definition_json TEXT NOT NULL,
                created_at      TEXT NOT NULL DEFAULT (datetime('now')),
                PRIMARY KEY (rule_id, revision)
            );

            CREATE TABLE IF NOT EXISTS rule_evaluations (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                plan_id          INTEGER NOT NULL REFERENCES setup_plans(id) ON DELETE RESTRICT,
                plan_revision    INTEGER NOT NULL,
                rule_id          INTEGER NOT NULL REFERENCES trigger_rules(id) ON DELETE RESTRICT,
                rule_revision    INTEGER NOT NULL,
                outcome          TEXT NOT NULL CHECK (outcome IN ('matched', 'not_matched', 'failed', 'unavailable')),
                invalidation_outcome TEXT CHECK (invalidation_outcome IN ('matched', 'not_matched', 'failed', 'unavailable')),
                invalidation_failure_code TEXT,
                invalidation_failure_message TEXT,
                checked_at       TEXT NOT NULL,
                evidence_at      TEXT,
                condition_values TEXT NOT NULL,
                failure_code     TEXT,
                failure_message  TEXT,
                reviewed_at      TEXT
            );

            -- ─── Settings ──────────────────────────────────────────
            -- Key-value store for app preferences.
            -- Examples: scan_interval=300, default_timeframe=1D
            CREATE TABLE IF NOT EXISTS settings (
                key         TEXT PRIMARY KEY,
                value       TEXT NOT NULL,
                updated_at  TEXT DEFAULT (datetime('now'))
            );

            -- ─── Instruments Cache ─────────────────────────────────
            -- Local cache of IBKR's instrument metadata.
            -- Avoids hitting IBKR's search API repeatedly for the same stock.
            --
            -- conid is the primary key — IBKR's unique integer for each security.
            -- This is the UNIVERSAL KEY across the entire Orbit:
            --   Parallax uses conid in trigger_rules, trigger_hits, indicators
            --   MoonMarket will use conid in positions and orders
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

            CREATE INDEX IF NOT EXISTS idx_setup_plans_scope
                ON setup_plans(owner_account_id, account_mode, lifecycle);
            CREATE INDEX IF NOT EXISTS idx_rule_evaluations_plan
                ON rule_evaluations(plan_id, id DESC);

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
        ]
        for sql in migrations:
            try:
                self._conn.execute(sql)
                self._conn.commit()
                log.info("Migration applied: %s", sql)
            except sqlite3.OperationalError:
                pass  # column already exists — safe to skip

        additions = (
            ("trigger_rules", "revision", "INTEGER NOT NULL DEFAULT 1"),
            ("trigger_rules", "setup_plan_id", "INTEGER REFERENCES setup_plans(id) ON DELETE RESTRICT"),
            ("trigger_rules", "owner_account_id", "TEXT"),
            ("trigger_rules", "account_mode", "TEXT"),
            ("trigger_conditions", "is_invalidation_condition", "INTEGER NOT NULL DEFAULT 0"),
            ("trigger_hits", "rule_revision", "INTEGER"),
            ("trigger_hits", "rule_evaluation_id", "INTEGER REFERENCES rule_evaluations(id) ON DELETE SET NULL"),
            ("rule_evaluations", "invalidation_outcome", "TEXT"),
            ("rule_evaluations", "invalidation_failure_code", "TEXT"),
            ("rule_evaluations", "invalidation_failure_message", "TEXT"),
            ("rule_evaluations", "evidence_session_policy", "TEXT"),
        )
        for table, column, declaration in additions:
            columns = {
                row["name"]
                for row in self._conn.execute(f"PRAGMA table_info({table})").fetchall()
            }
            if column not in columns:
                self._conn.execute(
                    f"ALTER TABLE {table} ADD COLUMN {column} {declaration}"
                )

        self._conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_trigger_rules_setup_plan "
            "ON trigger_rules(setup_plan_id)"
        )

        # Capture each rule's current definition once. Existing hits remain
        # unattributed (rule_revision NULL), so migration never certifies them
        # as evidence for a tracked plan.
        import json as _json

        rules = self._conn.execute("SELECT * FROM trigger_rules").fetchall()
        for row in rules:
            rule = dict(row)
            rule["conditions"] = self._read_conditions(rule["id"])
            self._conn.execute(
                "INSERT OR IGNORE INTO trigger_rule_revisions "
                "(rule_id, revision, definition_json) VALUES (?, ?, ?)",
                (rule["id"], rule["revision"], _json.dumps(rule, sort_keys=True)),
            )

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

    # ── Trigger Rules ─────────────────────────────────────

    async def get_trigger_rules(self, enabled_only: bool = False) -> list[dict]:
        def _do():
            assert self._conn is not None
            q = "SELECT * FROM trigger_rules WHERE setup_plan_id IS NULL"
            if enabled_only:
                q += " AND enabled=1"
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
            "SELECT indicator, condition, threshold, news_candle_method, "
            "is_invalidation_condition "
            "FROM trigger_conditions WHERE rule_id=? ORDER BY order_index",
            (rule_id,),
        )
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]

    async def get_trigger_rules_for_watchlist(self, watchlist_name: str) -> list[dict]:
        def _do():
            assert self._conn is not None
            cur = self._conn.execute(
                "SELECT * FROM trigger_rules WHERE watchlist_name=? AND enabled=1 "
                "AND setup_plan_id IS NULL",
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
                self._save_rule_revision(rule_id, 1)
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
                existing = self._conn.execute(
                    "SELECT setup_plan_id, revision FROM trigger_rules WHERE id=?",
                    (rule_id,),
                ).fetchone()
                if existing is None:
                    return False
                if existing["setup_plan_id"] is not None:
                    raise PermissionError("plan-linked rules must be edited through their setup plan")
                old_revision = int(existing["revision"])
                revision = old_revision + int(
                    bool(set(fields) & {"timeframe", "conid", "watchlist_name"})
                    or conditions is not None
                )
                if fields:
                    set_clause = ", ".join(f"{k}=?" for k in fields)
                    self._conn.execute(
                        f"UPDATE trigger_rules SET {set_clause}, revision=?, "
                        "updated_at=datetime('now') WHERE id=?",
                        (*fields.values(), revision, rule_id),
                    )
                else:
                    self._conn.execute(
                        "UPDATE trigger_rules SET revision=?, updated_at=datetime('now') WHERE id=?",
                        (revision, rule_id),
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
                self._save_rule_revision(rule_id, revision)
                return True
        return await self._run_write(_do)

    async def delete_trigger_rule(self, rule_id: int) -> bool:
        def _do():
            assert self._conn is not None
            with self._conn:
                existing = self._conn.execute(
                    "SELECT setup_plan_id FROM trigger_rules WHERE id=?", (rule_id,)
                ).fetchone()
                if existing is None:
                    return False
                if existing["setup_plan_id"] is not None:
                    raise PermissionError("plan-linked rules cannot be deleted")
                cur = self._conn.execute("DELETE FROM trigger_rules WHERE id=?", (rule_id,))
                return cur.rowcount > 0
        return await self._run_write(_do)

    def _save_rule_revision(self, rule_id: int, revision: int) -> None:
        """Persist the complete rule definition while the DB lock is held."""
        import json as _json

        rule = self._fetchone("SELECT * FROM trigger_rules WHERE id=?", (rule_id,))
        if rule is None:
            raise ValueError(f"rule {rule_id} not found")
        rule["conditions"] = self._read_conditions(rule_id)
        self._conn.execute(
            "INSERT OR REPLACE INTO trigger_rule_revisions "
            "(rule_id, revision, definition_json) VALUES (?, ?, ?)",
            (rule_id, revision, _json.dumps(rule, sort_keys=True)),
        )

    def _insert_setup_plan_rule(
        self,
        *,
        plan_id: int,
        owner_account_id: str,
        account_mode: str,
        conid: int,
        symbol: str,
        setup_type: str,
        timeframe: str,
        scan_interval_seconds: int,
        conditions: list[dict],
        invalidation_condition: dict | None,
    ) -> int:
        assert self._conn is not None
        cur = self._conn.execute(
            """INSERT INTO trigger_rules
               (name, watchlist_name, conid, symbol, template_id, ibkr_mirror_target,
                timeframe, scan_interval_seconds, enabled, setup_plan_id,
                owner_account_id, account_mode)
               VALUES (?, NULL, ?, ?, NULL, NULL, ?, ?, 1, ?, ?, ?)""",
            (f"{symbol} {setup_type}", conid, symbol, timeframe,
             scan_interval_seconds, plan_id, owner_account_id, account_mode),
        )
        rule_id = int(cur.lastrowid)
        self._replace_setup_rule_conditions(rule_id, conditions, invalidation_condition)
        self._save_rule_revision(rule_id, 1)
        return rule_id

    def _replace_setup_rule_conditions(
        self, rule_id: int, conditions: list[dict], invalidation_condition: dict | None
    ) -> None:
        assert self._conn is not None
        self._conn.execute("DELETE FROM trigger_conditions WHERE rule_id=?", (rule_id,))
        rows = [({**c, "is_invalidation_condition": 0}) for c in conditions]
        if invalidation_condition is not None:
            rows.append({**invalidation_condition, "is_invalidation_condition": 1})
        for idx, condition in enumerate(rows):
            self._conn.execute(
                """INSERT INTO trigger_conditions
                   (rule_id, order_index, indicator, condition, threshold,
                    news_candle_method, is_invalidation_condition)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (rule_id, idx, condition["indicator"], condition["condition"],
                 condition.get("threshold"), condition.get("news_candle_method"),
                 condition["is_invalidation_condition"]),
            )

    def _setup_plan_summary(self, row: sqlite3.Row | dict) -> dict:
        import json as _json

        plan = dict(row)
        rule = None
        if plan["rule_id"] is not None:
            rule = self._fetchone(
                "SELECT id, revision, enabled, timeframe, scan_interval_seconds "
                "FROM trigger_rules WHERE id=? AND setup_plan_id=?",
                (plan["rule_id"], plan["id"]),
            )
            if rule is not None:
                all_conditions = self._read_conditions(rule["id"])
                rule["conditions"] = [
                    {k: v for k, v in condition.items() if k != "is_invalidation_condition"}
                    for condition in all_conditions
                    if not condition["is_invalidation_condition"]
                ]
                rule["invalidation_condition"] = next(
                    (
                        {k: v for k, v in condition.items() if k != "is_invalidation_condition"}
                        for condition in all_conditions
                        if condition["is_invalidation_condition"]
                    ),
                    None,
                )
                rule["enabled"] = bool(rule["enabled"])

        invalidation_condition = plan.pop("invalidation_condition_json")
        plan["invalidation_condition"] = (
            _json.loads(invalidation_condition) if invalidation_condition else None
        )
        latest = None
        if rule is not None:
            latest = self._fetchone(
                """SELECT * FROM rule_evaluations
                   WHERE plan_id=? AND rule_id=? AND plan_revision=? AND rule_revision=?
                   ORDER BY id DESC LIMIT 1""",
                (plan["id"], rule["id"], plan["revision"], rule["revision"]),
            )
        if latest is not None:
            latest["condition_values"] = _json.loads(latest["condition_values"])
            setup_timestamps(latest)

        count = 0
        if rule is not None:
            count = self._fetchone(
                """SELECT COUNT(*) AS n FROM rule_evaluations
                   WHERE plan_id=? AND rule_id=? AND plan_revision=? AND rule_revision=?
                     AND (outcome='matched' OR invalidation_outcome='matched')
                     AND reviewed_at IS NULL""",
                (plan["id"], rule["id"], plan["revision"], rule["revision"]),
            )["n"]

        due_at = None
        if plan["monitoring_mode"] == "manual" or plan["lifecycle"] == "archived":
            health = "not_monitored"
        elif latest is None:
            health = "not_checked"
        else:
            try:
                checked_at = datetime.fromisoformat(latest["checked_at"].replace("Z", "+00:00"))
                if checked_at.tzinfo is None:
                    checked_at = checked_at.replace(tzinfo=timezone.utc)
                due = checked_at.astimezone(timezone.utc) + timedelta(
                    seconds=int(rule["scan_interval_seconds"])
                )
                due_at = due.isoformat()
                if datetime.now(timezone.utc) >= due:
                    health = "overdue"
                elif (
                    latest["outcome"] in {"matched", "not_matched"}
                    and latest["invalidation_outcome"] not in {"failed", "unavailable"}
                    and latest["evidence_session_policy"] == US_EXTENDED
                    and evidence_is_current(latest["evidence_at"], rule["timeframe"], datetime.now(timezone.utc))
                ):
                    health = "healthy"
                else:
                    health = "unavailable"
            except (TypeError, ValueError):
                health = "unavailable"

        plan["account_id"] = plan.pop("owner_account_id")
        plan["rule"] = rule
        plan["latest_evaluation"] = latest
        plan["unreviewed_match_count"] = int(count)
        plan["monitoring_health"] = health
        plan["monitoring_due_at"] = due_at
        return setup_timestamps(plan)

    async def list_setup_plans(self, owner_account_id: str, account_mode: str) -> list[dict]:
        def _do():
            assert self._conn is not None
            rows = self._conn.execute(
                """SELECT * FROM setup_plans
                   WHERE owner_account_id=? AND account_mode=?
                   ORDER BY updated_at DESC, id DESC""",
                (owner_account_id, account_mode),
            ).fetchall()
            return [self._setup_plan_summary(row) for row in rows]
        return await self._run_read(_do)

    async def get_setup_plan(
        self, plan_id: int, owner_account_id: str, account_mode: str
    ) -> dict | None:
        import json as _json

        def _do():
            assert self._conn is not None
            row = self._conn.execute(
                """SELECT * FROM setup_plans
                   WHERE id=? AND owner_account_id=? AND account_mode=?""",
                (plan_id, owner_account_id, account_mode),
            ).fetchone()
            if row is None:
                return None
            plan = self._setup_plan_summary(row)
            evaluations = self._conn.execute(
                "SELECT * FROM rule_evaluations WHERE plan_id=? ORDER BY id DESC LIMIT 200",
                (plan_id,),
            ).fetchall()
            plan["evaluations"] = [
                setup_timestamps({**dict(e), "condition_values": _json.loads(e["condition_values"])})
                for e in evaluations
            ]
            rule = plan["rule"]
            outstanding = self._conn.execute(
                """SELECT * FROM rule_evaluations
                   WHERE plan_id=? AND rule_id=? AND plan_revision=? AND rule_revision=?
                     AND (outcome='matched' OR invalidation_outcome='matched')
                     AND reviewed_at IS NULL
                   ORDER BY id DESC""",
                (plan_id, rule["id"], plan["revision"], rule["revision"]),
            ).fetchall() if rule is not None else []
            plan["unreviewed_matches"] = [
                setup_timestamps({**dict(e), "condition_values": _json.loads(e["condition_values"])})
                for e in outstanding
            ]
            hits = self._conn.execute(
                """SELECT h.*, r.name AS rule_name
                   FROM trigger_hits h JOIN trigger_rules r ON r.id=h.rule_id
                   WHERE r.setup_plan_id=? ORDER BY h.triggered_at DESC, h.id DESC LIMIT 200""",
                (plan_id,),
            ).fetchall()
            plan["hits"] = [
                {**dict(hit), "condition_values": _json.loads(hit["condition_values"])}
                for hit in hits
            ]
            return plan
        return await self._run_read(_do)

    async def create_setup_plan(
        self,
        *,
        owner_account_id: str,
        account_mode: str,
        conid: int,
        symbol: str,
        setup_type: str,
        waiting_intention: str,
        monitoring_mode: str,
        invalidation_reference: str | None,
        invalidation_condition: dict | None,
        timeframe: str | None,
        scan_interval_seconds: int | None,
        conditions: list[dict],
    ) -> int:
        import json as _json

        def _do():
            assert self._conn is not None
            with self._conn:
                if monitoring_mode == "automatic" and not conditions:
                    raise ValueError("automatic plans require at least one waiting condition")
                if monitoring_mode == "manual" and (conditions or invalidation_condition is not None):
                    raise ValueError("manual plans cannot have rule conditions")
                cur = self._conn.execute(
                    """INSERT INTO setup_plans
                       (owner_account_id, account_mode, conid, symbol, setup_type,
                        waiting_intention, monitoring_mode, invalidation_reference,
                        invalidation_condition_json)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (owner_account_id, account_mode, conid, symbol, setup_type,
                     waiting_intention, monitoring_mode, invalidation_reference,
                     _json.dumps(invalidation_condition) if invalidation_condition else None),
                )
                plan_id = int(cur.lastrowid)
                if monitoring_mode == "automatic":
                    if not timeframe or not scan_interval_seconds:
                        raise ValueError("automatic plans require a timeframe and scan interval")
                    rule_id = self._insert_setup_plan_rule(
                        plan_id=plan_id, owner_account_id=owner_account_id,
                        account_mode=account_mode, conid=conid, symbol=symbol,
                        setup_type=setup_type, timeframe=timeframe,
                        scan_interval_seconds=scan_interval_seconds,
                        conditions=conditions, invalidation_condition=invalidation_condition,
                    )
                    self._conn.execute(
                        "UPDATE setup_plans SET rule_id=? WHERE id=?", (rule_id, plan_id)
                    )
                return plan_id
        return await self._run_write(_do)

    async def update_setup_plan(
        self,
        plan_id: int,
        owner_account_id: str,
        account_mode: str,
        updates: dict,
    ) -> bool:
        import json as _json

        allowed = {
            "setup_type", "waiting_intention", "monitoring_mode",
            "invalidation_reference", "invalidation_condition", "timeframe",
            "scan_interval_seconds", "conditions",
        }
        if set(updates) - allowed:
            raise ValueError("unknown setup plan fields")

        def _do():
            assert self._conn is not None
            with self._conn:
                plan = self._conn.execute(
                    """SELECT * FROM setup_plans
                       WHERE id=? AND owner_account_id=? AND account_mode=?""",
                    (plan_id, owner_account_id, account_mode),
                ).fetchone()
                if plan is None:
                    return False
                if plan["lifecycle"] != "active":
                    raise ValueError("archived plans cannot be edited")
                if not updates:
                    raise ValueError("no fields to update")

                mode = updates.get("monitoring_mode", plan["monitoring_mode"])
                current_rule = None
                current_conditions: list[dict] = []
                current_invalidation = (
                    _json.loads(plan["invalidation_condition_json"])
                    if plan["invalidation_condition_json"] else None
                )
                if plan["rule_id"] is not None:
                    current_rule = self._conn.execute(
                        "SELECT * FROM trigger_rules WHERE id=? AND setup_plan_id=?",
                        (plan["rule_id"], plan_id),
                    ).fetchone()
                    if current_rule is None:
                        raise ValueError("linked rule is missing")
                    all_conditions = self._read_conditions(current_rule["id"])
                    current_conditions = [
                        {k: v for k, v in c.items() if k != "is_invalidation_condition"}
                        for c in all_conditions if not c["is_invalidation_condition"]
                    ]

                conditions = updates.get("conditions", current_conditions)
                invalidation = updates.get("invalidation_condition", current_invalidation)
                timeframe = updates.get("timeframe", current_rule["timeframe"] if current_rule else None)
                interval = updates.get(
                    "scan_interval_seconds",
                    current_rule["scan_interval_seconds"] if current_rule else None,
                )
                if mode == "automatic" and not conditions:
                    raise ValueError("automatic plans require at least one waiting condition")
                if mode == "automatic" and (not timeframe or not interval):
                    raise ValueError("automatic plans require a timeframe and scan interval")
                if mode == "manual" and (
                    updates.get("conditions") or updates.get("invalidation_condition")
                    or updates.get("timeframe") or updates.get("scan_interval_seconds")
                ):
                    raise ValueError("manual plans cannot have rule conditions")

                fields = {
                    key: updates[key]
                    for key in ("setup_type", "waiting_intention", "invalidation_reference")
                    if key in updates
                }
                fields["monitoring_mode"] = mode
                fields["invalidation_condition_json"] = (
                    _json.dumps(invalidation) if mode == "automatic" and invalidation else None
                )
                set_clause = ", ".join(f"{key}=?" for key in fields)
                self._conn.execute(
                    f"UPDATE setup_plans SET {set_clause}, revision=revision+1, "
                    "updated_at=datetime('now') WHERE id=?",
                    (*fields.values(), plan_id),
                )

                if mode == "manual" and current_rule is not None:
                    revision = int(current_rule["revision"]) + 1
                    self._conn.execute(
                        "UPDATE trigger_rules SET enabled=0, revision=?, updated_at=datetime('now') WHERE id=?",
                        (revision, current_rule["id"]),
                    )
                    self._save_rule_revision(current_rule["id"], revision)
                    self._conn.execute("UPDATE setup_plans SET rule_id=NULL WHERE id=?", (plan_id,))
                elif mode == "automatic" and current_rule is None:
                    rule_id = self._insert_setup_plan_rule(
                        plan_id=plan_id, owner_account_id=owner_account_id,
                        account_mode=account_mode, conid=plan["conid"], symbol=plan["symbol"],
                        setup_type=fields.get("setup_type", plan["setup_type"]),
                        timeframe=timeframe, scan_interval_seconds=interval,
                        conditions=conditions, invalidation_condition=invalidation,
                    )
                    self._conn.execute(
                        "UPDATE setup_plans SET rule_id=? WHERE id=?", (rule_id, plan_id)
                    )
                elif mode == "automatic" and current_rule is not None:
                    definition_changed = (
                        conditions != current_conditions
                        or invalidation != current_invalidation
                        or timeframe != current_rule["timeframe"]
                    )
                    if definition_changed:
                        revision = int(current_rule["revision"]) + 1
                        self._conn.execute(
                            """UPDATE trigger_rules SET name=?, timeframe=?, scan_interval_seconds=?,
                               revision=?, updated_at=datetime('now') WHERE id=?""",
                            (f"{plan['symbol']} {fields.get('setup_type', plan['setup_type'])}",
                             timeframe, interval, revision, current_rule["id"]),
                        )
                        self._replace_setup_rule_conditions(
                            current_rule["id"], conditions, invalidation
                        )
                        self._save_rule_revision(current_rule["id"], revision)
                    elif interval != current_rule["scan_interval_seconds"]:
                        self._conn.execute(
                            "UPDATE trigger_rules SET scan_interval_seconds=?, updated_at=datetime('now') WHERE id=?",
                            (interval, current_rule["id"]),
                        )
                return True
        return await self._run_write(_do)

    async def archive_setup_plan(
        self, plan_id: int, owner_account_id: str, account_mode: str
    ) -> bool:
        def _do():
            assert self._conn is not None
            with self._conn:
                plan = self._conn.execute(
                    """SELECT id, lifecycle FROM setup_plans
                       WHERE id=? AND owner_account_id=? AND account_mode=?""",
                    (plan_id, owner_account_id, account_mode),
                ).fetchone()
                if plan is None:
                    return False
                if plan["lifecycle"] == "archived":
                    return True
                rules = self._conn.execute(
                    "SELECT id, revision FROM trigger_rules WHERE setup_plan_id=? AND enabled=1",
                    (plan_id,),
                ).fetchall()
                for rule in rules:
                    revision = int(rule["revision"]) + 1
                    self._conn.execute(
                        "UPDATE trigger_rules SET enabled=0, revision=?, updated_at=datetime('now') WHERE id=?",
                        (revision, rule["id"]),
                    )
                    self._save_rule_revision(rule["id"], revision)
                self._conn.execute(
                    """UPDATE setup_plans SET lifecycle='archived', archived_at=datetime('now'),
                       revision=revision+1, updated_at=datetime('now') WHERE id=?""",
                    (plan_id,),
                )
                return True
        return await self._run_write(_do)

    async def get_active_setup_plan_rules(
        self, owner_account_id: str, account_mode: str
    ) -> list[dict]:
        def _do():
            assert self._conn is not None
            rows = self._conn.execute(
                """SELECT p.*, r.id AS current_rule_id, r.name AS rule_name,
                          r.revision AS rule_revision, r.enabled AS rule_enabled,
                          r.timeframe, r.scan_interval_seconds
                   FROM setup_plans p JOIN trigger_rules r ON r.id=p.rule_id
                   WHERE p.owner_account_id=? AND p.account_mode=?
                     AND p.lifecycle='active' AND p.monitoring_mode='automatic'
                     AND r.setup_plan_id=p.id AND r.enabled=1
                   ORDER BY p.id""",
                (owner_account_id, account_mode),
            ).fetchall()
            plans = []
            for row in rows:
                plan = dict(row)
                all_conditions = self._read_conditions(plan["current_rule_id"])
                plan["conditions"] = [
                    {k: v for k, v in c.items() if k != "is_invalidation_condition"}
                    for c in all_conditions if not c["is_invalidation_condition"]
                ]
                plan["invalidation_condition"] = next(
                    (
                        {k: v for k, v in c.items() if k != "is_invalidation_condition"}
                        for c in all_conditions if c["is_invalidation_condition"]
                    ),
                    None,
                )
                plan["rule"] = {
                    "id": plan["current_rule_id"],
                    "revision": plan["rule_revision"],
                    "name": plan["rule_name"],
                    "timeframe": plan["timeframe"],
                    "scan_interval_seconds": plan["scan_interval_seconds"],
                    "conditions": plan["conditions"],
                    "invalidation_condition": plan["invalidation_condition"],
                }
                plans.append(plan)
            return plans
        return await self._run_read(_do)

    async def record_setup_plan_evaluation(
        self,
        *,
        plan_id: int,
        owner_account_id: str,
        account_mode: str,
        plan_revision: int,
        rule_id: int,
        rule_revision: int,
        outcome: str,
        checked_at: str,
        evidence_at: str | None,
        condition_values: list[dict],
        failure_code: str | None = None,
        failure_message: str | None = None,
        invalidation_outcome: str | None = None,
        invalidation_failure_code: str | None = None,
        invalidation_failure_message: str | None = None,
        evidence_session_policy: str | None = None,
    ) -> dict | None:
        import json as _json

        if outcome not in {"matched", "not_matched", "failed", "unavailable"}:
            raise ValueError("invalid rule evaluation outcome")
        if invalidation_outcome not in {None, "matched", "not_matched", "failed", "unavailable"}:
            raise ValueError("invalid invalidation evaluation outcome")
        if invalidation_outcome is None and (
            invalidation_failure_code is not None or invalidation_failure_message is not None
        ):
            raise ValueError("invalidation failure details require an invalidation check")

        def _do():
            assert self._conn is not None
            with self._conn:
                current = self._conn.execute(
                    """SELECT p.conid, p.symbol, r.timeframe
                       FROM setup_plans p JOIN trigger_rules r ON r.id=p.rule_id
                       WHERE p.id=? AND p.owner_account_id=? AND p.account_mode=?
                         AND p.lifecycle='active' AND p.monitoring_mode='automatic'
                         AND p.revision=? AND p.rule_id=? AND r.revision=? AND r.enabled=1
                         AND r.setup_plan_id=p.id AND r.owner_account_id=p.owner_account_id
                         AND r.account_mode=p.account_mode AND r.conid=p.conid
                         AND r.watchlist_name IS NULL AND r.ibkr_mirror_target IS NULL""",
                    (plan_id, owner_account_id, account_mode, plan_revision,
                     rule_id, rule_revision),
                ).fetchone()
                if current is None:
                    return None
                cur = self._conn.execute(
                    """INSERT INTO rule_evaluations
                        (plan_id, plan_revision, rule_id, rule_revision, outcome, invalidation_outcome,
                        invalidation_failure_code, invalidation_failure_message,
                        checked_at, evidence_at, condition_values, failure_code, failure_message, evidence_session_policy)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (plan_id, plan_revision, rule_id, rule_revision, outcome, invalidation_outcome,
                     invalidation_failure_code, invalidation_failure_message,
                     checked_at, evidence_at, _json.dumps(condition_values),
                     failure_code, failure_message, evidence_session_policy),
                )
                evaluation_id = int(cur.lastrowid)
                hit_id = None
                matched_roles = []
                if outcome == "matched":
                    matched_roles.append("waiting")
                if invalidation_outcome == "matched":
                    matched_roles.append("invalidation")
                for role in matched_roles:
                    check_time = datetime.fromisoformat(checked_at)
                    if check_time.tzinfo is None:
                        check_time = check_time.replace(tzinfo=timezone.utc)
                    day = check_time.astimezone(_ET).strftime("%Y-%m-%d")
                    dedup_key = (
                        f"{rule_id}:r{rule_revision}:{current['conid']}:{day}:{current['timeframe']}"
                    )
                    if role == "invalidation":
                        dedup_key += ":invalidation"
                    role_values = [
                        value for value in condition_values
                        if value.get("condition_role") == role
                    ]
                    if (
                        role == "waiting" and not role_values
                        and all("condition_role" not in value for value in condition_values)
                    ):
                        role_values = condition_values
                    hit = self._conn.execute(
                        """INSERT OR IGNORE INTO trigger_hits
                           (rule_id, rule_revision, rule_evaluation_id, conid, symbol,
                            dedup_key, condition_values, watchlist_name)
                           VALUES (?, ?, ?, ?, ?, ?, ?, NULL)""",
                        (rule_id, rule_revision, evaluation_id, current["conid"],
                         current["symbol"], dedup_key, _json.dumps(role_values)),
                    )
                    if hit.rowcount:
                        if hit_id is None:
                            hit_id = int(hit.lastrowid)
                    else:
                        existing_hit = self._conn.execute(
                            "SELECT id FROM trigger_hits WHERE dedup_key=?", (dedup_key,)
                        ).fetchone()
                        if hit_id is None and existing_hit:
                            hit_id = int(existing_hit["id"])
                return {"evaluation_id": evaluation_id, "hit_id": hit_id}
        return await self._run_write(_do)

    async def review_setup_plan_events(
        self,
        plan_id: int,
        owner_account_id: str,
        account_mode: str,
        evaluation_ids: list[int],
    ) -> bool:
        ids = list(dict.fromkeys(evaluation_ids))
        if not ids:
            raise ValueError("at least one evaluation id is required")
        def _do():
            assert self._conn is not None
            with self._conn:
                plan = self._conn.execute(
                    """SELECT lifecycle, revision, rule_id FROM setup_plans
                       WHERE id=? AND owner_account_id=? AND account_mode=?""",
                    (plan_id, owner_account_id, account_mode),
                ).fetchone()
                if plan is None:
                    return False
                if plan["lifecycle"] != "active" or plan["rule_id"] is None:
                    raise ValueError("only active current plan matches can be reviewed")
                rule = self._conn.execute(
                    "SELECT revision FROM trigger_rules WHERE id=? AND setup_plan_id=?",
                    (plan["rule_id"], plan_id),
                ).fetchone()
                if rule is None:
                    raise ValueError("the current plan rule is unavailable")
                placeholders = ",".join("?" for _ in ids)
                matching = self._conn.execute(
                    f"""SELECT COUNT(*) AS n FROM rule_evaluations
                        WHERE plan_id=? AND rule_id=? AND plan_revision=? AND rule_revision=?
                          AND (outcome='matched' OR invalidation_outcome='matched')
                          AND id IN ({placeholders})""",
                    (plan_id, plan["rule_id"], plan["revision"], rule["revision"], *ids),
                ).fetchone()["n"]
                if matching != len(ids):
                    raise ValueError(
                        "evaluation ids must contain current waiting or invalidation matches for this plan"
                    )
                self._conn.execute(
                    f"""UPDATE rule_evaluations SET reviewed_at=COALESCE(reviewed_at, ?)
                        WHERE plan_id=? AND rule_id=? AND plan_revision=? AND rule_revision=?
                          AND (outcome='matched' OR invalidation_outcome='matched')
                          AND id IN ({placeholders})""",
                    (datetime.now(timezone.utc).isoformat(), plan_id, plan["rule_id"], plan["revision"], rule["revision"], *ids),
                )
                return True
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
        rule_revision: int | None = None,
        rule_evaluation_id: int | None = None,
        source_watchlist: str | None = None,
        target_watchlist: str | None = None,
        expires_at: str | None = None,
        repeat_on_transition: bool = False,
    ) -> int | None:
        """Insert a hit. Returns hit id, or None if dedup_key already existed."""
        import json as _json
        def _do():
            assert self._conn is not None
            with self._conn:
                hit_key = dedup_key
                episode = 0
                if repeat_on_transition:
                    rule = self._conn.execute(
                        "SELECT id FROM trigger_rules WHERE id=? AND revision=? AND enabled=1 "
                        "AND setup_plan_id IS NULL AND ibkr_mirror_target IS NULL",
                        (rule_id, rule_revision),
                    ).fetchone()
                    if not rule:
                        return None
                    state = self._conn.execute(
                        "SELECT matched, episode FROM trigger_match_state WHERE rule_id=? AND rule_revision=? AND conid=?",
                        (rule_id, rule_revision, conid),
                    ).fetchone()
                    if state is None:
                        # Existing alerts stay quiet until a complete check observes the condition clear.
                        prior = self._conn.execute(
                            "SELECT 1 FROM trigger_hits WHERE rule_id=? AND conid=? AND COALESCE(rule_revision, 1)=? LIMIT 1",
                            (rule_id, conid, rule_revision),
                        ).fetchone()
                        self._conn.execute(
                            "INSERT INTO trigger_match_state (rule_id, rule_revision, conid, matched, episode) VALUES (?, ?, ?, ?, 0)",
                            (rule_id, rule_revision, conid, int(prior is not None)),
                        )
                        if prior:
                            return None
                    elif state["matched"]:
                        return None
                    episode = (state["episode"] if state else 0) + 1
                    hit_key = f"{rule_id}:r{rule_revision}:{conid}:episode:{episode}"
                try:
                    cur = self._conn.execute(
                        """INSERT INTO trigger_hits
                           (rule_id, rule_revision, rule_evaluation_id, conid, symbol,
                            dedup_key, condition_values,
                            watchlist_name, source_watchlist, target_watchlist, expires_at)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        (rule_id, rule_revision, rule_evaluation_id, conid, symbol,
                         hit_key, _json.dumps(condition_values),
                         watchlist_name, source_watchlist, target_watchlist, expires_at),
                    )
                    if repeat_on_transition:
                        self._conn.execute(
                            "UPDATE trigger_match_state SET matched=1, episode=? WHERE rule_id=? AND rule_revision=? AND conid=?",
                            (episode, rule_id, rule_revision, conid),
                        )
                    return cur.lastrowid
                except sqlite3.IntegrityError:
                    # UNIQUE(dedup_key) — already fired today for this rule+conid+interval
                    return None
        return await self._run_write(_do)

    async def clear_trigger_match(self, rule_id: int, rule_revision: int, conid: int) -> None:
        def _do():
            assert self._conn is not None
            with self._conn:
                self._conn.execute(
                    "INSERT INTO trigger_match_state (rule_id, rule_revision, conid, matched, episode) "
                    "SELECT id, revision, ?, 0, 0 FROM trigger_rules WHERE id=? AND revision=? AND enabled=1 "
                    "AND setup_plan_id IS NULL AND ibkr_mirror_target IS NULL "
                    "ON CONFLICT(rule_id, rule_revision, conid) DO UPDATE SET matched=0",
                    (conid, rule_id, rule_revision),
                )
        await self._run_write(_do)

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
            clauses.append("r.setup_plan_id IS NULL")
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
                    "UPDATE trigger_hits SET dismissed_at=datetime('now') WHERE id<=? "
                    "AND rule_id=(SELECT rule_id FROM trigger_hits WHERE id=?) "
                    "AND conid=(SELECT conid FROM trigger_hits WHERE id=?) "
                    "AND rule_id IN (SELECT id FROM trigger_rules WHERE setup_plan_id IS NULL)",
                    (hit_id, hit_id, hit_id),
                )
                return cur.rowcount > 0
        return await self._run_write(_do)

    async def snooze_trigger_hit(self, hit_id: int, minutes: int) -> bool:
        def _do():
            assert self._conn is not None
            with self._conn:
                cur = self._conn.execute(
                    "UPDATE trigger_hits "
                    "SET snoozed_until=datetime('now', ? || ' minutes') WHERE id=? "
                    "AND rule_id IN (SELECT id FROM trigger_rules WHERE setup_plan_id IS NULL)",
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
                      AND r.setup_plan_id IS NULL
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
    # Orbit integration: MoonMarket reads this table; Parallax is the sole writer.
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
