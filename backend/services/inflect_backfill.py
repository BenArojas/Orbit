"""Inflect basis-backfill scheduler.

Runs in the backend sidecar and conservatively dispatches at most one
`/pa/transactions` request every 16 minutes across all accounts/conids.
P1-F owns normalization and matcher reruns; this service only queues, paces,
fetches, and records queue status.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Callable

from exceptions import (
    IBKRAuthError,
    IBKRConnectionError,
    IBKRRateLimitError,
    IBKRRequestError,
)
from services.db import DatabaseService

log = logging.getLogger("inflect.backfill")

_HEARTBEAT_SECONDS = 60.0
_AUTH_POLL_INTERVAL = 5.0
_DISPATCH_INTERVAL_MS = 16 * 60 * 1000


class InflectBackfillService:
    def __init__(
        self,
        *,
        ibkr: Any,
        db: DatabaseService,
        inflect: Any,
        clock_ms: Callable[[], int] | None = None,
    ) -> None:
        self.ibkr = ibkr
        self.db = db
        self.inflect = inflect
        self._clock_ms = clock_ms or self._default_clock_ms
        self._task: asyncio.Task | None = None
        self._stop_event = asyncio.Event()
        self._ibkr_wait_started = False
        self._last_dispatch_ms: int | None = None
        self._in_flight = False

    # ── Lifecycle ────────────────────────────────────────────

    def start(self) -> None:
        if self._task and not self._task.done():
            log.warning("Inflect backfill already running — ignoring duplicate start()")
            return
        self._stop_event.clear()
        self._task = asyncio.create_task(self._run_loop(), name="inflect-backfill")
        log.info("Inflect backfill started — waiting for IBKR authentication")

    async def stop(self) -> None:
        self._stop_event.set()
        if self._task and not self._task.done():
            try:
                await asyncio.wait_for(self._task, timeout=10.0)
            except asyncio.TimeoutError:
                self._task.cancel()
                log.warning("Inflect backfill task did not stop cleanly — cancelled")
        log.info("Inflect backfill stopped")

    def status(self) -> dict[str, Any]:
        running = bool(self._task and not self._task.done())
        return {
            "running": running,
            "heartbeat_seconds": int(_HEARTBEAT_SECONDS),
            "dispatch_interval_ms": _DISPATCH_INTERVAL_MS,
            "waiting_for_auth": self._ibkr_wait_started
            and not self.ibkr.state.authenticated,
            "in_flight": self._in_flight,
            "last_dispatch_ms": self._last_dispatch_ms,
        }

    # ── Main loop ────────────────────────────────────────────

    async def _run_loop(self) -> None:
        self._ibkr_wait_started = True
        if not await self._wait_for_ibkr_auth():
            return

        while not self._stop_event.is_set():
            await self._tick()
            try:
                await asyncio.wait_for(
                    self._stop_event.wait(), timeout=_HEARTBEAT_SECONDS
                )
                break
            except asyncio.TimeoutError:
                pass

    async def _wait_for_ibkr_auth(self) -> bool:
        while not self._stop_event.is_set():
            if self.ibkr.state.authenticated:
                log.info("Inflect backfill: IBKR session confirmed authenticated")
                return True
            try:
                await asyncio.wait_for(
                    self._stop_event.wait(), timeout=_AUTH_POLL_INTERVAL
                )
                return False
            except asyncio.TimeoutError:
                pass
        return False

    async def _tick(self) -> None:
        await self._enqueue_needs_basis()
        if self._in_flight or not self._dispatch_window_open():
            return

        item = await self.db.claim_next_backfill(now_ms=self._clock_ms())
        if item is None:
            return

        self._in_flight = True
        self._last_dispatch_ms = self._clock_ms()
        try:
            payload = await self._fetch_transactions(item)
            status, days_used, last_error = await self._handle_backfill_payload(
                item, payload
            )
            await self.db.set_backfill_status(
                item["account_id"],
                int(item["conid"]),
                status=status,
                days_used=days_used,
                last_checked_ms=self._last_dispatch_ms,
                last_error=last_error,
            )
        except IBKRRateLimitError as exc:
            await self.db.set_backfill_status(
                item["account_id"],
                int(item["conid"]),
                status="rate_limited",
                last_checked_ms=self._last_dispatch_ms,
                last_error=exc.message,
            )
            log.warning("Inflect backfill: rate limited (%s)", exc.message)
        except (IBKRAuthError, IBKRConnectionError) as exc:
            await self.db.set_backfill_status(
                item["account_id"],
                int(item["conid"]),
                status="pending",
                last_checked_ms=self._last_dispatch_ms,
                last_error=exc.message,
            )
            log.warning("Inflect backfill: IBKR unavailable (%s)", exc.message)
        except IBKRRequestError as exc:
            await self.db.set_backfill_status(
                item["account_id"],
                int(item["conid"]),
                status="failed",
                last_checked_ms=self._last_dispatch_ms,
                last_error=exc.message,
            )
            log.warning("Inflect backfill: IBKR request failed (%s)", exc.message)
        finally:
            self._in_flight = False

    async def _enqueue_needs_basis(self) -> None:
        response = await self.inflect.trades(account_id=None, status="INCOMPLETE_BASIS")
        for trade in response.trades:
            if getattr(trade, "status", None) == "INCOMPLETE_BASIS":
                await self.db.enqueue_basis(
                    getattr(trade, "account_id", response.account_id),
                    int(getattr(trade, "conid")),
                )

    def _dispatch_window_open(self) -> bool:
        if self._last_dispatch_ms is None:
            return True
        return self._clock_ms() - self._last_dispatch_ms >= _DISPATCH_INTERVAL_MS

    async def _fetch_transactions(self, item: dict[str, Any]) -> Any:
        return await self.ibkr._request(
            "GET",
            "/pa/transactions",
            params={
                "accountId": item["account_id"],
                "conid": str(int(item["conid"])),
                "days": 365,
            },
        )

    async def _handle_backfill_payload(
        self, item: dict[str, Any], payload: Any
    ) -> tuple[str, int, str | None]:
        """Placeholder seam for P1-F normalization/rerun.

        P1-D intentionally does not normalize PA rows. Until P1-F replaces this
        seam, a successful fetch records that the item still needs basis.
        """
        return ("still_needs_basis", 365, None)

    @staticmethod
    def _default_clock_ms() -> int:
        return int(datetime.now(timezone.utc).timestamp() * 1000)
