from __future__ import annotations

import asyncio
import logging

from ib_async import IB

from models.broker_session import BrokerSessionMode
from models.tws_execution_assistant import ReconciliationSummary, TwsAdapterState, TwsStatusResponse

log = logging.getLogger(__name__)


class TwsBrokerAdapter:
    """Owns the ib_async IB connection. No ib_async types may leak beyond this class."""

    def __init__(self) -> None:
        self._ib = IB()
        self._state: TwsAdapterState = "not_initialized"

    async def connect(self, host: str, port: int, client_id: int) -> None:
        self._state = "connecting"
        try:
            await self._ib.connectAsync(host, port, clientId=client_id, timeout=10)
            await self._ib.reqPositionsAsync()
            await self._ib.reqOpenOrdersAsync()
            self._state = "connected"
        except (ConnectionRefusedError, asyncio.TimeoutError, OSError, RuntimeError) as exc:
            # ponytail: covers the known ib_async connect-time exceptions; client-ID
            # conflict arrives as an error callback, not an exception — it surfaces
            # as a dropped connection visible on the next status poll.
            log.warning("TWS connect failed (%s:%s cid=%s): %s", host, port, client_id, exc)
            self._state = "error"

    async def disconnect(self) -> None:
        if self._state == "not_initialized":
            return
        if self._ib.isConnected():
            self._ib.disconnect()
        self._state = "disconnected"

    def get_status(self, mode: BrokerSessionMode) -> TwsStatusResponse:
        connected = self._state == "connected" and self._ib.isConnected()
        return TwsStatusResponse(
            mode=mode,
            connected=connected,
            adapter_state=self._state,
            kill_switch_active=False,
            reconciliation_summary=ReconciliationSummary(
                position_count=len(self._ib.positions()) if connected else 0,
                open_order_count=len(self._ib.openOrders()) if connected else 0,
            ),
        )
