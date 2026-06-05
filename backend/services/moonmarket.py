"""
MoonMarket service — portfolio account, position, allocation, and performance data.

This service keeps MoonMarket-specific shaping out of the router while still
using IBKRService as the only gateway to Interactive Brokers.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any, Optional

from exceptions import IBKRError
from models import (
    MoonMarketAccount,
    MoonMarketAccountFunds,
    MoonMarketAccountsResponse,
    MoonMarketAllocationItem,
    MoonMarketLiveOrder,
    MoonMarketLiveOrdersResponse,
    MoonMarketOrderRulesResponse,
    MoonMarketPerformanceResponse,
    MoonMarketPortfolioResponse,
    MoonMarketPositionsRevalidateResponse,
    MoonMarketPosition,
    MoonMarketSeries,
    MoonMarketTrade,
    MoonMarketTradeSummary,
    MoonMarketTradesResponse,
)
from services.db import DatabaseService
from services.ibkr import IBKRService

log = logging.getLogger("parallax.moonmarket")
CASH_CONID = 0
PERFORMANCE_CACHE_TTL_SECONDS = 15 * 60
_PERFORMANCE_ALL_PERIODS_CACHE: dict[tuple[int, str], tuple[float, Any]] = {}


class MoonMarketAccountNotFoundError(ValueError):
    """Raised when a requested IBKR account id is not available."""


def _safe_float(value: Any, default: float = 0.0) -> float:
    if value is None or value == "":
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _safe_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _first_text(row: dict[str, Any], keys: tuple[str, ...], default: str = "") -> str:
    for key in keys:
        value = row.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return default


def _first_value(row: dict[str, Any], keys: tuple[str, ...]) -> Any:
    for key in keys:
        value = row.get(key)
        if value is not None and value != "":
            return value
    return None


def _bool_value(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes", "paper", "demo", "simulated"}:
            return True
        if normalized in {"false", "0", "no", "live"}:
            return False
    return None


class MoonMarketService:
    """Normalize MoonMarket data from IBKR Client Portal payloads."""

    def __init__(self, ibkr: IBKRService) -> None:
        self.ibkr = ibkr

    async def accounts(self) -> MoonMarketAccountsResponse:
        raw_accounts = await self.ibkr.brokerage_accounts()
        selected_id = self._selected_account_id(raw_accounts)
        accounts = [
            MoonMarketAccount(
                account_id=account_id,
                label=self._account_label(row, account_id),
                selected=account_id == selected_id,
                is_paper=self._account_is_paper(row, account_id),
            )
            for row in raw_accounts
            if (account_id := self._account_id(row))
        ]
        return MoonMarketAccountsResponse(
            accounts=accounts,
            selected_account_id=selected_id,
        )

    async def portfolio(self, account_id: str | None = None) -> MoonMarketPortfolioResponse:
        resolved_account_id = await self._resolve_account_id(account_id)
        rows = await self._fetch_position_rows(resolved_account_id)
        positions = [position for row in rows if (position := self._position_from_row(row))]
        if cash_position := await self._fetch_cash_position(resolved_account_id):
            positions.append(cash_position)
        positions.sort(key=lambda position: abs(position.market_value), reverse=True)

        total_market_value = round(sum(abs(position.market_value) for position in positions), 2)
        total_unrealized_pnl = round(sum(position.unrealized_pnl for position in positions), 2)
        allocation = [
            MoonMarketAllocationItem(
                conid=position.conid,
                symbol=position.symbol,
                label=position.description or position.symbol,
                contract_desc=position.contract_desc,
                value=round(abs(position.market_value), 2),
                percent=round((abs(position.market_value) / total_market_value) * 100, 2)
                if total_market_value
                else 0.0,
                asset_class=position.asset_class,
                unrealized_pnl=position.unrealized_pnl,
                daily_pnl=position.daily_pnl,
                pnl_percent=position.pnl_percent,
                daily_pnl_percent=position.daily_pnl_percent,
            )
            for position in positions
        ]

        return MoonMarketPortfolioResponse(
            account_id=resolved_account_id,
            total_market_value=total_market_value,
            total_unrealized_pnl=total_unrealized_pnl,
            positions=positions,
            allocation=allocation,
        )

    async def performance(self, account_id: str | None = None, period: str = "1Y") -> MoonMarketPerformanceResponse:
        resolved_account_id = await self._resolve_account_id(account_id)
        all_periods = await self._fetch_all_periods(resolved_account_id)
        period_payload = self._all_period_payload(all_periods, resolved_account_id, period)
        cumulative_return = self._series_from_all_periods_payload(period_payload, "cps")
        period_return = self._series_from_all_periods_payload(period_payload, "tpps")
        if not period_return.values:
            period_return = self._delta_series(cumulative_return)
        return MoonMarketPerformanceResponse(
            account_id=resolved_account_id,
            period=period,
            nav=self._series_from_all_periods_payload(period_payload, "nav"),
            cumulative_return=cumulative_return,
            period_return=period_return,
        )

    async def trades(
        self,
        account_id: str | None = None,
        days: int = 7,
        db: DatabaseService | None = None,
    ) -> MoonMarketTradesResponse:
        resolved_account_id = await self._resolve_account_id(account_id)
        bounded_days = max(1, min(int(days), 7))
        payload = await self.ibkr._request("GET", "/iserver/account/trades", params={"days": bounded_days})
        trade_rows = [
            (row, trade)
            for row in self._trade_rows(payload)
            if (trade := self._trade_from_row(row, resolved_account_id)) is not None
            and self._within_days(trade.trade_time_ms, bounded_days)
        ]
        trades = [trade for _, trade in trade_rows]
        trades.sort(key=lambda trade: trade.trade_time_ms or 0, reverse=True)
        if db is not None:
            await db.upsert_fills(
                [
                    {
                        **trade.model_dump(),
                        "raw_json": row,
                    }
                    for row, trade in trade_rows
                ]
            )
        return MoonMarketTradesResponse(
            account_id=resolved_account_id,
            days=bounded_days,
            trades=trades,
            summary=self._trade_summary(trades),
        )

    async def live_orders(self, account_id: str | None = None) -> MoonMarketLiveOrdersResponse:
        resolved_account_id = await self._resolve_account_id(account_id)
        await self.ibkr._request("GET", "/iserver/account/orders", params={"force": "true"})
        payload = await self.ibkr._request("GET", "/iserver/account/orders")
        orders = [
            order
            for row in self._order_rows(payload)
            if (order := self._live_order_from_row(row)) is not None
        ]
        return MoonMarketLiveOrdersResponse(account_id=resolved_account_id, orders=orders)

    async def revalidate_positions(self, account_id: str) -> MoonMarketPositionsRevalidateResponse:
        resolved_account_id = await self._resolve_account_id(account_id)
        payload = await self.ibkr._request(
            "POST",
            f"/portfolio/{resolved_account_id}/positions/invalidate",
            json={},
        )
        positions = payload if isinstance(payload, list) else []
        return MoonMarketPositionsRevalidateResponse(
            account_id=resolved_account_id,
            positions=positions,
        )

    async def order_rules(
        self,
        *,
        account_id: str,
        conid: int,
        side: str,
    ) -> MoonMarketOrderRulesResponse:
        """Fetch contract order rules for a conid/side.

        The account id is only the requesting context echoed back on the
        response; it is NOT a server-side filter. IBKR's
        ``/iserver/contract/rules`` endpoint takes no account parameter, so the
        rules returned are the same regardless of which account is selected.
        """
        resolved_account_id = await self._resolve_account_id(account_id)
        normalized_side = "SELL" if side.upper() == "SELL" else "BUY"
        payload = await self.ibkr._request(
            "POST",
            "/iserver/contract/rules",
            json={
                "conid": conid,
                "exchange": "SMART",
                "isBuy": normalized_side == "BUY",
            },
        )
        rules = payload if isinstance(payload, dict) else {}
        return MoonMarketOrderRulesResponse(
            account_id=resolved_account_id,
            conid=conid,
            side=normalized_side,
            rules=rules,
        )

    async def _resolve_account_id(self, account_id: str | None) -> str:
        raw_accounts = await self.ibkr.brokerage_accounts()
        account_ids = [item for row in raw_accounts if (item := self._account_id(row))]
        if account_id:
            if account_id in account_ids:
                return account_id
            raise MoonMarketAccountNotFoundError(f"Unknown account_id: {account_id}")

        selected_id = self._selected_account_id(raw_accounts)
        if selected_id:
            return selected_id
        if account_ids:
            return account_ids[0]
        raise MoonMarketAccountNotFoundError("No IBKR accounts are available")

    async def _fetch_position_rows(self, account_id: str) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        page = 0
        while True:
            payload = await self.ibkr._request("GET", f"/portfolio/{account_id}/positions/{page}")
            page_rows = self._position_page_rows(payload)
            if not page_rows:
                break
            rows.extend(page_rows)
            page += 1
        return rows

    async def _fetch_cash_position(self, account_id: str) -> MoonMarketPosition | None:
        try:
            payload = await self.ibkr._request("GET", f"/portfolio/{account_id}/ledger")
        except IBKRError as exc:
            log.warning("MoonMarket cash ledger unavailable for %s: %s", account_id, exc)
            return None

        ledger = self._base_ledger(payload)
        if not ledger:
            return None

        cash_balance = self._optional_float(
            _first_value(ledger, ("cashbalance", "cashBalance", "settledCash", "cash", "cashBalanceFXSegment"))
        )
        if cash_balance is None or cash_balance <= 0:
            return None

        currency = _first_text(ledger, ("currency", "secondkey", "secondKey"), "USD")
        if currency.upper() == "BASE":
            currency = "USD"

        return MoonMarketPosition(
            conid=CASH_CONID,
            symbol="CASH",
            description=f"{currency.upper()} cash",
            asset_class="CASH",
            quantity=round(cash_balance, 2),
            last_price=1.0,
            average_cost=1.0,
            market_value=round(cash_balance, 2),
            unrealized_pnl=0.0,
            daily_pnl=0.0,
            pnl_percent=0.0,
            daily_pnl_percent=0.0,
            currency=currency.upper(),
        )

    async def account_funds(self, account_id: str) -> MoonMarketAccountFunds:
        resolved = await self._resolve_account_id(account_id)
        payload = await self.ibkr._request("GET", f"/portfolio/{resolved}/summary")
        summary = payload if isinstance(payload, dict) else {}
        return MoonMarketAccountFunds(
            account_id=resolved,
            buying_power=self._summary_amount(summary, ("buyingpower", "buyingPower")),
            available_funds=self._summary_amount(summary, ("availablefunds", "availableFunds")),
            cash=self._summary_amount(summary, ("totalcashvalue", "totalCashValue", "cashbalance")),
            currency=self._summary_currency(summary),
        )

    @staticmethod
    def _summary_amount(summary: dict[str, Any], keys: tuple[str, ...]) -> Optional[float]:
        for key in keys:
            value = summary.get(key)
            if isinstance(value, dict):
                value = value.get("amount")
            if isinstance(value, (int, float)):
                return float(value)
        return None

    @staticmethod
    def _summary_currency(summary: dict[str, Any]) -> str:
        for key in ("buyingpower", "availablefunds", "totalcashvalue"):
            value = summary.get(key)
            if isinstance(value, dict) and isinstance(value.get("currency"), str):
                return value["currency"]
        return "USD"

    async def _fetch_all_periods(self, account_id: str) -> Any:
        cache_key = (id(self.ibkr), account_id)
        now = time.monotonic()
        cached = _PERFORMANCE_ALL_PERIODS_CACHE.get(cache_key)
        if cached is not None:
            cached_at, payload = cached
            if now - cached_at < PERFORMANCE_CACHE_TTL_SECONDS:
                return payload

        payload = await self.ibkr._request(
            "POST",
            "/pa/allperiods",
            json={"acctIds": [account_id]},
        )
        _PERFORMANCE_ALL_PERIODS_CACHE[cache_key] = (now, payload)
        return payload

    def _position_from_row(self, row: dict[str, Any]) -> MoonMarketPosition | None:
        conid = _safe_int(row.get("conid") or row.get("contractId"))
        if conid is None:
            return None

        symbol = _first_text(row, ("ticker", "symbol", "contractDesc", "fullName"), f"#{conid}")
        description = _first_text(row, ("name", "companyName", "description", "fullName"), symbol)
        asset_class = _first_text(row, ("assetClass", "asset_class", "secType", "sectype"))
        # For options IBKR ships the full contract string in contractDesc while
        # ticker/name only carry the underlying + company name. Capture it so the
        # frontend can render strike/expiry/right.
        contract_desc = (
            _first_text(row, ("contractDesc", "contract_desc", "fullName"), "") or None
            if asset_class.upper() == "OPT"
            else None
        )
        market_value = _safe_float(row.get("mktValue") or row.get("marketValue") or row.get("value"))
        unrealized_pnl = round(_safe_float(row.get("unrealizedPnl") or row.get("unrealized_pnl")), 2)
        daily_pnl = self._optional_float(row.get("dailyPnl") or row.get("daily_pnl"))
        return MoonMarketPosition(
            conid=conid,
            symbol=symbol,
            description=description,
            contract_desc=contract_desc,
            asset_class=asset_class,
            quantity=_safe_float(row.get("position") or row.get("quantity")),
            last_price=self._optional_float(row.get("mktPrice") or row.get("last_price") or row.get("lastPrice")),
            average_cost=self._optional_float(row.get("avgCost") or row.get("avgPrice") or row.get("average_cost")),
            market_value=round(market_value, 2),
            unrealized_pnl=unrealized_pnl,
            daily_pnl=daily_pnl,
            pnl_percent=self._percent_change(unrealized_pnl, abs(market_value) - unrealized_pnl),
            daily_pnl_percent=self._percent_change(daily_pnl, abs(market_value) - (daily_pnl or 0.0))
            if daily_pnl is not None
            else None,
            currency=_first_text(row, ("currency",), "USD"),
        )

    def _account_is_paper(self, row: dict[str, Any], account_id: str) -> bool:
        for key in ("isPaper", "is_paper", "paper", "paperTrading", "isPaperTrading"):
            if key in row:
                explicit = _bool_value(row.get(key))
                if explicit is not None:
                    return explicit

        account_type = _first_text(
            row,
            ("type", "accountType", "tradingType", "acctType", "category"),
        ).lower()
        if any(token in account_type for token in ("paper", "demo", "simulated")):
            return True
        if "live" in account_type:
            return False

        return account_id.upper().startswith("DU")

    def _trade_from_row(self, row: dict[str, Any], account_id: str) -> MoonMarketTrade | None:
        row_account_id = _first_text(row, ("account_id", "accountId", "acctId", "acct_id"), account_id)
        if row_account_id != account_id:
            return None

        execution_id = _first_text(row, ("execution_id", "executionId", "execId", "executionID"))
        conid = _safe_int(_first_value(row, ("conid", "contractId", "contract_id")))
        side = self._normalize_side(_first_value(row, ("side", "buySell", "transactionType")))
        sec_type = _first_text(row, ("sec_type", "secType", "assetClass")) or None
        price = self._optional_float(_first_value(row, ("price", "tradePrice")))
        net_amount = self._optional_float(_first_value(row, ("net_amount", "netAmount")))
        quantity = self._trade_quantity(row, sec_type=sec_type, price=price, net_amount=net_amount)
        trade_time_ms = self._timestamp_ms(_first_value(row, ("trade_time_r", "tradeTimeR", "time", "trade_time")))
        if not execution_id or conid is None or side is None or quantity is None:
            return None

        return MoonMarketTrade(
            execution_id=execution_id,
            account_id=account_id,
            conid=conid,
            symbol=_first_text(row, ("symbol", "ticker"), f"#{conid}") or None,
            description=_first_text(row, ("order_description", "orderDescription", "description", "orderDesc")) or None,
            side=side,
            quantity=quantity,
            price=price,
            net_amount=net_amount,
            commission=self._positive_optional_float(_first_value(row, ("commission", "commissions"))),
            sec_type=sec_type,
            trade_time=self._timestamp_iso(trade_time_ms),
            trade_time_ms=trade_time_ms,
        )

    def _live_order_from_row(self, row: dict[str, Any]) -> MoonMarketLiveOrder | None:
        order_id = _first_text(row, ("order_id", "orderId", "id"))
        if not order_id:
            return None
        conid = _safe_int(_first_value(row, ("conid", "contractId", "contract_id")))
        return MoonMarketLiveOrder(
            order_id=order_id,
            conid=conid,
            symbol=_first_text(row, ("symbol", "ticker"), f"#{conid}" if conid is not None else "") or None,
            description=_first_text(row, ("description", "orderDesc", "order_description", "orderDescription")) or None,
            side=_first_text(row, ("side", "buySell"), "UNKNOWN"),
            order_type=_first_text(row, ("order_type", "orderType", "origOrderType", "type")) or None,
            quantity=self._optional_float(
                _first_value(row, ("quantity", "totalQuantity", "total_quantity", "totalSize"))
            ),
            remaining_quantity=self._optional_float(
                _first_value(row, ("remaining_quantity", "remainingQuantity", "remaining"))
            ),
            limit_price=self._optional_float(_first_value(row, ("limit_price", "limitPrice", "price"))),
            aux_price=self._optional_float(_first_value(row, ("aux_price", "auxPrice"))),
            trailing_type=_first_text(row, ("trailing_type", "trailingType")) or None,
            trailing_amt=self._optional_float(_first_value(row, ("trailing_amt", "trailingAmt"))),
            outside_rth=bool(_bool_value(_first_value(row, ("outside_rth", "outsideRTH", "outsideRth")))),
            tif=_first_text(row, ("tif", "timeInForce")) or None,
            status=_first_text(row, ("status", "orderStatus")) or None,
        )

    @staticmethod
    def _account_id(row: dict[str, Any]) -> str | None:
        value = row.get("accountId") or row.get("account_id") or row.get("id") or row.get("acctId")
        if value is None or not str(value).strip():
            return None
        return str(value).strip()

    @staticmethod
    def _account_label(row: dict[str, Any], account_id: str) -> str:
        return _first_text(row, ("accountTitle", "label", "alias", "name"), account_id)

    def _selected_account_id(self, raw_accounts: list[dict[str, Any]]) -> str | None:
        selected = getattr(self.ibkr.state, "selected_account", None)
        if selected:
            return str(selected)
        for row in raw_accounts:
            if row.get("selected") and (account_id := self._account_id(row)):
                return account_id
        return self._account_id(raw_accounts[0]) if raw_accounts else None

    @staticmethod
    def _position_page_rows(payload: Any) -> list[dict[str, Any]]:
        if isinstance(payload, list):
            return [row for row in payload if isinstance(row, dict)]
        if isinstance(payload, dict):
            for key in ("positions", "data", "items"):
                value = payload.get(key)
                if isinstance(value, list):
                    return [row for row in value if isinstance(row, dict)]
        return []

    @staticmethod
    def _trade_rows(payload: Any) -> list[dict[str, Any]]:
        if isinstance(payload, list):
            return [row for row in payload if isinstance(row, dict)]
        if isinstance(payload, dict):
            for key in ("trades", "executions", "data", "items"):
                value = payload.get(key)
                if isinstance(value, list):
                    return [row for row in value if isinstance(row, dict)]
        return []

    @staticmethod
    def _order_rows(payload: Any) -> list[dict[str, Any]]:
        if isinstance(payload, list):
            return [row for row in payload if isinstance(row, dict)]
        if isinstance(payload, dict):
            for key in ("orders", "data", "items"):
                value = payload.get(key)
                if isinstance(value, list):
                    return [row for row in value if isinstance(row, dict)]
        return []

    @staticmethod
    def _optional_float(value: Any) -> float | None:
        if value is None or value == "":
            return None
        try:
            return round(float(value), 2)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _positive_optional_float(value: Any) -> float | None:
        normalized = MoonMarketService._optional_float(value)
        return abs(normalized) if normalized is not None else None

    def _trade_quantity(
        self,
        row: dict[str, Any],
        *,
        sec_type: str | None,
        price: float | None,
        net_amount: float | None,
    ) -> float | None:
        recovered = self._stock_quantity_from_cash(sec_type, price, net_amount)
        quantity = self._optional_float(_first_value(row, ("quantity", "qty", "size")))
        if quantity is None:
            return recovered

        if recovered is None:
            return quantity

        tolerance = max(0.01, abs(quantity) * 0.05)
        if abs(recovered - abs(quantity)) > tolerance:
            return recovered
        return quantity

    @staticmethod
    def _stock_quantity_from_cash(
        sec_type: str | None,
        price: float | None,
        net_amount: float | None,
    ) -> float | None:
        if str(sec_type or "").upper() not in {"STK", "ETF"}:
            return None
        if price is None or price <= 0 or net_amount is None:
            return None

        recovered = abs(net_amount) / price
        if recovered <= 0:
            return None

        rounded = round(recovered)
        if abs(recovered - rounded) <= max(0.01, rounded * 0.001):
            return float(rounded)
        return round(recovered, 4)

    @staticmethod
    def _normalize_side(value: Any) -> str | None:
        text = str(value or "").upper().strip()
        if text in {"B", "BOT", "BUY"}:
            return "BUY"
        if text in {"S", "SLD", "SELL"}:
            return "SELL"
        return None

    @staticmethod
    def _timestamp_ms(value: Any) -> int | None:
        if value is None or value == "":
            return None
        if isinstance(value, (int, float)):
            timestamp = int(value)
            return timestamp * 1000 if timestamp < 10_000_000_000 else timestamp
        text = str(value).strip()
        try:
            timestamp = int(float(text))
            return timestamp * 1000 if timestamp < 10_000_000_000 else timestamp
        except ValueError:
            pass
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            return None
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return int(parsed.timestamp() * 1000)

    @staticmethod
    def _timestamp_iso(timestamp_ms: int | None) -> str:
        if timestamp_ms is None:
            return datetime.now(timezone.utc).isoformat(timespec="seconds")
        return datetime.fromtimestamp(timestamp_ms / 1000, timezone.utc).isoformat(timespec="seconds")

    @staticmethod
    def _within_days(timestamp_ms: int | None, days: int) -> bool:
        if timestamp_ms is None:
            return True
        cutoff_ms = int(datetime.now(timezone.utc).timestamp() * 1000) - days * 24 * 60 * 60 * 1000
        return timestamp_ms >= cutoff_ms

    @staticmethod
    def _trade_summary(trades: list[MoonMarketTrade]) -> MoonMarketTradeSummary:
        return MoonMarketTradeSummary(
            total_trades=len(trades),
            total_volume=round(sum(trade.quantity for trade in trades), 2),
            total_commissions=round(sum(trade.commission or 0.0 for trade in trades), 2),
            net_cash=round(sum(trade.net_amount or 0.0 for trade in trades), 2),
            buy_count=sum(1 for trade in trades if trade.side == "BUY"),
            sell_count=sum(1 for trade in trades if trade.side == "SELL"),
        )

    def _series_from_payload(
        self,
        payload: Any,
        key: str,
        value_keys: tuple[str, ...],
    ) -> MoonMarketSeries:
        section = payload.get(key, {}) if isinstance(payload, dict) else {}
        if not isinstance(section, dict):
            return MoonMarketSeries(dates=[], values=[])

        dates = self._string_list(section.get("dates") or section.get("date"))
        source = self._first_present(section, value_keys)
        if source is section.get("data"):
            nested = self._series_from_data_rows(source, value_keys)
            if nested:
                values = nested
            else:
                values = self._numeric_list(source)
        else:
            values = self._numeric_list(source)
        if dates or values:
            return MoonMarketSeries(dates=dates[: len(values)], values=values[: len(dates)] if dates else values)

        points = section.get("points")
        if isinstance(points, list):
            point_dates: list[str] = []
            point_values: list[float] = []
            for point in points:
                if not isinstance(point, dict):
                    continue
                point_dates.append(str(point.get("date") or point.get("time") or ""))
                point_values.append(_safe_float(self._first_present(point, value_keys)))
            return MoonMarketSeries(dates=point_dates, values=point_values)

        return MoonMarketSeries(dates=[], values=[])

    def _all_period_payload(self, payload: Any, account_id: str, period: str) -> dict[str, Any]:
        if not isinstance(payload, dict):
            return {}

        account_payload = payload.get(account_id)
        if isinstance(account_payload, dict):
            period_payload = account_payload.get(period)
            return period_payload if isinstance(period_payload, dict) else {}

        included = payload.get("included")
        if isinstance(included, list):
            for included_account in included:
                account_payload = payload.get(str(included_account))
                if isinstance(account_payload, dict):
                    period_payload = account_payload.get(period)
                    if isinstance(period_payload, dict):
                        return period_payload

        return {}

    def _series_from_all_periods_payload(self, period_payload: dict[str, Any], key: str) -> MoonMarketSeries:
        if not isinstance(period_payload, dict):
            return MoonMarketSeries(dates=[], values=[])

        dates = self._string_list(period_payload.get("dates") or period_payload.get("date"))
        values = self._numeric_list(period_payload.get(key))
        if dates or values:
            return MoonMarketSeries(dates=dates[: len(values)], values=values[: len(dates)] if dates else values)
        return MoonMarketSeries(dates=[], values=[])

    @staticmethod
    def _delta_series(series: MoonMarketSeries) -> MoonMarketSeries:
        if not series.values:
            return MoonMarketSeries(dates=series.dates, values=[])
        previous = 0.0
        values: list[float] = []
        for value in series.values:
            values.append(round(value - previous, 6))
            previous = value
        return MoonMarketSeries(dates=series.dates, values=values)

    @staticmethod
    def _base_ledger(payload: Any) -> dict[str, Any] | None:
        if not isinstance(payload, dict):
            return None

        for key in ("BASE", "LedgerListBASE"):
            value = payload.get(key)
            if isinstance(value, dict):
                return value

        result = payload.get("result")
        if isinstance(result, list):
            for row in result:
                if not isinstance(row, dict):
                    continue
                key = str(row.get("key") or "").upper()
                second_key = str(row.get("secondKey") or row.get("secondkey") or "").upper()
                if key == "LEDGERLISTBASE" or second_key == "BASE":
                    return row

        return None

    @staticmethod
    def _percent_change(numerator: float | None, basis: float | None) -> float | None:
        if numerator is None or basis is None or basis <= 0:
            return None
        return round((numerator / basis) * 100, 2)

    def _series_from_data_rows(self, rows: Any, value_keys: tuple[str, ...]) -> list[float]:
        if not isinstance(rows, list):
            return []
        for row in rows:
            if not isinstance(row, dict):
                continue
            values = self._numeric_list(self._first_present(row, value_keys))
            if values:
                return values
        return []

    @staticmethod
    def _first_present(row: dict[str, Any], keys: tuple[str, ...]) -> Any:
        for key in keys:
            if key in row:
                return row[key]
        return None

    @staticmethod
    def _string_list(value: Any) -> list[str]:
        if isinstance(value, list):
            return [str(item) for item in value]
        return []

    @staticmethod
    def _numeric_list(value: Any) -> list[float]:
        if isinstance(value, list):
            return [_safe_float(item) for item in value]
        return []
