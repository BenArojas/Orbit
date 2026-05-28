"""MoonMarket order service for paper-account stock order mutations."""

from __future__ import annotations

from models import MoonMarketOrderDraft
from services.ibkr import IBKRService
from services.moonmarket import MoonMarketAccountNotFoundError, MoonMarketService

OrderResult = dict[str, object] | list[dict[str, object]]


class LiveTradingBlockedError(PermissionError):
    """Raised when v1 blocks an order mutation on a live account."""

    def __init__(self, account_id: str) -> None:
        super().__init__(f"Live trading is blocked for account {account_id}")
        self.account_id = account_id


class MoonMarketOrderNotFoundError(LookupError):
    """Raised when a modify request targets an order not present in live orders."""


class OptionBracketNotSupportedError(ValueError):
    """Raised when an option order tries to submit a bracket group."""


class OrderService:
    """Order preview and paper-only order mutations through IBKR Client Portal."""

    def __init__(self, ibkr: IBKRService) -> None:
        self.ibkr = ibkr
        self.moonmarket = MoonMarketService(ibkr)

    async def preview(self, account_id: str, order: MoonMarketOrderDraft) -> OrderResult:
        await self.moonmarket._resolve_account_id(account_id)
        return await self.ibkr._request(
            "POST",
            f"/iserver/account/{account_id}/orders/whatif",
            json={"orders": [self._order_payload(order)]},
        )

    async def place(self, account_id: str, orders: list[MoonMarketOrderDraft]) -> OrderResult:
        await self._assert_paper_account(account_id)
        if len(orders) > 1 and any(order.asset_class == "OPT" for order in orders):
            raise OptionBracketNotSupportedError(
                "Option bracket orders are deferred until after single-leg paper validation"
            )
        return await self.ibkr._request(
            "POST",
            f"/iserver/account/{account_id}/orders",
            json={"orders": [self._order_payload(order) for order in orders]},
        )

    async def reply(self, account_id: str, reply_id: str, confirmed: bool) -> OrderResult:
        await self._assert_paper_account(account_id)
        return await self.ibkr._request(
            "POST",
            f"/iserver/reply/{reply_id}",
            json={"confirmed": confirmed},
        )

    async def cancel(self, account_id: str, order_id: str) -> OrderResult:
        await self._assert_paper_account(account_id)
        return await self.ibkr._request(
            "DELETE",
            f"/iserver/account/{account_id}/order/{order_id}",
        )

    async def modify(
        self,
        account_id: str,
        order_id: str,
        order: MoonMarketOrderDraft,
    ) -> OrderResult:
        await self._assert_paper_account(account_id)
        return await self.ibkr._request(
            "POST",
            f"/iserver/account/{account_id}/order/{order_id}",
            json=self._order_payload(order),
        )

    async def _assert_paper_account(self, account_id: str) -> None:
        raw_accounts = await self.ibkr.ensure_accounts()
        for row in raw_accounts:
            resolved = self.moonmarket._account_id(row)
            if resolved == account_id:
                if self.moonmarket._account_is_paper(row, account_id):
                    return
                raise LiveTradingBlockedError(account_id)
        raise MoonMarketAccountNotFoundError(f"Unknown account_id: {account_id}")

    def _order_payload(self, order: MoonMarketOrderDraft) -> dict[str, object]:
        payload: dict[str, object] = {
            "conid": order.conid,
            "orderType": order.order_type,
            "side": order.side,
            "tif": order.tif,
            "quantity": order.quantity,
        }
        if order.price is not None:
            payload["price"] = order.price
        if order.aux_price is not None:
            payload["auxPrice"] = order.aux_price
        if order.client_order_id is not None:
            payload["cOID"] = order.client_order_id
        if order.parent_id is not None:
            payload["parentId"] = order.parent_id
        if order.is_single_group:
            payload["isSingleGroup"] = True
        return payload
