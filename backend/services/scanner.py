"""
Background scanner service — periodic trigger evaluation (multi-condition edition).

Startup behaviour
-----------------
The scanner does NOT start immediately. It waits until IBKR is authenticated
(polling ibkr.state.authenticated every 5 s), then waits an additional 15 s
to let the session fully settle before making any market-data calls.

Per-rule scan intervals
-----------------------
Each trigger rule carries a scan_interval_seconds field. On every heartbeat
tick the scanner checks which rules are due (next-eval time has elapsed)
and evaluates only those.

Rule evaluation
---------------
A rule has 1+ conditions, evaluated against the latest bar of OHLCV data.
A rule fires only when EVERY condition passes. Each condition compares an
indicator value against a threshold using one of:
  above | below | crosses_above | crosses_below | fires

Scope: a rule either targets a single conid (per-stock) OR expands to the
members of an IBKR watchlist (watchlist-scoped). The scanner fans out
per-target inside `_evaluate_one`.

Indicator value semantics (what we feed into the bar dict):
  - rsi, atr, adx, obv          → raw indicator value
  - stoch                       → %K value (0–100)
  - macd                        → histogram (MACD_line − signal); threshold=0 → cross
  - ema_*                       → last_close − EMA value; threshold=0 → "price at EMA"
  - vwap                        → last_close − VWAP value; threshold=0 → "price at VWAP"
  - bbands                      → Bollinger %B = (close − lower) / (upper − lower)
  - volume                      → raw volume of the last completed bar
  - news_candle                 → 1.0 if the chosen detection method fires for the bar

For crosses_above / crosses_below we also stash the previous-bar value under
`bar[f"{indicator}_prev"]`. If the series is too short the cross conditions
return False (insufficient history).
"""

import asyncio
import logging
import math
import sqlite3
import time
from typing import Any, Awaitable, Callable

from exceptions import IBKRAuthError, IBKRConnectionError, IBKRRateLimitError, IBKRRequestError
from models import CandleData
from services.db import DatabaseService
from services.ibkr import IBKRService
from services.indicators import IndicatorService

log = logging.getLogger("parallax.scanner")

_indicator_svc = IndicatorService()

# Fixed heartbeat — the loop wakes up every 60 s and checks which rules are due.
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
_NEWS_CANDLE_LOOKBACK = 20

# Indicators that are derived from raw OHLCV directly without IndicatorService.
_RAW_BAR_FIELDS = {"close", "open", "high", "low", "volume"}


