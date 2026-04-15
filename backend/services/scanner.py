"""
Background scanner service — periodic trigger evaluation.

Startup behaviour
-----------------
The scanner does NOT start immediately. It waits until IBKR is authenticated
(polling ibkr.state.authenticated every 5 s), then waits an additional 15 s
to let the session fully settle before making any market-data calls.

Per-rule scan intervals
-----------------------
Each trigger rule carries an optional scan_interval_seconds field.
  - NULL / None  →  use the global default (settings key "scan_interval_seconds", default 300 s)
  - Integer      →  check this specific rule every N seconds

The scanner loop runs on a fixed 60-second heartbeat.  On every tick it
evaluates only the rules whose individual interval has elapsed since their
last check.  This means:

  Rule A: interval=300 s → evaluated every 5 ticks
  Rule B: interval=60 s  → evaluated every tick
  Rule C: interval=None  → evaluated every <global-default> seconds

Groups are formed per-tick from the subset of "due" rules only, so a
single IBKR history call is still shared by all due rules on the same
(conid, timeframe) pair.

Indicator value semantics (what we compare against the rule threshold):
  - rsi, atr, adx, obv  → latest raw indicator value
  - stoch               → %K value (0–100)
  - macd                → histogram (MACD_line − signal); threshold=0 → "histogram crosses zero"
  - ema_*               → last_close − EMA value; threshold=0 → "price at EMA"
  - vwap                → last_close − VWAP value; threshold=0 → "price at VWAP"
  - bbands              → Bollinger %B = (close − lower) / (upper − lower);
                          %B > 1 = above upper band, %B < 0 = below lower band
  - volume              → raw volume of the last completed bar

Cross conditions (crosses_above / crosses_below) require at least two computed
values.  If the series is too short the condition silently skips that rule.
"""

import asyncio
import logging
import sqlite3
import time
from collections import defaultdict
from typing import Any, Awaitable, Callable

from exceptions import IBKRAuthError, IBKRConnectionError, IBKRRateLimitError, IBKRRequestError
from models import CandleData
from services.db import DatabaseService
from services.ibkr import IBKRService
from services.indicators import IndicatorService

log = logging.getLogger("parallax.scanner")

_indicator_svc = IndicatorService()

# Fixed heartbeat — the loop wakes up every 60 s and checks which rules are due.
# Individual rules can have longer intervals via scan_interval_seconds.
_HEARTBEAT = 60  # seconds

# How long to wait after IBKR auth before making the first scan.
_POST_AUTH_DELAY = 15.0  # seconds

# How often to poll for IBKR auth while waiting.
_AUTH_POLL_INTERVAL = 5.0  # seconds

# Absolute minimum per-rule interval to avoid hammering IBKR.
_MIN_RULE_INTERVAL = 60  # seconds

# Default per-rule interval when both the rule field and global setting are absent.
_DEFAULT_INTERVAL = 300  # 5 minutes

# News candle detection — fixed 20-bar lookback for all averages.
# Anything longer is "regime", anything shorter is too noisy.
_NEWS_CANDLE_LOOKBACK = 20


