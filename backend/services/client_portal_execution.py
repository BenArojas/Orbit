"""Client Portal execution adapter for order and account behavior."""

from __future__ import annotations

from typing import Any, Protocol

OrderPayload = dict[str, object]
OrderResult = dict[str, object] | list[dict[str, object]]


class OrderExecutionAdapter(Protocol):
    async def preview_order(self, account_id: str, order_payload: OrderPayload) -> OrderResult:
        """Preview a single order before placement."""

    async def place_orders(self, account_id: str, order_payloads: list[OrderPayload]) -> OrderResult:
        """Place one or more already-normalized order payloads."""

    async def reply_order(self, reply_id: str, confirmed: bool) -> OrderResult:
        """Confirm or reject a Client Portal reply prompt."""

    async def cancel_order(self, account_id: str, order_id: str) -> OrderResult:
        """Cancel one live order."""

    async def modify_order(
        self,
        account_id: str,
        order_id: str,
        order_payload: OrderPayload,
    ) -> OrderResult:
        """Modify one live order."""


class MoonMarketExecutionAdapter(Protocol):
    async def live_orders(self) -> OrderResult:
        """Refresh and fetch the current live-order payload."""

    async def order_rules(self, *, conid: int, is_buy: bool) -> OrderResult:
        """Fetch contract order rules for a conid and side."""

    async def account_summary(self, account_id: str) -> OrderResult:
        """Fetch the account summary payload for funds data."""

    async def revalidate_positions(self, account_id: str) -> OrderResult:
        """Invalidate and refetch backend position cache for one account."""

    async def trades(self, *, days: int) -> OrderResult:
        """Fetch recent account trade history."""

    async def position_page(self, account_id: str, page: int) -> OrderResult:
        """Fetch one portfolio positions page."""

    async def ledger(self, account_id: str) -> OrderResult:
        """Fetch the account ledger payload."""

    async def all_periods(self, account_id: str) -> OrderResult:
        """Fetch the all-periods performance payload for one account."""


class ClientPortalTransport(Protocol):
    async def _request(self, method: str, endpoint: str, **kwargs: Any) -> Any:
        """Send one raw Client Portal request."""


class ClientPortalExecutionAdapter:
    """Intent-level execution calls backed by IBKR Client Portal endpoints."""

    def __init__(self, ibkr: ClientPortalTransport) -> None:
        self.ibkr = ibkr

    async def preview_order(self, account_id: str, order_payload: OrderPayload) -> OrderResult:
        return await self.ibkr._request(
            "POST",
            f"/iserver/account/{account_id}/orders/whatif",
            json={"orders": [order_payload]},
        )

    async def place_orders(self, account_id: str, order_payloads: list[OrderPayload]) -> OrderResult:
        return await self.ibkr._request(
            "POST",
            f"/iserver/account/{account_id}/orders",
            json={"orders": order_payloads},
        )

    async def reply_order(self, reply_id: str, confirmed: bool) -> OrderResult:
        return await self.ibkr._request(
            "POST",
            f"/iserver/reply/{reply_id}",
            json={"confirmed": confirmed},
        )

    async def cancel_order(self, account_id: str, order_id: str) -> OrderResult:
        return await self.ibkr._request(
            "DELETE",
            f"/iserver/account/{account_id}/order/{order_id}",
        )

    async def modify_order(
        self,
        account_id: str,
        order_id: str,
        order_payload: OrderPayload,
    ) -> OrderResult:
        return await self.ibkr._request(
            "POST",
            f"/iserver/account/{account_id}/order/{order_id}",
            json=order_payload,
        )

    async def live_orders(self) -> OrderResult:
        await self.ibkr._request("GET", "/iserver/account/orders", params={"force": "true"})
        return await self.ibkr._request("GET", "/iserver/account/orders")

    async def order_rules(self, *, conid: int, is_buy: bool) -> OrderResult:
        return await self.ibkr._request(
            "POST",
            "/iserver/contract/rules",
            json={
                "conid": conid,
                "exchange": "SMART",
                "isBuy": is_buy,
            },
        )

    async def account_summary(self, account_id: str) -> OrderResult:
        return await self.ibkr._request("GET", f"/portfolio/{account_id}/summary")

    async def revalidate_positions(self, account_id: str) -> OrderResult:
        return await self.ibkr._request(
            "POST",
            f"/portfolio/{account_id}/positions/invalidate",
            json={},
        )

    async def trades(self, *, days: int) -> OrderResult:
        return await self.ibkr._request(
            "GET",
            "/iserver/account/trades",
            params={"days": days},
        )

    async def position_page(self, account_id: str, page: int) -> OrderResult:
        return await self.ibkr._request("GET", f"/portfolio/{account_id}/positions/{page}")

    async def ledger(self, account_id: str) -> OrderResult:
        return await self.ibkr._request("GET", f"/portfolio/{account_id}/ledger")

    async def all_periods(self, account_id: str) -> OrderResult:
        return await self.ibkr._request(
            "POST",
            "/pa/allperiods",
            json={"acctIds": [account_id]},
        )