class ScannerService:
    """
    Background trigger scanner — the heartbeat of the Parallax alert system.

    Lifecycle::

        scanner = ScannerService(ibkr, db)
        scanner.start()       # called in FastAPI lifespan startup
        ...
        await scanner.stop()  # called in FastAPI lifespan shutdown

    Callback::

        async def cb(hit_id: int, rule: dict, target: dict,
                     condition_values: list[dict]) -> None: ...
        scanner.on_trigger_fired = cb
    """

    def __init__(self, ibkr: IBKRService, db: DatabaseService) -> None:
        self.ibkr = ibkr
        self.db = db
        self._task: asyncio.Task | None = None
        self._stop_event = asyncio.Event()
        self._global_interval: int = _DEFAULT_INTERVAL

        # rule_id → unix-time (time.time) when this rule next becomes due.
        # Missing key = always due.
        self._rule_state: dict[int, float] = {}

        self._last_run_at: str | None = None
        self._last_hit_count: int = 0
        self._ibkr_wait_started: bool = False

        # Optional async callback — set externally to avoid circular imports.
        # New signature: async (hit_id, rule, target, condition_values).
        self.on_trigger_fired: Callable[..., Awaitable[None]] | None = None

    # ── Lifecycle ────────────────────────────────────────────

    def start(self) -> None:
        """Start the background task. Called once from FastAPI lifespan."""
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
        self._ibkr_wait_started = True
        authenticated = await self._wait_for_ibkr_auth()
        if not authenticated:
            return

        log.info("Scanner: IBKR authenticated — first scan in %.0fs", _POST_AUTH_DELAY)

        try:
            await asyncio.wait_for(self._stop_event.wait(), timeout=_POST_AUTH_DELAY)
            return
        except asyncio.TimeoutError:
            pass

        while not self._stop_event.is_set():
            try:
                stored = await self.db.get_setting("scan_interval_seconds")
                if stored:
                    self._global_interval = max(_MIN_RULE_INTERVAL, int(stored))
            except (ValueError, TypeError):
                pass

            await self._return_expired_hits()
            await self._evaluate_due_rules()

            try:
                await asyncio.wait_for(
                    self._stop_event.wait(), timeout=float(_HEARTBEAT)
                )
                break
            except asyncio.TimeoutError:
                pass

    async def _wait_for_ibkr_auth(self) -> bool:
        """Poll ibkr.state.authenticated until live or stop() is called."""
        while not self._stop_event.is_set():
            if self.ibkr.state.authenticated:
                log.info("Scanner: IBKR session confirmed authenticated")
                return True
            try:
                await asyncio.wait_for(
                    self._stop_event.wait(), timeout=_AUTH_POLL_INTERVAL
                )
                return False
            except asyncio.TimeoutError:
                pass
        return False

    # ── Evaluation entry point ───────────────────────────────

    def _resolve_interval(self, rule: dict) -> int:
        interval = rule.get("scan_interval_seconds")
        if interval is None:
            interval = self._global_interval
        return max(_MIN_RULE_INTERVAL, int(interval))

    async def _evaluate_due_rules(self) -> None:
        """Load enabled rules, evaluate those whose next-eval time has elapsed."""
        from datetime import datetime, timezone

        try:
            all_rules = await self.db.get_trigger_rules(enabled_only=True)
        except sqlite3.Error as exc:
            log.error("Scanner: DB error loading trigger rules: %s", exc)
            return

        now = time.time()
        due = [r for r in all_rules if self._rule_state.get(r["id"], 0.0) <= now]
        if not due:
            log.debug("Scanner: no rules due this tick")
            return

        log.info(
            "Scanner: %d/%d rule(s) due this tick",
            len(due), len(all_rules),
        )

        hit_count = 0
        for rule in due:
            try:
                hit_count += await self._evaluate_one(rule)
            except (IBKRAuthError, IBKRConnectionError) as exc:
                log.warning(
                    "IBKR unavailable during scan (%s) — aborting this tick", exc.message
                )
                # Don't bump next-due time so we retry promptly on the next tick.
                break
            except IBKRRateLimitError:
                log.warning("Rate limited evaluating rule %s — skipping", rule["id"])
            except IBKRRequestError as exc:
                log.warning(
                    "IBKR error for rule %s (%s) — skipping",
                    rule["id"], exc.message,
                )
            except (ValueError, TypeError, KeyError, IndexError) as exc:
                log.error("Data error evaluating rule %s: %s", rule["id"], exc)
            except sqlite3.Error as exc:
                log.error("DB error evaluating rule %s: %s", rule["id"], exc)
            except Exception:  # noqa: BLE001 — defensive: one bad rule must not kill loop
                log.exception("rule %s eval failed", rule["id"])
            finally:
                self._rule_state[rule["id"]] = now + self._resolve_interval(rule)

        self._last_run_at = datetime.now(timezone.utc).isoformat()
        self._last_hit_count = hit_count
        if due:
            log.info(
                "Scanner: tick complete — %d rule(s) evaluated, %d new hit(s)",
                len(due), hit_count,
            )

    async def _evaluate_one(self, rule: dict) -> int:
        """
        Evaluate a single rule across its scope targets.
        Returns the count of new (non-deduped) hits recorded.
        """
        targets = await self._scope_targets(rule)
        if not targets:
            return 0

        new_hits = 0
        for tgt in targets:
            try:
                bar = await self._fetch_evaluation_bar(tgt["conid"], rule)
            except (IBKRAuthError, IBKRConnectionError, IBKRRateLimitError):
                # Propagate so the loop's per-rule handler decides what to do.
                raise
            except IBKRRequestError as exc:
                log.debug(
                    "fetch_evaluation_bar: IBKR error for conid %s rule %s: %s",
                    tgt["conid"], rule["id"], exc.message,
                )
                continue
            except (ValueError, TypeError, KeyError, IndexError) as exc:
                log.debug(
                    "fetch_evaluation_bar: data error for conid %s rule %s: %s",
                    tgt["conid"], rule["id"], exc,
                )
                continue

            if not bar:
                continue

            result = self._evaluate_conditions(rule, bar)
            if not result["fires"]:
                continue

            recorded = await self._record_hit(rule, tgt, result["values"])
            if recorded:
                new_hits += 1
        return new_hits

    # ── Scope expansion ──────────────────────────────────────

    async def _scope_targets(self, rule: dict) -> list[dict]:
        """
        Turn a rule into the list of {conid, symbol} targets to evaluate.

        Watchlist-scoped rules expand to current IBKR members.
        Per-stock rules become a single-element list with their own conid.
        """
        if rule.get("watchlist_name"):
            members = await self.ibkr.get_watchlist_members(rule["watchlist_name"])
            return [
                {"conid": m["conid"], "symbol": m.get("symbol", "")}
                for m in members
            ]
        if rule.get("conid"):
            return [{"conid": rule["conid"], "symbol": rule.get("symbol", "")}]
        return []

    # ── Condition evaluation ─────────────────────────────────

    def _evaluate_conditions(self, rule: dict, bar: dict) -> dict:
        """
        Evaluate every condition in a rule against the latest bar.
        Returns: {"fires": bool, "values": [...]}.
        Fires only when EVERY condition passes.
        """
        values: list[dict] = []
        all_pass = True
        for cond in rule.get("conditions", []):
            ind = cond["indicator"]
            op = cond["condition"]
            thr = cond.get("threshold")
            actual = bar.get(ind)
            if actual is None:
                all_pass = False
                values.append({
                    "indicator": ind,
                    "condition": op,
                    "threshold": thr,
                    "actual_value": float("nan"),
                    "news_candle_method": cond.get("news_candle_method"),
                })
                continue
            passed = _passes(op, float(actual), thr, prev=bar.get(f"{ind}_prev"))
            values.append({
                "indicator": ind,
                "condition": op,
                "threshold": thr,
                "actual_value": float(actual),
                "news_candle_method": cond.get("news_candle_method"),
            })
            if not passed:
                all_pass = False
        return {"fires": all_pass, "values": values}

    # ── Bar assembly ─────────────────────────────────────────

    async def _fetch_evaluation_bar(self, conid: int, rule: dict) -> dict | None:
        """
        Fetch OHLCV + indicator values for `conid` and flatten the latest
        bar into a dict the condition evaluator can consume.

        Returned dict (when data is sufficient) has:
          - "open", "high", "low", "close", "volume" → last-bar OHLCV
          - "<indicator>"            → scalar value at the last bar
          - "<indicator>_prev"       → scalar value at the previous bar
            (only set if a previous indicator value is available)

        Returns None when there are fewer than 2 candles available.
        """
        candles = await self._fetch_candles(conid)
        if len(candles) < 2:
            log.debug(
                "Scanner: not enough bars for conid %d (got %d)",
                conid, len(candles),
            )
            return None

        last = candles[-1]
        last_close = float(last.close)
        last_volume = float(last.volume)

        bar: dict[str, float] = {
            "open": float(last.open),
            "high": float(last.high),
            "low": float(last.low),
            "close": last_close,
            "volume": last_volume,
            # Previous-bar raw fields, used for crosses_above/below on close/volume
            "open_prev": float(candles[-2].open),
            "high_prev": float(candles[-2].high),
            "low_prev": float(candles[-2].low),
            "close_prev": float(candles[-2].close),
            "volume_prev": float(candles[-2].volume),
        }

        # Collect all indicators referenced by this rule's conditions.
        needed: set[str] = set()
        news_methods: set[str] = set()
        for cond in rule.get("conditions", []):
            ind = cond["indicator"]
            if ind == "news_candle":
                method = cond.get("news_candle_method")
                if method:
                    news_methods.add(method)
                continue
            if ind in _RAW_BAR_FIELDS:
                continue  # already populated from candles
            needed.add(ind)

        if needed:
            try:
                results, _ = _indicator_svc.compute(
                    candles=candles,
                    indicators=list(needed),
                )
            except (ValueError, KeyError, TypeError, ZeroDivisionError) as exc:
                log.debug(
                    "indicator compute failed for conid %s rule %s: %s",
                    conid, rule.get("id"), exc,
                )
                results = []
            by_name = {r.name: r for r in results}
            for ind in needed:
                curr, prev = _scalar_pair(ind, by_name.get(ind), last_close, last_volume, candles)
                if curr is not None:
                    bar[ind] = curr
                if prev is not None:
                    bar[f"{ind}_prev"] = prev

        if news_methods:
            # If multiple news_candle conditions on the same rule pick different
            # methods we evaluate all and AND them into a single boolean.
            # In practice rules only have one news_candle condition.
            for method in news_methods:
                val = _evaluate_news_candle_metric(method, candles)
                # The condition fires (>= 1.0) when the metric exceeds its threshold.
                # `_evaluate_conditions` then compares this against the rule
                # threshold using the operator on the condition (typically "above").
                if val is not None:
                    bar["news_candle"] = float(val)
                    break
            # If all methods returned None we leave news_candle absent so the
            # condition fails cleanly with actual_value=NaN.

        return bar

    async def _fetch_candles(self, conid: int) -> list[CandleData]:
        """
        Fetch OHLCV history for trigger evaluation.

        Always uses 3-month daily bars — enough history for all indicators
        including the slow EMA-200.
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

    # ── Hit recording + IBKR mirror ──────────────────────────

    async def _resolve_expire_days(self, rule: dict) -> int | None:
        """
        For IBKR-mirror hits, look up watchlist_config[ibkr_mirror_target]
        for an auto_expire_days override. Returns None when no override
        is configured (tag-only or "no expiry").

        Returns None when no watchlist_config row exists for the mirror target —
        caller treats this as "permanent until manual move." This is intentional:
        auto-expire is now exclusively a watchlist-level setting, no per-rule fallback.
        """
        target = rule.get("ibkr_mirror_target")
        if not target:
            return None
        try:
            cfg = await self.db.get_watchlist_config(target)
        except sqlite3.Error as exc:
            log.warning(
                "watchlist_config DB lookup failed for '%s': %s",
                target, exc,
            )
            return None
        if cfg is None:
            return None
        return cfg.get("auto_expire_days")

    async def _record_hit(
        self,
        rule: dict,
        target: dict,
        values: list[dict],
    ) -> bool:
        """
        Persist a trigger hit. Optionally mirrors to an IBKR watchlist when
        rule['ibkr_mirror_target'] is set. Returns True on a fresh insert,
        False on dedup.
        """
        today = time.strftime("%Y-%m-%d")
        timeframe = rule.get("timeframe", "1D")
        dedup_key = f"{rule['id']}:{target['conid']}:{today}:{timeframe}"
        mirror = rule.get("ibkr_mirror_target")
        source = rule.get("watchlist_name") if mirror else None

        expires_at: str | None = None
        if mirror:
            expire_days = await self._resolve_expire_days(rule)
            if expire_days is not None and expire_days > 0:
                # +N days from now in UTC SQLite text format.
                from datetime import datetime, timedelta, timezone
                expires_at = (
                    datetime.now(timezone.utc) + timedelta(days=expire_days)
                ).strftime("%Y-%m-%d %H:%M:%S")

        hit_id = await self.db.record_trigger_hit(
            rule_id=rule["id"],
            conid=target["conid"],
            symbol=target.get("symbol", ""),
            dedup_key=dedup_key,
            condition_values=values,
            watchlist_name=rule.get("watchlist_name"),
            source_watchlist=source,
            target_watchlist=mirror,
            expires_at=expires_at,
        )
        if hit_id is None:
            log.debug("Rule %d/%s already fired today (dedup)", rule["id"], target["conid"])
            return False

        log.info(
            "Trigger FIRED: rule_id=%d %s (%s)",
            rule["id"], target.get("symbol", ""), target["conid"],
        )

        if mirror and source:
            try:
                await self.ibkr.move_between_watchlists(
                    conid=int(target["conid"]),
                    source_name=source,
                    target_name=mirror,
                )
            except (IBKRAuthError, IBKRConnectionError, IBKRRateLimitError, IBKRRequestError) as exc:
                log.error(
                    "ibkr_mirror move failed for hit %s (rule %d, conid %d): %s — "
                    "hit recorded but stock not moved in IBKR",
                    hit_id, rule["id"], target["conid"],
                    exc.message,
                )

        await self._broadcast_trigger_alert(hit_id, rule, target, values)
        return True

    async def _broadcast_trigger_alert(
        self,
        hit_id: int,
        rule: dict,
        target: dict,
        values: list[dict],
    ) -> None:
        """Fire the on_trigger_fired callback used for WS push to the frontend."""
        if self.on_trigger_fired is None:
            return
        try:
            await self.on_trigger_fired(hit_id, rule, target, values)
        except Exception as exc:  # noqa: BLE001 — callback errors must never crash the scanner
            log.error("on_trigger_fired callback raised: %s", exc, exc_info=True)

    # ── Auto-expire return (Phase 6.8) ───────────────────────

    async def _return_expired_hits(self) -> None:
        """
        Find trigger hits whose expiry has passed and move their stock back
        to the original source watchlist (target → source). Runs once per
        heartbeat before evaluating due rules.
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
                    source_name=target,   # reverse: move BACK from target
                    target_name=source,   # to the original source watchlist
                )
            except IBKRRequestError as exc:
                if exc.status_code == 404:
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
                return
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


