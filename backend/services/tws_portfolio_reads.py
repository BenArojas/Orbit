"""Read-only compatibility for retained portfolio screens, never order calls."""

from exceptions import IBKRRequestError


class TwsPortfolioReads:
    def __init__(self, adapter, db) -> None:
        self.adapter = adapter
        self.db = db

    def _account(self, account: str) -> None:
        if account != self.adapter.connected_account_id():
            raise IBKRRequestError(403, "Account does not match the connected TWS account")

    async def position_page(self, account_id: str, page: int) -> list[dict]:
        self._account(account_id)
        if page:
            return []
        positions = self.adapter.get_reconciliation().positions
        rows = []
        for p in positions:
            if p.account != account_id:
                continue
            if p.market_value is None or p.unrealized_pnl is None:
                raise IBKRRequestError(503, "Holdings valuation unavailable; read raw holdings in reconciliation")
            if p.currency != "USD":
                raise IBKRRequestError(422, "Non-USD holdings are outside Orbit v1 scope")
            rows.append({
                "conid": p.conid, "symbol": p.symbol, "position": p.position,
                "avgCost": p.avg_cost, "mktPrice": p.market_price,
                "mktValue": p.market_value, "unrealizedPnl": p.unrealized_pnl,
                "dailyPnl": p.daily_pnl, "currency": p.currency,
                "assetClass": p.sec_type, "account": p.account,
                "multiplier": p.multiplier, "strike": p.strike, "right": p.right, "expiry": p.expiry,
                "market_data_freshness": "unknown",
                "contractDesc": f"{p.symbol} {p.expiry or ''} {p.strike or ''} {p.right or ''} [{p.multiplier or ''}]",
            })
        return rows

    async def account_summary(self, account_id: str) -> dict:
        self._account(account_id)
        account = await self.adapter.data_account()
        summary = {}
        for tag, key in (("BuyingPower", "buyingpower"), ("AvailableFunds", "availablefunds"),
                         ("TotalCashValue", "totalcashvalue")):
            item = account["summary"].get(tag)
            if item:
                try:
                    amount = float(item["value"])
                except (TypeError, ValueError):
                    continue
                summary[key] = {"amount": amount, "currency": item["currency"]}
        return summary

    async def ledger(self, account_id: str) -> dict:
        summary = await self.account_summary(account_id)
        cash = summary.get("totalcashvalue")
        return {"BASE": {"cashbalance": cash["amount"], "currency": cash["currency"]}} if cash else {}

    async def live_orders(self) -> dict:
        return {"orders": [
            {**order.model_dump(), "limit_price": order.lmt_price, "aux_price": order.stop_price}
            for order in self.adapter.get_reconciliation().open_orders
        ]}

    async def trades(self, *, days: int) -> list[dict]:
        await self.adapter.flush_storage()
        rows = await self.db.broker_executions()
        return [{
            **row, "account_id": row["account"], "sec_type": row["sec_type"],
            "time": row["executed_at"],
            "commission": row["commission"]["amount"] if row["commission"] else None,
        } for row in rows]

    async def revalidate_positions(self, account_id: str) -> dict:
        self._account(account_id)
        return {"positions": await self.position_page(account_id, 0)}

    async def order_rules(self, **kwargs) -> dict:
        raise IBKRRequestError(503, "Broker order rules remain unavailable until the paper order-shape spike")

    async def all_periods(self, account_id: str) -> dict:
        raise IBKRRequestError(503, "Account performance curves are outside Orbit v1 scope")
