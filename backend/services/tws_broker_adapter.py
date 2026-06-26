from __future__ import annotations

import asyncio
import logging

from ib_async import IB, Contract

from models.broker_session import BrokerSessionMode
from models.tws_execution_assistant import (
    OrderSnapshot,
    PositionSnapshot,
    ReconciliationSnapshot,
    ReconciliationSummary,
    TwsAdapterState,
    TwsStatusResponse,
)

log = logging.getLogger(__name__)

_IBKR_UNSET = 1.7976931348623157e+308


def _lmt_price(val: float) -> float | None:
    return val if val and 0 < val < _IBKR_UNSET else None


class TwsBrokerAdapter:
    """Owns the ib_async IB connection. No ib_async types may leak beyond this class."""

    def __init__(self) -> None:
        self._ib = IB()
        self._state: TwsAdapterState = "not_initialized"
        self._client_id: int = 1

    async def connect(self, host: str, port: int, client_id: int) -> None:
        # KNOWN GAP: no paper/live account-type check here. Paper is the default
        # port convention only, not enforced. Must be closed at the Slice 7 HITL
        # gate before any order-submission path exists.
        self._state = "connecting"
        self._client_id = client_id
        try:
            await self._ib.connectAsync(host, port, clientId=client_id, timeout=10)
            await self._ib.reqPositionsAsync()
            await self._ib.reqAllOpenOrdersAsync()
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
        if connected:
            trades = self._ib.openTrades()
            summary = ReconciliationSummary(
                position_count=len(self._ib.positions()),
                open_order_count=len(trades),
                unmanaged_order_count=sum(1 for t in trades if t.order.clientId != self._client_id),
            )
        else:
            summary = ReconciliationSummary()
        return TwsStatusResponse(
            mode=mode,
            connected=connected,
            adapter_state=self._state,
            kill_switch_active=False,
            reconciliation_summary=summary,
        )

    async def get_sec_type(self, conid: int) -> str | None:
        """Returns IBKR secType for a conid, or None if not connected or not found.

        Calls ib_async directly rather than routing through InstrumentIdentityService,
        which is a Client Portal / SQLite cache pattern and does not apply in TWS mode.
        This is the correct routing for TWS-context instrument lookup (approved decision).
        """
        if not self._ib.isConnected():
            return None
        try:
            details = await self._ib.reqContractDetailsAsync(Contract(conId=conid))
        except (RuntimeError, OSError) as exc:
            log.warning("Contract lookup failed for conid %s: %s", conid, exc)
            return None
        return details[0].contract.secType if details else None

    def get_reconciliation(self) -> ReconciliationSnapshot:
        if not self._ib.isConnected():
            return ReconciliationSnapshot()

        positions = [
            PositionSnapshot(
                conid=p.contract.conId,
                symbol=p.contract.symbol,
                position=p.position,
                avg_cost=p.avgCost,
            )
            for p in self._ib.positions()
        ]

        open_orders = [
            OrderSnapshot(
                order_id=t.order.orderId,
                conid=t.contract.conId,
                symbol=t.contract.symbol,
                side=t.order.action,
                quantity=float(t.order.totalQuantity),
                order_type=t.order.orderType,
                lmt_price=_lmt_price(t.order.lmtPrice),
                status=t.orderStatus.status,
                is_unmanaged=t.order.clientId != self._client_id,
            )
            for t in self._ib.openTrades()
        ]

        return ReconciliationSnapshot(
            position_count=len(positions),
            open_order_count=len(open_orders),
            unmanaged_order_count=sum(1 for o in open_orders if o.is_unmanaged),
            positions=positions,
            open_orders=open_orders,
        )
