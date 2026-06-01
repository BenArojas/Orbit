"""InflectSyncService — background fills poll for the trading journal.

Modeled on `ScannerService`: an asyncio task started in the FastAPI lifespan,
auth-gated, with a `_stop_event` for clean shutdown. Each in-window tick runs
the same `ibkr → trades → upsert_fills` path the on-open / manual sync uses
(delegated to `InflectService.sync`), keeping `fills` fresh inside IBKR's 7-day
window so the durable projection never goes stale while the app is open.

Why a background poll at all (spec §3/§7): `/iserver/account/trades` only
returns the last 7 days. If the app sits idle for a week, aged-out executions
are lost permanently. The 60s poll + on-open pull mitigate that.

Market-hours gate (C2 / D10 / spec §12): sync runs only inside the **extended**
trading window (pre- + post-market). The window is derived once per day from
`/trsrv/secdef/schedule` (holiday-aware) for a US-equity proxy symbol; if that
call fails we fall back to a hardcoded US/Eastern ≈04:00–20:00 window that skips
weekends, so the sync degrades gracefully rather than stopping.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any, Optional
from zoneinfo import ZoneInfo

from constants.inflect import (
    FALLBACK_SESSION_CLOSE_MINUTES,
    FALLBACK_SESSION_OPEN_MINUTES,
    SCHEDULE_PROXY_SYMBOL,
    SYNC_INTERVAL_SEC,
    TRADING_DAY_TZ,
)
from exceptions import (
    IBKRAuthError,
    IBKRConnectionError,
    IBKRError,
    IBKRRateLimitError,
    IBKRRequestError,
)
from services.inflect.service import InflectService
from services.moonmarket import MoonMarketAccountNotFoundError

log = logging.getLogger("inflect.sync")

# How long to wait after IBKR auth before the first sync (let the session
# settle), and how often to poll for auth while waiting. Mirrors ScannerService.
_POST_AUTH_DELAY = 15.0
_AUTH_POLL_INTERVAL = 5.0


class InflectSyncService:
    def __init__(self, ibkr, inflect: InflectService) -> None:
        self.ibkr = ibkr
        self.inflect = inflect
        self._task: asyncio.Task | None = None
        self._stop_event = asyncio.Event()
        self._ibkr_wait_started = False
        self._last_sync_at: str | None = None
        self._last_synced_count: int = 0
        self._last_skipped_closed = False
        # Per-day cache of today's derived window, keyed by the ET date string.
        # Value is (open_minute, close_minute) or None for a non-trading day.
        self._window_cache_day: str | None = None
        self._window_cache: Optional[tuple[int, int]] = None

    # ── Lifecycle (mirrors ScannerService) ─────────────────────

    def start(self) -> None:
        if self._task and not self._task.done():
            log.warning("Inflect sync already running — ignoring duplicate start()")
            return
        self._stop_event.clear()
        self._task = asyncio.create_task(self._run_loop(), name="inflect-sync")
        log.info("Inflect sync started — waiting for IBKR authentication")

    async def stop(self) -> None:
        self._stop_event.set()
        if self._task and not self._task.done():
            try:
                await asyncio.wait_for(self._task, timeout=10.0)
            except asyncio.TimeoutError:
                self._task.cancel()
                log.warning("Inflect sync task did not stop cleanly — cancelled")
        log.info("Inflect sync stopped")

    def status(self) -> dict[str, Any]:
        running = bool(self._task and not self._task.done())
        return {
            "running": running,
            "interval_seconds": SYNC_INTERVAL_SEC,
            "last_sync_at": self._last_sync_at,
            "last_synced_count": self._last_synced_count,
            "waiting_for_auth": self._ibkr_wait_started
            and not self.ibkr.state.authenticated,
        }

    # ── Main loop ──────────────────────────────────────────────

    async def _run_loop(self) -> None:
        self._ibkr_wait_started = True
        if not await self._wait_for_ibkr_auth():
            return

        log.info("Inflect sync: IBKR authenticated — first sync in %.0fs", _POST_AUTH_DELAY)
        try:
            await asyncio.wait_for(self._stop_event.wait(), timeout=_POST_AUTH_DELAY)
            return
        except asyncio.TimeoutError:
            pass

        while not self._stop_event.is_set():
            await self._tick()
            try:
                await asyncio.wait_for(
                    self._stop_event.wait(), timeout=float(SYNC_INTERVAL_SEC)
                )
                break
            except asyncio.TimeoutError:
                pass

    async def _tick(self) -> None:
        """One poll: sync fills if inside the extended-hours window."""
        now_et = datetime.now(ZoneInfo(TRADING_DAY_TZ))
        window = await self._resolve_today_window(now_et)
        if not self._in_window(now_et, window):
            self._last_skipped_closed = True
            log.debug("Inflect sync: outside trading window — skipping tick")
            return

        self._last_skipped_closed = False
        try:
            response = await self.inflect.sync(account_id=None)
            self._last_synced_count = response.synced
            self._last_sync_at = now_et.isoformat()
            log.info("Inflect sync: upserted %d fill(s)", response.synced)
        except (IBKRAuthError, IBKRConnectionError) as exc:
            log.warning("Inflect sync: IBKR unavailable (%s) — will retry", exc.message)
        except IBKRRateLimitError:
            log.warning("Inflect sync: rate limited — skipping this tick")
        except IBKRRequestError as exc:
            log.warning("Inflect sync: IBKR error (%s) — skipping", exc.message)
        except MoonMarketAccountNotFoundError as exc:
            log.warning("Inflect sync: no account available (%s) — skipping", exc)

    async def _wait_for_ibkr_auth(self) -> bool:
        while not self._stop_event.is_set():
            if self.ibkr.state.authenticated:
                log.info("Inflect sync: IBKR session confirmed authenticated")
                return True
            try:
                await asyncio.wait_for(
                    self._stop_event.wait(), timeout=_AUTH_POLL_INTERVAL
                )
                return False
            except asyncio.TimeoutError:
                pass
        return False

    # ── Market-session gate (spec §12) ─────────────────────────

    @staticmethod
    def _in_window(now_et: datetime, window: Optional[tuple[int, int]]) -> bool:
        """True if now (ET) falls inside [open, close) minutes-of-day.

        `window` is None on a non-trading day (weekend / holiday) → never sync.
        """
        if window is None:
            return False
        open_min, close_min = window
        minute_of_day = now_et.hour * 60 + now_et.minute
        return open_min <= minute_of_day < close_min

    async def _resolve_today_window(
        self, now_et: datetime
    ) -> Optional[tuple[int, int]]:
        """Today's extended-hours window in ET minutes-of-day, cached per day.

        Tries `/trsrv/secdef/schedule` (holiday-aware); falls back to the
        hardcoded ET window (weekends → None) on any fetch/parse failure.
        """
        day_key = now_et.date().isoformat()
        if self._window_cache_day == day_key:
            return self._window_cache

        window = await self._fetch_schedule_window(now_et)
        if window is None and not self._is_schedule_definitive(now_et):
            window = self._fallback_window(now_et)

        self._window_cache_day = day_key
        self._window_cache = window
        return window

    def _is_schedule_definitive(self, now_et: datetime) -> bool:
        """Whether the schedule fetch authoritatively marked today non-trading.

        Set by `_fetch_schedule_window` when it parsed a schedule and found
        today is a holiday (vs. the fetch simply failing). Kept simple for v1:
        we treat a None from the fetch as "unknown" and fall back, unless the
        fetch explicitly flagged today closed.
        """
        return self._schedule_marked_closed

    async def _fetch_schedule_window(
        self, now_et: datetime
    ) -> Optional[tuple[int, int]]:
        """Fetch + parse today's trading window from IBKR's schedule.

        Returns (open_min, close_min) for a trading day, or None if the fetch
        failed or today could not be resolved. Sets `_schedule_marked_closed`
        when the schedule was parsed and explicitly shows today as non-trading.
        """
        self._schedule_marked_closed = False
        try:
            payload = await self.ibkr._request(
                "GET",
                "/trsrv/secdef/schedule",
                params={"assetClass": "STK", "symbol": SCHEDULE_PROXY_SYMBOL},
            )
        except IBKRError as exc:
            log.debug("Inflect sync: schedule fetch failed (%s) — using fallback", exc)
            return None

        try:
            return self._parse_schedule_window(payload, now_et)
        except (KeyError, TypeError, ValueError, IndexError) as exc:
            log.debug("Inflect sync: schedule parse failed (%s) — using fallback", exc)
            return None

    def _parse_schedule_window(
        self, payload: Any, now_et: datetime
    ) -> Optional[tuple[int, int]]:
        """Extract today's earliest open / latest close from a schedule payload.

        IBKR returns a list of venue entries each holding a `schedules` list of
        per-day records keyed by `tradingScheduleDate` (YYYYMMDD) with a
        `tradingtimes` list of {openingTime, closingTime} (HHMM, ET). We take
        the union across venues for today's date. A day present but with no
        trading times is treated as a holiday (returns None, marked closed).
        """
        target = now_et.strftime("%Y%m%d")
        entries = payload if isinstance(payload, list) else [payload]

        opens: list[int] = []
        closes: list[int] = []
        day_present = False
        for entry in entries:
            for sched in entry.get("schedules", []) or []:
                if str(sched.get("tradingScheduleDate")) != target:
                    continue
                day_present = True
                for tt in sched.get("tradingtimes", []) or []:
                    opening = self._hhmm_to_minutes(tt.get("openingTime"))
                    closing = self._hhmm_to_minutes(tt.get("closingTime"))
                    if opening is not None and closing is not None:
                        opens.append(opening)
                        closes.append(closing)

        if opens and closes:
            return (min(opens), max(closes))
        if day_present:
            # Listed but no trading times → holiday / non-trading session.
            self._schedule_marked_closed = True
            return None
        return None

    def _fallback_window(self, now_et: datetime) -> Optional[tuple[int, int]]:
        """Hardcoded ET extended-hours window; None on weekends."""
        if now_et.weekday() >= 5:  # Sat=5, Sun=6
            return None
        return (FALLBACK_SESSION_OPEN_MINUTES, FALLBACK_SESSION_CLOSE_MINUTES)

    @staticmethod
    def _hhmm_to_minutes(value: Any) -> Optional[int]:
        if value is None:
            return None
        text = str(value).strip()
        if len(text) != 4 or not text.isdigit():
            return None
        hours = int(text[:2])
        minutes = int(text[2:])
        return hours * 60 + minutes

    # Initialised lazily by _fetch_schedule_window; declared for clarity.
    _schedule_marked_closed: bool = False