class ScannerService:
    """
    Background trigger scanner — the heartbeat of the Parallax alert system.

    Lifecycle::

        scanner = ScannerService(ibkr, db)
        scanner.start()       # called in FastAPI lifespan startup
        ...
        await scanner.stop()  # called in FastAPI lifespan shutdown

    The scanner waits for IBKR authentication before it begins work.  No
    market-data calls are made until the session is confirmed live.

    Callbacks::

        async def my_callback(rule: dict, hit_id: int, actual_value: float) -> None: ...
        scanner.on_trigger_fired = my_callback

    Wire this up from ws.py to push real-time alerts to the frontend.
    """

    def __init__(self, ibkr: IBKRService, db: DatabaseService) -> None:
        self.ibkr = ibkr
        self.db = db
        self._task: asyncio.Task | None = None
        self._stop_event = asyncio.Event()
        self._global_interval: int = _DEFAULT_INTERVAL

        # Tracks the monotonic timestamp of the last evaluation per rule_id.
        # On first evaluation the key is absent → rule is always due.
        self._last_evaluated: dict[int, float] = {}

        self._last_run_at: str | None = None
        self._last_hit_count: int = 0
        self._ibkr_wait_started: bool = False

        # Optional async callback — set externally to avoid circular imports.
        # Signature: async (rule: dict, hit_id: int, actual_value: float) -> None
        self.on_trigger_fired: Callable[..., Awaitable[None]] | None = None

    # ── Lifecycle ────────────────────────────────────────────

    def start(self) -> None:
        """Start the background task.  Called once from FastAPI lifespan."""
        if self._task and not self._task.done():
            log.warning("Scanner already running — ignoring duplicate start()")
            return
        self._stop_event.clear()
        self._task = asyncio.create_task(self._run_loop(), name="parallax-scanner")
        log.info("Background scanner started — waiting for IBKR authentication")

    async def stop(self) -> None:
        """Signal the loop to stop and wait for clean shutdown."""
        self._stop_event.set()
        if self._task and not self._task.done():
            try:
                await asyncio.wait_for(self._task, timeout=10.0)
            except asyncio.TimeoutError:
                self._task.cancel()
                log.warning("Scanner task did not stop cleanly — cancelled")
        log.info("Background scanner stopped")

    def status(self) -> dict[str, Any]:
        """Current scanner state — exposed via GET /triggers/scanner/status."""
        running = bool(self._task and not self._task.done())
        return {
            "running": running,
            "heartbeat_seconds": _HEARTBEAT,
            "default_interval_seconds": self._global_interval,
            "last_run_at": self._last_run_at,
            "last_hit_count": self._last_hit_count,
            "waiting_for_auth": self._ibkr_wait_started and not self.ibkr.state.authenticated,
        }

    # ── Main loop ────────────────────────────────────────────

    async def _run_loop(self) -> None:
        """
        Outer loop:
          1. Poll until IBKR is authenticated.
          2. Wait 15 s post-auth to let the session settle.
          3. Run a 60-second heartbeat loop, evaluating only "due" rules each tick.
        """
        # Phase 1: wait for IBKR auth
        self._ibkr_wait_started = True
        authenticated = await self._wait_for_ibkr_auth()
        if not authenticated:
            return  # stop() was called before auth

        log.info("Scanner: IBKR authenticated — first scan in %.0fs", _POST_AUTH_DELAY)

        # Phase 2: post-auth delay
        try:
            await asyncio.wait_for(self._stop_event.wait(), timeout=_POST_AUTH_DELAY)
            return  # stop() called during delay
        except asyncio.TimeoutError:
            pass  # normal path

        # Phase 3: heartbeat loop
        while not self._stop_event.is_set():
            # Refresh global interval from DB settings
            try:
                stored = await self.db.get_setting("scan_interval_seconds")
                if stored:
                    self._global_interval = max(_MIN_RULE_INTERVAL, int(stored))
            except (ValueError, TypeError):
                pass

            # Phase 6.8: return expired hits first so the user sees an
            # accurate picture before the next scan fires new ones.
            await self._return_expired_hits()

            await self._evaluate_due_rules()

            # Wait _HEARTBEAT seconds or until stop() is signalled
            try:
                await asyncio.wait_for(
                    self._stop_event.wait(), timeout=float(_HEARTBEAT)
                )
                break  # stop requested
            except asyncio.TimeoutError:
                pass  # normal tick

    async def _wait_for_ibkr_auth(self) -> bool:
        """
        Poll ibkr.state.authenticated every 5 s until the session is live
        or stop() is called.  Returns True when authenticated, False when stopped.
        """
        while not self._stop_event.is_set():
            if self.ibkr.state.authenticated:
                log.info("Scanner: IBKR session confirmed authenticated")
                return True
            try:
                await asyncio.wait_for(
                    self._stop_event.wait(), timeout=_AUTH_POLL_INTERVAL
                )
                return False  # stop requested while waiting for auth
            except asyncio.TimeoutError:
                pass  # keep polling
        return False

    # ── Rule filtering: which rules are "due" this tick ─────

    def _rule_is_due(self, rule: dict) -> bool:
        """
        Return True if enough time has passed since this rule was last evaluated.

        Interval resolution order:
          1. rule["scan_interval_seconds"]  (per-rule override)
          2. self._global_interval          (from DB setting, default 300 s)
        """
        rule_id = rule["id"]
        interval = rule.get("scan_interval_seconds")
        if interval is None:
            interval = self._global_interval
        interval = max(_MIN_RULE_INTERVAL, int(interval))

        last = self._last_evaluated.get(rule_id)
        if last is None:
            return True  # never evaluated → always due
        return (time.monotonic() - last) >= interval

    def _mark_evaluated(self, rule_ids: list[int]) -> None:
        """Record the current time as the last-evaluation timestamp for these rules."""
        now = time.monotonic()
        for rule_id in rule_ids:
            self._last_evaluated[rule_id] = now

    # ── Evaluation entry point ───────────────────────────────

    async def _evaluate_due_rules(self) -> None:
        """
        Load all enabled rules, filter to those that are "due", then evaluate them
        in batches grouped by (conid, timeframe).
        """
        from datetime import datetime, timezone

        try:
            all_rules = await self.db.get_trigger_rules(enabled_only=True)
        except sqlite3.Error as exc:
            log.error("Scanner: DB error loading trigger rules: %s", exc)
            return

        due_rules = [r for r in all_rules if self._rule_is_due(r)]
        if not due_rules:
            log.debug("Scanner: no rules due this tick")
            return

        log.info(
            "Scanner: %d/%d rule(s) due this tick",
            len(due_rules), len(all_rules),
        )

        # Group due rules by conid — one IBKR history call per instrument.
        # The scanner always fetches 3-month daily bars regardless of the rule's
        # stored timeframe (which reflects the user's chart view, not the eval
        # frequency). Grouping by timeframe would split a single IBKR call into
        # multiple without any benefit.
        groups: dict[int, list[dict]] = defaultdict(list)
        for rule in due_rules:
            groups[int(rule["conid"])].append(rule)

        hit_count = 0
        evaluated_ids: list[int] = []

        for conid, group_rules in groups.items():
            try:
                hits = await self._evaluate_group(conid, group_rules)
                hit_count += hits
                evaluated_ids.extend(r["id"] for r in group_rules)
            except (IBKRAuthError, IBKRConnectionError) as exc:
                log.warning(
                    "IBKR unavailable during scan (%s) — aborting this tick", exc.message
                )
                break  # don't mark these rules as evaluated; retry next tick
            except IBKRRateLimitError:
                log.warning("Rate limited on conid %d — skipping this group", conid)
                # Still mark as evaluated so we don't immediately retry
                evaluated_ids.extend(r["id"] for r in group_rules)
            except IBKRRequestError as exc:
                log.warning("IBKR error for conid %d (%s) — skipping", conid, exc.message)
                evaluated_ids.extend(r["id"] for r in group_rules)
            except (ValueError, TypeError, KeyError, IndexError) as exc:
                log.error("Data error evaluating conid %d: %s", conid, exc)
                evaluated_ids.extend(r["id"] for r in group_rules)
            except sqlite3.Error as exc:
                log.error("DB error evaluating conid %d: %s", conid, exc)
                evaluated_ids.extend(r["id"] for r in group_rules)

        self._mark_evaluated(evaluated_ids)

        self._last_run_at = datetime.now(timezone.utc).isoformat()
        self._last_hit_count = hit_count
        if evaluated_ids:
            log.info(
                "Scanner: tick complete — %d rule(s) evaluated, %d new hit(s)",
                len(evaluated_ids), hit_count,
            )

    # ── Group evaluation ─────────────────────────────────────

    async def _evaluate_group(
        self,
        conid: int,
        rules: list[dict],
    ) -> int:
        """
        Evaluate all rules for one conid.
        Returns the number of new hits recorded.

        news_candle rules are a separate family — they don't use the IndicatorService
        and they fire on a single bar event rather than a crossover/threshold.
        They share the same fetched candle series as indicator rules.

        The scanner always evaluates on 3-month daily bars regardless of the
        rule's stored timeframe (which is the user's chart view, not the eval
        resolution). One IBKR history call serves all rules for this conid.
        """
        candles = await self._fetch_candles(conid)
        if len(candles) < 2:
            log.debug(
                "Scanner: not enough bars for conid %d (got %d)",
                conid, len(candles),
            )
            return 0

        # Split rules into standard indicators vs news_candle
        indicator_rules = [r for r in rules if r["indicator"] != "news_candle"]
        news_rules = [r for r in rules if r["indicator"] == "news_candle"]

        new_hits = 0

        # ── Standard indicator rules ─────────────────────────
        if indicator_rules:
            needed_indicators = {rule["indicator"] for rule in indicator_rules}
            indicator_results, _ = _indicator_svc.compute(
                candles=candles,
                indicators=list(needed_indicators),
            )
            results_by_name: dict[str, Any] = {r.name: r for r in indicator_results}
            last_close = candles[-1].close
            last_volume = float(candles[-1].volume)

            for rule in indicator_rules:
                indicator = rule["indicator"]
                condition = rule["condition"]
                threshold = float(rule["threshold"])

                try:
                    prev_val, curr_val = self._extract_values(
                        indicator, results_by_name, last_close, last_volume, candles
                    )
                except (KeyError, IndexError, ValueError, TypeError) as exc:
                    log.debug(
                        "Scanner: value extraction failed for rule %d (%s/%s): %s",
                        rule["id"], indicator, conid, exc,
                    )
                    continue

                if curr_val is None:
                    continue

                if not self._check_condition(prev_val, curr_val, condition, threshold):
                    continue

                log.info(
                    "Trigger FIRED: rule_id=%d  %s  %s %s %.4f  (actual=%.4f)",
                    rule["id"], rule["symbol"], indicator, condition, threshold, curr_val,
                )
                recorded = await self._record_hit(rule, actual_value=curr_val)
                if recorded:
                    new_hits += 1

        # ── News candle rules ─────────────────────────────────
        for rule in news_rules:
            method = rule.get("news_candle_method")
            threshold = float(rule["threshold"])
            try:
                actual = self._evaluate_news_candle(method, candles)
            except (ValueError, KeyError, IndexError, TypeError) as exc:
                log.debug(
                    "Scanner: news_candle eval failed for rule %d (%s): %s",
                    rule["id"], method, exc,
                )
                continue

            if actual is None or actual < threshold:
                continue

            log.info(
                "Trigger FIRED: rule_id=%d  %s  news_candle/%s >= %.4f  (actual=%.4f)",
                rule["id"], rule["symbol"], method, threshold, actual,
            )
            recorded = await self._record_hit(rule, actual_value=actual)
            if recorded:
                new_hits += 1

        return new_hits

    # ── News candle detection ────────────────────────────────

    @staticmethod
    def _evaluate_news_candle(
        method: str | None,
        candles: list[CandleData],
    ) -> float | None:
        """
        Compute the news-candle metric for the last bar using a 20-bar lookback.

        Methods:
          - volume_spike: last.volume / avg(prev 20 volumes)     (multiplier, e.g. 3.0)
          - range_spike: (high-low) / avg(prev 20 ranges)        (multiplier, e.g. 2.5)
          - gap:         |open - prev.close| / prev.close * 100  (percentage, e.g. 2.0)
          - long_wick:   max(upper_wick, lower_wick) / body      (ratio, e.g. 3.0)

        Returns the metric value for the LAST bar, or None if unable to compute.
        The caller compares this against the rule threshold with "fires when >=".
        """
        if not method or len(candles) < 2:
            return None

        last = candles[-1]

        if method == "volume_spike":
            if len(candles) < _NEWS_CANDLE_LOOKBACK + 1:
                return None
            window = candles[-_NEWS_CANDLE_LOOKBACK - 1:-1]
            avg_vol = sum(c.volume for c in window) / len(window)
            if avg_vol <= 0:
                return None
            return float(last.volume) / avg_vol

        if method == "range_spike":
            if len(candles) < _NEWS_CANDLE_LOOKBACK + 1:
                return None
            window = candles[-_NEWS_CANDLE_LOOKBACK - 1:-1]
            avg_range = sum((c.high - c.low) for c in window) / len(window)
            if avg_range <= 0:
                return None
            return float(last.high - last.low) / avg_range

        if method == "gap":
            prev = candles[-2]
            if prev.close == 0:
                return None
            return abs(last.open - prev.close) / prev.close * 100.0

        if method == "long_wick":
            body = abs(last.close - last.open)
            if body == 0:
                return None
            upper_wick = last.high - max(last.open, last.close)
            lower_wick = min(last.open, last.close) - last.low
            return max(upper_wick, lower_wick) / body

        log.warning("Scanner: unknown news_candle_method '%s' — skipping", method)
        return None

    # ── Indicator value extraction ───────────────────────────

    def _extract_values(
        self,
        indicator: str,
        results: dict[str, Any],
        last_close: float,
        last_volume: float,
        candles: list[CandleData],
    ) -> tuple[float | None, float | None]:
        """
        Return (previous_value, current_value) ready for condition evaluation.

        Two values are returned so crossover conditions can detect sign changes
        between the last two data points.  If there is only one point prev=None
        (crossover conditions will return False — not enough history).

        See module docstring for per-indicator semantics.
        """
        if indicator == "volume":
            prev = float(candles[-2].volume) if len(candles) >= 2 else None
            return prev, last_volume

        result = results.get(indicator)
        if result is None or not result.values:
            return None, None

        vals = result.values

        def _scalar(entry: Any) -> float | None:
            """Extract the primary comparable float from one IndicatorValue."""
            if entry is None:
                return None

            if indicator == "macd":
                # Use histogram (MACD − signal) so threshold=0 means
                # "histogram crosses zero" = MACD crosses its signal line.
                return entry.histogram if entry.histogram is not None else entry.value

            if indicator == "stoch":
                return entry.value  # %K line (0–100)

            if indicator.startswith("ema_"):
                # Price relative to EMA; threshold=0 → "price at EMA level"
                if entry.value is None:
                    return None
                return last_close - entry.value

            if indicator == "vwap":
                # Price relative to VWAP; threshold=0 → "price at VWAP"
                if entry.value is None:
                    return None
                return last_close - entry.value

            if indicator == "bbands":
                # Bollinger %B = (close − lower) / (upper − lower)
                # %B > 1.0 = above upper band, %B < 0.0 = below lower band
                upper = entry.upper
                lower = entry.lower
                if upper is None or lower is None:
                    return None
                band_width = upper - lower
                if band_width == 0:
                    return None
                return (last_close - lower) / band_width

            # Default: use the plain .value field (rsi, atr, adx, obv)
            return entry.value

        curr = _scalar(vals[-1])
        prev = _scalar(vals[-2]) if len(vals) >= 2 else None
        return prev, curr

    # ── Condition evaluation ─────────────────────────────────

    @staticmethod
    def _check_condition(
        prev: float | None,
        curr: float,
        condition: str,
        threshold: float,
    ) -> bool:
        """
        Evaluate a trigger condition against the extracted values.

            above         → curr > threshold
            below         → curr < threshold
            crosses_above → prev was ≤ threshold AND curr is > threshold
            crosses_below → prev was ≥ threshold AND curr is < threshold
        """
        if condition == "above":
            return curr > threshold
        if condition == "below":
            return curr < threshold
        if condition == "crosses_above":
            if prev is None:
                return False
            return prev <= threshold < curr
        if condition == "crosses_below":
            if prev is None:
                return False
            return prev >= threshold > curr
        log.warning("Scanner: unknown trigger condition '%s' — skipping", condition)
        return False

    # ── IBKR data fetch ──────────────────────────────────────

    async def _fetch_candles(self, conid: int) -> list[CandleData]:
        """
        Fetch OHLCV history for trigger evaluation.

        Always uses 3-month daily bars — enough history for all indicators
        including the slow EMA-200.  The stored timeframe field is used to
        determine which chart view the user is trading on, but the scanner
        always evaluates on daily bars so one history call serves all rules.
        """
        raw = await self.ibkr.history(conid, period="3m", bar="1d")
        bars = raw.get("data", [])
        return [
            CandleData(
                time=bar["t"] // 1000,
                open=float(bar["o"]),
                high=float(bar["h"]),
                low=float(bar["l"]),
                close=float(bar["c"]),
                volume=float(bar.get("v", 0)),
            )
            for bar in bars
            if "t" in bar
        ]

    # ── Hit recording ────────────────────────────────────────

    # ── Auto-expire return (Phase 6.8) ───────────────────────

    async def _return_expired_hits(self) -> None:
        """
        Find trigger hits whose expiry has passed and move their stock back to
        the original source watchlist (target → source — the reverse of the
        firing move). Runs once per heartbeat before evaluating due rules.

        Errors per-hit are logged and swallowed so one broken watchlist doesn't
        stop the rest from returning. Only on a successful IBKR move do we flip
        moved_back=1 — that way a transient IBKR failure will just be retried
        on the next heartbeat.
        """
        try:
            expired = await self.db.get_expired_hits()
        except sqlite3.Error as exc:
            log.error("get_expired_hits DB error: %s", exc)
            return

        for hit in expired:
            hit_id = hit.get("id")
            conid = hit.get("conid")
            source = hit.get("source_watchlist")
            target = hit.get("target_watchlist")
            if hit_id is None or conid is None or not source or not target:
                log.warning("Expired hit %s missing fields — skipping", hit_id)
                continue

            try:
                await self.ibkr.move_between_watchlists(
                    conid=int(conid),
                    source_name=target,     # reverse: move BACK from target
                    target_name=source,     # to the original source watchlist
                )
            except IBKRRequestError as exc:
                if exc.status_code == 404:
                    # Watchlist was renamed or deleted — stop retrying by marking done.
                    log.warning(
                        "Auto-expire: watchlist not found for hit %s (%s → %s) — "
                        "marking moved_back to stop retrying",
                        hit_id, target, source,
                    )
                else:
                    log.error(
                        "Auto-expire move failed for hit %s (conid %s, %s → %s): %s — "
                        "will retry next tick",
                        hit_id, conid, target, source, exc.detail,
                    )
                    continue
            except (IBKRAuthError, IBKRConnectionError) as exc:
                log.warning(
                    "Auto-expire: IBKR unavailable (%s) — aborting expire pass this tick",
                    exc.message,
                )
                return  # don't partially process; retry whole pass next tick
            except IBKRRateLimitError:
                log.warning("Auto-expire: rate limited — aborting expire pass this tick")
                return

            try:
                await self.db.mark_moved_back(int(hit_id))
            except sqlite3.Error as exc:
                log.error(
                    "mark_moved_back DB error for hit %s after successful IBKR move: %s",
                    hit_id, exc,
                )

    async def _resolve_expire_days(self, rule: dict) -> int | None:
        """
        Decide how many days to auto-expire a hit that's about to be recorded.

        Priority (Phase 6.8):
          1. watchlist_config[target_watchlist].auto_expire_days — the per-target
             override wins if a row exists, even when its value is NULL (that
             explicitly means "no expiry for this watchlist").
          2. rule["auto_expire_days"]                            — per-rule fallback.
        """
        target = rule.get("target_watchlist")
        if target:
            try:
                cfg = await self.db.get_watchlist_config(target)
            except sqlite3.Error as exc:
                log.warning(
                    "watchlist_config DB lookup failed for '%s': %s — falling back to rule",
                    target, exc,
                )
                cfg = None
            if cfg is not None:
                return cfg.get("auto_expire_days")
        return rule.get("auto_expire_days")

    async def _record_hit(self, rule: dict, actual_value: float) -> bool:
        """
        Persist a trigger hit and execute the associated watchlist move.

        Steps:
          1. Resolve effective auto_expire_days (watchlist override > rule).
          2. Write the hit to SQLite with dedup guard (one hit per rule per day).
          3. If new (not a duplicate), move the stock in IBKR:
               source_watchlist → target_watchlist
          4. Fire the on_trigger_fired callback (used for WS push to frontend).

        Returns True if a new hit was recorded, False if deduplicated.
        IBKR errors on the watchlist move are logged but do NOT abort the scanner.
        """
        effective_expire_days = await self._resolve_expire_days(rule)

        hit_id = await self.db.record_trigger_hit(
            rule_id=rule["id"],
            conid=rule["conid"],
            symbol=rule["symbol"],
            indicator=rule["indicator"],
            condition=rule["condition"],
            threshold=float(rule["threshold"]),
            actual_value=actual_value,
            target_watchlist=rule["target_watchlist"],
            source_watchlist=rule["source_watchlist"],
            auto_expire_days=effective_expire_days,
        )

        if hit_id is None:
            log.debug("Rule %d already fired today (dedup) — skipped", rule["id"])
            return False

        # ── IBKR watchlist move (Phase 6.3) ─────────────────
        # Move the stock from source_watchlist → target_watchlist.
        # Errors here are non-fatal — the hit is already recorded in SQLite,
        # so the user can still see the alert even if the IBKR move fails.
        try:
            await self.ibkr.move_between_watchlists(
                conid=int(rule["conid"]),
                source_name=rule["source_watchlist"],
                target_name=rule["target_watchlist"],
            )
        except (IBKRAuthError, IBKRConnectionError, IBKRRateLimitError, IBKRRequestError) as exc:
            log.error(
                "Watchlist move failed for rule %d (conid %d): %s — "
                "hit recorded but stock not moved in IBKR",
                rule["id"], rule["conid"], exc.message if hasattr(exc, "message") else exc,
            )

        if self.on_trigger_fired:
            try:
                await self.on_trigger_fired(rule, hit_id, actual_value)
            except Exception as exc:  # noqa: BLE001 — callback errors must never crash the scanner
                log.error("on_trigger_fired callback raised: %s", exc, exc_info=True)

        return True
