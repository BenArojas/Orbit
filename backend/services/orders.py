"""MoonMarket order service for stock and option order mutations."""

from __future__ import annotations

from models import MoonMarketOrderDraft
from services.client_portal_execution import (
    ClientPortalExecutionAdapter,
    OrderExecutionAdapter,
    OrderPayload,
    OrderResult,
)
from services.ibkr import IBKRService
from services.moonmarket import MoonMarketService


class MoonMarketOrderNotFoundError(LookupError):
    """Raised when a modify request targets an order not present in live orders."""


class OptionBracketNotSupportedError(ValueError):
    """Raised when an option order tries to submit a bracket group."""


class OrderService:
    """Order preview and order mutations through IBKR Client Portal."""

    def __init__(
        self,
        ibkr: IBKRService,
        execution: OrderExecutionAdapter | None = None,
    ) -> None:
        self.ibkr = ibkr
        self.execution = execution or ClientPortalExecutionAdapter(ibkr)
        self.moonmarket = MoonMarketService(ibkr)

    async def preview(self, account_id: str, order: MoonMarketOrderDraft) -> OrderResult:
        await self.moonmarket._resolve_account_id(account_id)
        return await self.execution.preview_order(account_id, self._order_payload(order))

    async def place(self, account_id: str, orders: list[MoonMarketOrderDraft]) -> OrderResult:
        await self.moonmarket._resolve_account_id(account_id)
        if len(orders) > 1 and any(order.asset_class == "OPT" for order in orders):
            raise OptionBracketNotSupportedError(
                "Option bracket orders are deferred until after single-leg paper validation"
            )
        return await self.execution.place_orders(
            account_id,
            [self._order_payload(order) for order in orders],
        )

    async def reply(self, account_id: str, reply_id: str, confirmed: bool) -> OrderResult:
        await self.moonmarket._resolve_account_id(account_id)
        return await self.execution.reply_order(reply_id, confirmed)

    async def cancel(self, account_id: str, order_id: str) -> OrderResult:
        await self.moonmarket._resolve_account_id(account_id)
        return await self.execution.cancel_order(account_id, order_id)

    async def modify(
        self,
        account_id: str,
        order_id: str,
        order: MoonMarketOrderDraft,
    ) -> OrderResult:
        await self.moonmarket._resolve_account_id(account_id)
        return await self.execution.modify_order(account_id, order_id, self._order_payload(order))

    def _order_payload(self, order: MoonMarketOrderDraft) -> OrderPayload:
        payload: OrderPayload = {
            "conid": order.conid,
            "orderType": "STP LMT" if order.order_type == "STP_LIMIT" else order.order_type,
            "side": order.side,
            "tif": order.tif,
            "quantity": order.quantity,
        }
        stop_price = order.aux_price if order.aux_price is not None else order.price
        if order.order_type == "STP" and stop_price is not None:
            payload["auxPrice"] = stop_price
        elif order.price is not None:
            payload["price"] = order.price
        if order.order_type != "STP" and order.aux_price is not None:
            payload["auxPrice"] = order.aux_price
        if order.trailing_type is not None:
            payload["trailingType"] = order.trailing_type
        if order.trailing_amt is not None:
            payload["trailingAmt"] = order.trailing_amt
        if order.outside_rth:
            payload["outsideRTH"] = True
        if order.client_order_id is not None:
            payload["cOID"] = order.client_order_id
        if order.parent_id is not None:
            payload["parentId"] = order.parent_id
        if order.is_single_group:
            payload["isSingleGroup"] = True
        return payload
