from __future__ import annotations

import asyncio
import logging
import math

from ib_async import IB, Contract

from models.broker_session import BrokerSessionMode
from models.tws_execution_assistant import (
    InstrumentResult,
    OrderSnapshot,
    PositionSnapshot,
    QuoteSnapshot,
    ReconciliationSnapshot,
    ReconciliationSummary,
    TwsAdapterState,
    TwsStatusResponse,
)

log = logging.getLogger(__name__)

_IBKR_UNSET = 1.7976931348623157e+308


def _quote_val(val: object) -> float | None:
    """Map IBKR nan / unset sentinel / None to Python None."""
    if val is None:
        return None
    try:
        f = float(val)  # type: ignore[arg-type]
        return None if (math.isnan(f) or f >= _IBKR_UNSET) else f
    except (TypeError, ValueError):
        return None


def _lmt_price(val: float) -> float | None:
    return val if val and 0 < val < _IBKR_UNSET else None


class TwsBrokerAdapter:
    """Owns the ib_async IB connection. No ib_async types may leak beyond this class."""

    def __init__(self) -> None:
        self._ib = IB()
        self._state: TwsAdapterState = "not_initialized"
        self._client_id: int = 1
        self._last_host: str = "127.0.0.1"

    async def connect(self, host: str, port: int, client_id: int) -> None:
        # KNOWN GAP: no paper/live account-type check here. Paper is the default
        # port convention only, not enforced. Must be closed at the Slice 7 HITL
        # gate before any order-submission path exists.
        self._state = "connecting"
        self._client_id = client_id
        self._last_host = host
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

    def is_connected(self) -> bool:
        return self._state == "connected" and self._ib.isConnected()

    async def check_api_server(self) -> bool:
        """Return True if the TWS / IB Gateway API socket is TCP-reachable.

        Short-circuits to True when Orbit's adapter is already connected.
        Otherwise probes the last-used host (default 127.0.0.1) on IB Gateway
        paper port 4002 and TWS paper port 7497 with a 0.5 s timeout each.
        No IB API handshake is performed — just a raw TCP connect/close.
        """
        if self.is_connected():
            return True
        for port in (4002, 7497):
            try:
                _, writer = await asyncio.wait_for(
                    asyncio.open_connection(self._last_host, port), timeout=0.5
                )
                writer.close()
                await writer.wait_closed()
                return True
            except (OSError, asyncio.TimeoutError):
                continue
        return False

    def get_status(self, mode: BrokerSessionMode, api_server_available: bool = False) -> TwsStatusResponse:
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
            api_server_available=api_server_available,
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

    async def search_instruments(self, symbol: str) -> list[InstrumentResult]:
        """Lookup contracts by symbol.

        Tries STK/SMART/USD first; falls back to unconstrained symbol search.
        Returns results sorted with STK SMART USD first.
        Read-only — no orders, no account data, no connections beyond contract details.
        """
        if not self._ib.isConnected():
            return []
        try:
            details = await self._ib.reqContractDetailsAsync(
                Contract(symbol=symbol, secType="STK", exchange="SMART", currency="USD")
            )
            if not details:
                details = await self._ib.reqContractDetailsAsync(Contract(symbol=symbol))
        except (RuntimeError, OSError) as exc:
            log.warning("Instrument search failed for %s: %s", symbol, exc)
            return []

        results = [
            InstrumentResult(
                conid=d.contract.conId,
                symbol=d.contract.symbol,
                sec_type=d.contract.secType,
                exchange=d.contract.exchange,
                primary_exchange=getattr(d.contract, "primaryExchange", "") or "",
                currency=d.contract.currency,
                local_symbol=d.contract.localSymbol or d.contract.symbol,
            )
            for d in details
        ]
        # STK SMART USD to the front — those are the most useful for equity drafts
        results.sort(key=lambda r: (
            0 if (r.sec_type == "STK" and r.exchange == "SMART" and r.currency == "USD") else 1
        ))
        return results

    async def get_quote(self, conid: int) -> QuoteSnapshot:
        """Fetch a best-effort market data snapshot for a conid.

        Read-only — no streaming subscription persists after this call.
        Returns an empty QuoteSnapshot when data is unavailable.
        """
        if not self._ib.isConnected():
            return QuoteSnapshot()
        try:
            # IBKR requires exchange identity for market data (Warning 321).
            # Supplying SMART/STK/USD is enough for equities — IBKR routes SMART
            # to the correct primary exchange for the given conid.
            contract = Contract(conId=conid, secType="STK", exchange="SMART", currency="USD")
            tickers = await asyncio.wait_for(
                self._ib.reqTickersAsync(contract), timeout=5.0
            )
            if not tickers:
                return QuoteSnapshot()
            t = tickers[0]
            # Cancel the subscription immediately — we only wanted a snapshot.
            self._ib.cancelMktData(t.contract)
            return QuoteSnapshot(
                last=_quote_val(t.last),
                close=_quote_val(t.close),
                open=_quote_val(t.open),
                high=_quote_val(t.high),
                low=_quote_val(t.low),
                bid=_quote_val(t.bid),
                ask=_quote_val(t.ask),
            )
        except (RuntimeError, OSError, asyncio.TimeoutError) as exc:
            log.warning("Quote fetch failed for conid %s: %s", conid, exc)
            return QuoteSnapshot()

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
