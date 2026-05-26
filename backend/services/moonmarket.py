"""
MoonMarket service — portfolio account, position, allocation, and performance data.

This service keeps MoonMarket-specific shaping out of the router while still
using IBKRService as the only gateway to Interactive Brokers.
"""

from __future__ import annotations

from typing import Any

from models import (
    MoonMarketAccount,
    MoonMarketAccountsResponse,
    MoonMarketAllocationItem,
    MoonMarketPerformanceResponse,
    MoonMarketPortfolioResponse,
    MoonMarketPosition,
    MoonMarketSeries,
)
from services.ibkr import IBKRService


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


class MoonMarketService:
    """Normalize MoonMarket data from IBKR Client Portal payloads."""

    def __init__(self, ibkr: IBKRService) -> None:
        self.ibkr = ibkr

    async def accounts(self) -> MoonMarketAccountsResponse:
        raw_accounts = await self.ibkr.ensure_accounts()
        selected_id = self._selected_account_id(raw_accounts)
        accounts = [
            MoonMarketAccount(
                account_id=account_id,
                label=self._account_label(row, account_id),
                selected=account_id == selected_id,
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
        positions.sort(key=lambda position: abs(position.market_value), reverse=True)

        total_market_value = round(sum(abs(position.market_value) for position in positions), 2)
        total_unrealized_pnl = round(sum(position.unrealized_pnl for position in positions), 2)
        allocation = [
            MoonMarketAllocationItem(
                conid=position.conid,
                symbol=position.symbol,
                label=position.description or position.symbol,
                value=round(abs(position.market_value), 2),
                percent=round((abs(position.market_value) / total_market_value) * 100, 2)
                if total_market_value
                else 0.0,
                asset_class=position.asset_class,
                unrealized_pnl=position.unrealized_pnl,
                daily_pnl=position.daily_pnl,
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
        payload = await self.ibkr._request(
            "POST",
            "/pa/performance",
            json={"acctIds": [resolved_account_id], "period": period},
        )
        return MoonMarketPerformanceResponse(
            account_id=resolved_account_id,
            period=period,
            nav=self._series_from_payload(payload, "nav", ("values", "navs", "data")),
            cumulative_return=self._series_from_payload(payload, "cps", ("values", "returns", "data")),
            period_return=self._series_from_payload(payload, "tpps", ("values", "returns", "data")),
        )

    async def _resolve_account_id(self, account_id: str | None) -> str:
        raw_accounts = await self.ibkr.ensure_accounts()
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

    def _position_from_row(self, row: dict[str, Any]) -> MoonMarketPosition | None:
        conid = _safe_int(row.get("conid") or row.get("contractId"))
        if conid is None:
            return None

        symbol = _first_text(row, ("ticker", "symbol", "contractDesc", "fullName"), f"#{conid}")
        description = _first_text(row, ("name", "companyName", "description", "fullName"), symbol)
        market_value = _safe_float(row.get("mktValue") or row.get("marketValue") or row.get("value"))
        return MoonMarketPosition(
            conid=conid,
            symbol=symbol,
            description=description,
            asset_class=_first_text(row, ("assetClass", "asset_class", "secType", "sectype")),
            quantity=_safe_float(row.get("position") or row.get("quantity")),
            last_price=self._optional_float(row.get("mktPrice") or row.get("last_price") or row.get("lastPrice")),
            average_cost=self._optional_float(row.get("avgCost") or row.get("avgPrice") or row.get("average_cost")),
            market_value=round(market_value, 2),
            unrealized_pnl=round(_safe_float(row.get("unrealizedPnl") or row.get("unrealized_pnl")), 2),
            daily_pnl=self._optional_float(row.get("dailyPnl") or row.get("daily_pnl")),
            currency=_first_text(row, ("currency",), "USD"),
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
    def _optional_float(value: Any) -> float | None:
        if value is None or value == "":
            return None
        try:
            return round(float(value), 2)
        except (TypeError, ValueError):
            return None

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
        values = self._numeric_list(self._first_present(section, value_keys))
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
