"""
SQLite database service for Parallax.

This is the app's local "memory" — it stores data that IBKR doesn't
store for us and that needs to survive app restarts:

  - Trigger rules (e.g., "alert me when AAPL RSI < 30")
  - Trigger hits (log of when a trigger rule actually fired)
  - Settings (scan interval, default timeframe, etc.)

What we do NOT store locally:
  - Watchlists — managed inside IBKR itself. The app reads them
    live from IBKR's API. No local copy needed.

── Hub integration ──────────────────────────────────────────────
The `instruments` table is the one piece of Parallax's database that
other Hub modules will read from:

  MoonMarket  → reads instruments to display symbol/name in portfolio
  Inflect     → reads instruments to display symbol/name in journal entries

Both modules use conid as their primary key. Instruments gets populated
lazily here in Parallax whenever we resolve a conid for the first time
(via IBKR search). Other modules are read-only consumers — they never
write to this table.

All database access goes through this module. No other file should
write raw SQL — they call these functions instead.

The database is a single file (parallax.db) that lives next to the app.
It's never deleted unless you manually remove it. Closing the app,
restarting your computer — the data stays.
"""

import asyncio
import logging
import sqlite3
from datetime import datetime, timezone
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
DEFAULT_PULSE_ITEMS: tuple[tuple[str, str], ...] = (
    ("SPX", "SPX"),
    ("SPY", "SPY"),
    ("QQQ", "QQQ"),
    ("DIA", "DIA"),
    ("IWM", "IWM"),
    ("BTC", "BTC"),
    ("ETH", "ETH"),
    ("GLD", "GLD"),
    ("SLV", "SLV"),
    ("USO", "USO"),
    ("TLT", "TLT"),
    ("DXY", "DXY"),
    ("USD/ILS", "USD.ILS"),
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
            -- Conditions you set up to get alerted. For example:
            --   "When AAPL's RSI drops below 30" or
            --   "When SPY crosses above its 200 EMA"
            --
            -- Each rule watches one indicator on one specific stock
            -- and checks if the value is above/below/crossing a threshold.
            --
            -- When a trigger fires, the stock is MOVED between IBKR watchlists:
            --   source_watchlist → target_watchlist
            -- If auto_expire_days is set, it moves back automatically after N days.
            --
            -- conid = IBKR's unique ID for the stock (like a SSN for securities).
            -- symbol = the human-readable ticker (AAPL, SPY, etc.).
            CREATE TABLE IF NOT EXISTS trigger_rules (
                id                 INTEGER PRIMARY KEY AUTOINCREMENT,
                name               TEXT NOT NULL,
                conid              INTEGER NOT NULL,
                symbol             TEXT NOT NULL,
                indicator          TEXT NOT NULL,     -- e.g., "rsi", "ema_50", "macd"
                condition          TEXT NOT NULL,     -- "above", "below", "crosses_above", "crosses_below"
                threshold          REAL NOT NULL,     -- The number to compare against (e.g., 30 for RSI)
                timeframe          TEXT DEFAULT '1D', -- Which chart timeframe to check
                target_watchlist   TEXT NOT NULL,     -- IBKR watchlist name to MOVE the stock INTO when triggered
                source_watchlist   TEXT NOT NULL,     -- IBKR watchlist name to MOVE the stock OUT OF when triggered
                auto_expire_days   INTEGER,           -- NULL = manual removal only. N = auto-move back after N days
                enabled            INTEGER DEFAULT 1, -- 1 = active, 0 = paused
                scan_interval_seconds INTEGER,         -- NULL = use global default. N = check this rule every N seconds
                news_candle_method TEXT,               -- Only for indicator='news_candle': 'volume_spike' | 'range_spike' | 'gap' | 'long_wick'
                created_at         TEXT DEFAULT (datetime('now')),
                updated_at         TEXT DEFAULT (datetime('now'))
            );

            -- ─── Trigger Hits ──────────────────────────────────────
            -- Log of every time a trigger rule actually fired.
            -- This is what populates the alert feed on the dashboard.
            --
            -- We store a dedup_key to avoid alerting the same condition
            -- over and over (e.g., if RSI stays below 30 for 3 days,
            -- you only get alerted once per day).
            --
            -- When a trigger fires, the stock is moved between watchlists.
            -- If the rule has auto_expire_days, expires_at is set and the
            -- background scanner will move the stock back when it expires.
            -- moved_back = 1 means the stock has already been returned.
            CREATE TABLE IF NOT EXISTS trigger_hits (
                id                 INTEGER PRIMARY KEY AUTOINCREMENT,
                rule_id            INTEGER NOT NULL REFERENCES trigger_rules(id) ON DELETE CASCADE,
                conid              INTEGER NOT NULL,
                symbol             TEXT NOT NULL,
                indicator          TEXT NOT NULL,
                condition          TEXT NOT NULL,
                threshold          REAL NOT NULL,
                actual_value       REAL NOT NULL,    -- What the indicator actually was when it triggered
                target_watchlist   TEXT NOT NULL,     -- Where the stock was moved to
                source_watchlist   TEXT NOT NULL,     -- Where the stock was moved from
                triggered_at       TEXT DEFAULT (datetime('now')),
                expires_at         TEXT,              -- NULL = no auto-expire. Otherwise datetime when stock moves back
                moved_back         INTEGER DEFAULT 0, -- 0 = stock is in target watchlist, 1 = already moved back
                acknowledged       INTEGER DEFAULT 0, -- 0 = unread, 1 = user has seen it
                dedup_key          TEXT NOT NULL,     -- Prevents duplicate alerts
                UNIQUE(dedup_key)                     -- Only one alert per unique condition per day
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
            -- This is the UNIVERSAL KEY across the entire Hub:
            --   Parallax uses conid in trigger_rules, trigger_hits, indicators
            --   MoonMarket will use conid in fills, positions, orders
            --   Inflect will use conid in journal_entries
            --
            -- Populated lazily: when Parallax resolves a conid for the first
            -- time (via /market/search or /market/conid), it writes a row here.
            -- If the row already exists, it updates the timestamp.
            --
            -- Other Hub modules read from this table but never write to it.
            -- IBKR is the source of truth — this is just a local cache.
            CREATE TABLE IF NOT EXISTS instruments (
                conid          INTEGER PRIMARY KEY,    -- IBKR's unique contract ID
                symbol         TEXT NOT NULL,           -- Ticker (AAPL, SPY, QQQ)
                company_name   TEXT DEFAULT '',         -- Full name ("Apple Inc")
                sec_type       TEXT DEFAULT 'STK',      -- STK, ETF, OPT, FUT, etc.
                cached_at      TEXT DEFAULT (datetime('now'))
            );

            -- ─── Indexes ───────────────────────────────────────────
            -- Indexes are like a book's table of contents — they help
            -- the database find things faster without reading every row.
            CREATE INDEX IF NOT EXISTS idx_trigger_rules_conid
                ON trigger_rules(conid);

            CREATE INDEX IF NOT EXISTS idx_trigger_rules_enabled
                ON trigger_rules(enabled);

            CREATE INDEX IF NOT EXISTS idx_trigger_hits_rule
                ON trigger_hits(rule_id);

            CREATE INDEX IF NOT EXISTS idx_trigger_hits_triggered_at
                ON trigger_hits(triggered_at);

            CREATE INDEX IF NOT EXISTS idx_trigger_hits_acknowledged
                ON trigger_hits(acknowledged);

            CREATE INDEX IF NOT EXISTS idx_trigger_hits_expires_at
                ON trigger_hits(expires_at);

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
                updated_at  TEXT DEFAULT (datetime('now'))
            );
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
            # Phase 6: per-rule scan interval (NULL = use global default)
            "ALTER TABLE trigger_rules ADD COLUMN scan_interval_seconds INTEGER",
            # Phase 6.6: news-candle detection method (only used when indicator='news_candle')
            #   one of: 'volume_spike', 'range_spike', 'gap', 'long_wick'
            "ALTER TABLE trigger_rules ADD COLUMN news_candle_method TEXT",
        ]
        for sql in migrations:
            try:
                self._conn.execute(sql)
                self._conn.commit()
                log.info("Migration applied: %s", sql)
            except sqlite3.OperationalError:
                pass  # column already exists — safe to skip

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

    # ── Trigger Rule Operations ──────────────────────────────

    async def get_trigger_rules(self, enabled_only: bool = False) -> list[dict]:
        """
        Get all trigger rules.
        If enabled_only=True, skip paused rules (only return active ones).
        """
        sql = "SELECT * FROM trigger_rules"
        if enabled_only:
            sql += " WHERE enabled = 1"
        sql += " ORDER BY created_at DESC"
        return await asyncio.to_thread(self._fetchall, sql)

    async def get_trigger_rule(self, rule_id: int) -> dict | None:
        """Get a single trigger rule by ID."""
        return await asyncio.to_thread(
            self._fetchone,
            "SELECT * FROM trigger_rules WHERE id = ?",
            (rule_id,),
        )

    async def get_trigger_rules_for_stock(self, conid: int, enabled_only: bool = True) -> list[dict]:
        """Get all trigger rules that apply to a specific stock."""
        sql = "SELECT * FROM trigger_rules WHERE conid = ?"
        if enabled_only:
            sql += " AND enabled = 1"
        return await asyncio.to_thread(self._fetchall, sql, (conid,))

    async def create_trigger_rule(
        self,
        name: str,
        conid: int,
        symbol: str,
        indicator: str,
        condition: str,
        threshold: float,
        target_watchlist: str,
        source_watchlist: str,
        timeframe: str = "1D",
        auto_expire_days: int | None = None,
        scan_interval_seconds: int | None = None,
        news_candle_method: str | None = None,
    ) -> int:
        """
        Create a new trigger rule. Returns the new rule's ID.

        When this trigger fires, the stock is MOVED in IBKR:
          source_watchlist → target_watchlist

        If auto_expire_days is set, the stock automatically moves back
        after that many days. If None, you remove it manually.

        Example: create_trigger_rule(
            name="AAPL EMA 9 Weekly",
            conid=265598,
            symbol="AAPL",
            indicator="ema_9",
            condition="crosses_below",
            threshold=0,
            target_watchlist="EMA 9 Hits",
            source_watchlist="My Stocks",
            timeframe="1W",
            auto_expire_days=5,
        )
        """
        def _insert() -> int:
            cursor = self._execute(
                """INSERT INTO trigger_rules
                   (name, conid, symbol, indicator, condition, threshold, timeframe,
                    target_watchlist, source_watchlist, auto_expire_days,
                    scan_interval_seconds, news_candle_method)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (name, conid, symbol, indicator, condition, threshold, timeframe,
                 target_watchlist, source_watchlist, auto_expire_days,
                 scan_interval_seconds, news_candle_method),
            )
            assert self._conn is not None
            self._conn.commit()
            assert cursor.lastrowid is not None
            return cursor.lastrowid

        return await asyncio.to_thread(_insert)

    async def update_trigger_rule(self, rule_id: int, **fields: Any) -> bool:
        """
        Update one or more fields on a trigger rule.
        Pass only the fields you want to change as keyword arguments.

        Example: update_trigger_rule(5, threshold=25.0, enabled=False)
        """
        allowed = {"name", "conid", "symbol", "indicator", "condition",
                    "threshold", "timeframe", "target_watchlist",
                    "source_watchlist", "auto_expire_days", "enabled",
                    "scan_interval_seconds", "news_candle_method"}
        updates = {k: v for k, v in fields.items() if k in allowed}
        if not updates:
            return False

        def _update() -> bool:
            parts = [f"{k} = ?" for k in updates]
            parts.append("updated_at = datetime('now')")
            values = list(updates.values()) + [rule_id]
            cursor = self._execute(
                f"UPDATE trigger_rules SET {', '.join(parts)} WHERE id = ?",
                tuple(values),
            )
            assert self._conn is not None
            self._conn.commit()
            return cursor.rowcount > 0

        return await asyncio.to_thread(_update)

    async def delete_trigger_rule(self, rule_id: int) -> bool:
        """Delete a trigger rule (and its hit history via CASCADE)."""
        def _delete() -> bool:
            cursor = self._execute(
                "DELETE FROM trigger_rules WHERE id = ?", (rule_id,)
            )
            assert self._conn is not None
            self._conn.commit()
            return cursor.rowcount > 0

        return await asyncio.to_thread(_delete)

    # ── Trigger Hit Operations ───────────────────────────────

    async def record_trigger_hit(
        self,
        rule_id: int,
        conid: int,
        symbol: str,
        indicator: str,
        condition: str,
        threshold: float,
        actual_value: float,
        target_watchlist: str,
        source_watchlist: str,
        auto_expire_days: int | None = None,
    ) -> int | None:
        """
        Record that a trigger rule fired. Returns the hit ID,
        or None if this exact condition was already recorded (deduplicated).

        The dedup_key is built from: rule_id + conid + ET-date.
        This means the same rule can only fire once per stock per ET market day.

        NOTE — same-day re-fire after auto-move-back is intentionally blocked:
        if a 1-day auto-expire returns the stock and the condition still holds,
        the rule will NOT re-fire until the next ET market day. This prevents
        a tight condition from hammering IBKR watchlists intra-day.

        If auto_expire_days is set, calculates expires_at so the
        background scanner knows when to move the stock back.
        """
        # Use Eastern Time date so the dedup window aligns with US market days,
        # not UTC midnight (which falls mid-session at 19:00 ET).
        today = datetime.now(_ET).strftime("%Y-%m-%d")
        dedup_key = f"{rule_id}:{conid}:{today}"

        # Calculate expiry if auto_expire_days is set
        expires_at: str | None = None
        if auto_expire_days is not None:
            from datetime import timedelta
            expires_at = (datetime.now(timezone.utc) + timedelta(days=auto_expire_days)).strftime(
                "%Y-%m-%d %H:%M:%S"
            )

        def _insert() -> int | None:
            try:
                cursor = self._execute(
                    """INSERT INTO trigger_hits
                       (rule_id, conid, symbol, indicator, condition, threshold,
                        actual_value, target_watchlist, source_watchlist, expires_at, dedup_key)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (rule_id, conid, symbol, indicator, condition, threshold,
                     actual_value, target_watchlist, source_watchlist, expires_at, dedup_key),
                )
                assert self._conn is not None
                self._conn.commit()
                return cursor.lastrowid
            except sqlite3.IntegrityError:
                # Duplicate — this trigger already fired for this stock today
                return None

        return await asyncio.to_thread(_insert)

    async def get_trigger_hits(
        self,
        limit: int = 50,
        unacknowledged_only: bool = False,
    ) -> list[dict]:
        """
        Get recent trigger hits (newest first).
        If unacknowledged_only=True, only return hits the user hasn't seen yet.

        SQLite stores booleans as INTEGER (0/1). We cast acknowledged and
        moved_back to Python bool here so callers see consistent types.
        """
        # LEFT JOIN so hits survive if their rule was later deleted.
        sql = (
            "SELECT h.*, r.name AS rule_name "
            "FROM trigger_hits h "
            "LEFT JOIN trigger_rules r ON r.id = h.rule_id"
        )
        if unacknowledged_only:
            sql += " WHERE h.acknowledged = 0"
        sql += " ORDER BY h.triggered_at DESC LIMIT ?"
        rows = await asyncio.to_thread(self._fetchall, sql, (limit,))
        for row in rows:
            row["acknowledged"] = bool(row.get("acknowledged", 0))
            row["moved_back"] = bool(row.get("moved_back", 0))
        return rows

    async def get_trigger_hits_for_rule(self, rule_id: int, limit: int = 20) -> list[dict]:
        """Get recent hits for a specific rule."""
        return await asyncio.to_thread(
            self._fetchall,
            "SELECT * FROM trigger_hits WHERE rule_id = ? ORDER BY triggered_at DESC LIMIT ?",
            (rule_id, limit),
        )

    async def get_expired_hits(self) -> list[dict]:
        """
        Get trigger hits where auto-expire has passed and the stock
        hasn't been moved back yet. The background scanner uses this
        to know which stocks to return to their source watchlist.
        """
        return await asyncio.to_thread(
            self._fetchall,
            """SELECT * FROM trigger_hits
               WHERE expires_at IS NOT NULL
               AND expires_at <= datetime('now')
               AND moved_back = 0
               ORDER BY expires_at""",
        )

    async def mark_moved_back(self, hit_id: int) -> bool:
        """
        Mark a trigger hit as "moved back" — the stock has been
        returned to its source watchlist after auto-expire.
        """
        def _mark() -> bool:
            cursor = self._execute(
                "UPDATE trigger_hits SET moved_back = 1 WHERE id = ?",
                (hit_id,),
            )
            assert self._conn is not None
            self._conn.commit()
            return cursor.rowcount > 0

        return await asyncio.to_thread(_mark)

    async def acknowledge_trigger_hit(self, hit_id: int) -> bool:
        """Mark a trigger hit as seen/read by the user."""
        def _ack() -> bool:
            cursor = self._execute(
                "UPDATE trigger_hits SET acknowledged = 1 WHERE id = ?",
                (hit_id,),
            )
            assert self._conn is not None
            self._conn.commit()
            return cursor.rowcount > 0

        return await asyncio.to_thread(_ack)

    async def acknowledge_all_hits(self) -> int:
        """Mark ALL unread trigger hits as acknowledged. Returns count."""
        def _ack_all() -> int:
            cursor = self._execute(
                "UPDATE trigger_hits SET acknowledged = 1 WHERE acknowledged = 0"
            )
            assert self._conn is not None
            self._conn.commit()
            return cursor.rowcount

        return await asyncio.to_thread(_ack_all)

    # ── Settings Operations ──────────────────────────────────

    async def get_setting(self, key: str, default: str | None = None) -> str | None:
        """
        Get a single setting value by key.
        Returns the default if the key doesn't exist.
        """
        row = await asyncio.to_thread(
            self._fetchone,
            "SELECT value FROM settings WHERE key = ?",
            (key,),
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

        await asyncio.to_thread(_upsert)

    async def delete_setting(self, key: str) -> bool:
        """Delete a setting. Returns True if it existed."""
        def _delete() -> bool:
            cursor = self._execute(
                "DELETE FROM settings WHERE key = ?", (key,)
            )
            assert self._conn is not None
            self._conn.commit()
            return cursor.rowcount > 0

        return await asyncio.to_thread(_delete)

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

        await asyncio.to_thread(_upsert)

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

        return await asyncio.to_thread(_delete)

    # ── Instrument Cache Operations ────────────────────────────
    #
    # Hub integration: This is the ONLY table that other Hub modules
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

        This is the ONLY write path — other Hub modules don't call this.
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

        await asyncio.to_thread(_upsert)

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

        return await asyncio.to_thread(_insert)

    async def delete_locked_fib(self, lock_id: int) -> bool:
        """Unlock (delete) a locked fib by its row ID."""
        def _delete() -> bool:
            cursor = self._execute(
                "DELETE FROM locked_fibonacci_drawings WHERE id = ?", (lock_id,)
            )
            assert self._conn is not None
            self._conn.commit()
            return cursor.rowcount > 0

        return await asyncio.to_thread(_delete)

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

    # ── Pulse Config Operations (Phase 8.9+) ─────────────────

    async def get_pulse_config(self) -> list[dict]:
        """
        Return all pulse-bar items in display order (left → right).

        Each row is a plain dict: {position, label, resolve}.
        If the table is empty (first run before seed), returns [].
        """
        return await asyncio.to_thread(
            self._fetchall,
            "SELECT position, label, resolve FROM pulse_config ORDER BY position ASC",
        )

    async def replace_pulse_config(self, items: list[tuple[str, str]]) -> None:
        """
        Replace the entire pulse-bar config atomically.

        `items` is a list of (label, resolve) tuples in the desired display
        order. Positions are re-indexed from 0 on every write so the caller
        never has to think about holes. We run DELETE + INSERT inside one
        transaction so a failure mid-write can't leave the bar empty.
        """
        def _replace() -> None:
            assert self._conn is not None
            try:
                self._conn.execute("BEGIN")
                self._conn.execute("DELETE FROM pulse_config")
                self._conn.executemany(
                    "INSERT INTO pulse_config (position, label, resolve) VALUES (?, ?, ?)",
                    [(i, label, resolve) for i, (label, resolve) in enumerate(items)],
                )
                self._conn.commit()
            except sqlite3.Error:
                self._conn.rollback()
                raise

        await asyncio.to_thread(_replace)

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