# ── Module-level helpers ─────────────────────────────────────


def _passes(op: str, actual: float, thr: float | None, prev: float | None) -> bool:
    """Per-condition predicate. Module-level so tests can call it directly."""
    if thr is None:
        return bool(actual)
    if op == "above":
        return actual > thr
    if op == "below":
        return actual < thr
    if op == "crosses_above":
        return prev is not None and prev <= thr and actual > thr
    if op == "crosses_below":
        return prev is not None and prev >= thr and actual < thr
    if op == "fires":
        return bool(actual)
    return False


def _scalar_pair(
    indicator: str,
    result: Any,
    last_close: float,
    last_volume: float,
    candles: list[CandleData],
) -> tuple[float | None, float | None]:
    """
    Return (current, previous) scalar values for one indicator, applying
    the per-indicator semantics documented in the module docstring.

    `result` is the IndicatorResult from IndicatorService or None when the
    indicator failed to compute.
    """
    if indicator == "volume":
        prev = float(candles[-2].volume) if len(candles) >= 2 else None
        return last_volume, prev

    if result is None or not getattr(result, "values", None):
        return None, None

    vals = result.values

    def _scalar(entry: Any) -> float | None:
        if entry is None:
            return None

        if indicator == "macd":
            return entry.histogram if entry.histogram is not None else entry.value

        if indicator == "stoch":
            return entry.value

        if indicator.startswith("ema_"):
            if entry.value is None:
                return None
            return last_close - entry.value

        if indicator == "vwap":
            if entry.value is None:
                return None
            return last_close - entry.value

        if indicator == "bbands":
            upper = entry.upper
            lower = entry.lower
            if upper is None or lower is None:
                return None
            band_width = upper - lower
            if band_width == 0:
                return None
            return (last_close - lower) / band_width

        # Default: rsi, atr, adx, obv
        return entry.value

    curr = _scalar(vals[-1])
    prev = _scalar(vals[-2]) if len(vals) >= 2 else None
    return curr, prev


def _evaluate_news_candle_metric(
    method: str | None,
    candles: list[CandleData],
) -> float | None:
    """
    Compute the news-candle metric for the last bar using a 20-bar lookback.

    Methods:
      - volume_spike: last.volume / avg(prev 20 volumes)     (multiplier)
      - range_spike:  (high-low) / avg(prev 20 ranges)       (multiplier)
      - gap:          |open - prev.close| / prev.close * 100 (percentage)
      - long_wick:    max(upper_wick, lower_wick) / body     (ratio)

    Returns the metric value or None if it can't be computed. The caller
    feeds this into the bar dict as `bar["news_candle"]` and `_passes`
    compares it against the rule threshold using "above"/"fires".
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

    log.warning("Scanner: unknown news_candle_method '%s'", method)
    return None
