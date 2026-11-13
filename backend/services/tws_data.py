"""Product data over Orbit's one TWS connection; watchlists are local."""

from __future__ import annotations

import asyncio
import re
import sqlite3
from types import SimpleNamespace

from exceptions import IBKRError, IBKRConnectionError, IBKRRequestError, SymbolNotFoundError
from services.db import DatabaseService
from services.tws_broker_adapter import TwsBrokerAdapter
from services.tws_portfolio_reads import TwsPortfolioReads

BAR_SIZES = {
    "1min": "1 min", "5min": "5 mins", "15min": "15 mins", "30min": "30 mins",
    "1h": "1 hour", "4h": "4 hours", "1d": "1 day", "1w": "1 week", "1m": "1 month",
}


class TwsDataService:
    regular_hours_only = True

    def __init__(self, adapter: TwsBrokerAdapter, db: DatabaseService) -> None:
        self.adapter = adapter
        self.db = db
        self._snapshot_slots = asyncio.Semaphore(4)
        self.portfolio_reads = TwsPortfolioReads(adapter, db)

    @property
    def state(self):
        connected = self.adapter.is_connected()
        return SimpleNamespace(
            authenticated=connected, ws_connected=connected,
            selected_account=self.adapter.connected_account_id(),
            session_dropped=False, accounts_fetched=connected,
        )

    async def _request(self, *args, **kwargs):
        raise IBKRRequestError(503, "This legacy Client Portal feature is unavailable on the TWS data path")

    async def scanner_params(self):
        raise IBKRRequestError(503, "Legacy scans are outside Orbit v1 scope")

    async def scanner_run(self, *args, **kwargs):
        raise IBKRRequestError(503, "Legacy scans are outside Orbit v1 scope")

    async def brokerage_accounts(self) -> list[dict]:
        self.adapter._require_data_connection()
        account = self.adapter.connected_account_id()
        if account is None:
            raise IBKRRequestError(422, "Exactly one TWS account is required")
        return [{"accountId": account, "selected": True,
                 "isPaper": self.adapter.is_paper_port() and account.startswith("DU")}]

    def connection_status(self, legacy_status: dict) -> dict:
        connected = self.adapter.is_connected()
        return {
            **legacy_status, "source": "tws", "client_portal": legacy_status,
            "running": connected, "authenticated": connected, "auth_required": not connected,
            "state": "running" if connected else "error",
            "auth_message": "Connected to TWS / IB Gateway." if connected else "Connect to TWS / IB Gateway.",
            "error": None if connected else "TWS / IB Gateway is disconnected.",
            "session_dropped": False,
        }

    async def search(self, symbol: str, sec_type: str = "") -> list[dict]:
        rows = await self.adapter.search_contract_metadata(symbol, sec_type)
        for row in rows:
            await self.db.upsert_instrument(
                row["conid"], row["symbol"], row["companyHeader"], row["secType"]
            )
        return rows

    search_fresh = search

    async def security_definitions(self, conids: tuple[int, ...]) -> list[dict]:
        return list(await asyncio.gather(*(self.adapter.contract_metadata(c) for c in conids)))

    security_definitions_fresh = security_definitions

    async def contract_info(self, conid: int) -> dict:
        return await self.adapter.contract_metadata(conid)

    async def option_expirations(self, symbol: str, underlying_conid: int) -> list[str]:
        chains = await self.adapter.option_parameters(underlying_conid)
        return sorted({expiry for chain in chains for expiry in chain["expirations"]})

    async def option_strikes(self, underlying_conid: int, month: str) -> dict:
        chains = await self.adapter.option_parameters(underlying_conid)
        strikes = sorted({s for c in chains if month in c["expirations"] for s in c["strikes"]})
        return {"call": strikes, "put": strikes}

    async def option_contract_info(self, underlying_conid: int, month: str, strike: float, right: str) -> list[dict]:
        return await self.adapter.option_contracts(underlying_conid, month, strike, right)

    async def get_conid(self, symbol: str, sec_type: str = "", force_refresh: bool = False) -> int:
        rows = await self.search(symbol, sec_type)
        if not sec_type and any(row["secType"] == "STK" and row["symbol"].upper() == symbol.upper() for row in rows):
            rows = [row for row in rows if row["secType"] == "STK"]
        exact = {row["conid"] for row in rows if row["symbol"].upper() == symbol.upper()
                 and row["currency"] == "USD"}
        if len(exact) != 1:
            raise SymbolNotFoundError(f"{symbol}: missing or ambiguous TWS contract")
        return exact.pop()

    async def history(
        self, conid: int, period: str = "1m", bar: str = "30min", outside_rth: bool = False
    ) -> dict:
        match = re.fullmatch(r"([1-9]\d*)([dwmy])", period.lower())
        if match is None or bar not in BAR_SIZES:
            raise IBKRRequestError(422, f"Unsupported history request: {period}/{bar}")
        count, unit = int(match[1]), match[2]
        duration = f"{count * 7} D" if unit == "w" else f"{count} {dict(d='D', m='M', y='Y')[unit]}"
        try:
            # Orbit v1 is RTH-only, including legacy callers requesting extended data.
            return await self.adapter.historical_data(conid, duration=duration, bar_size=BAR_SIZES[bar])
        except (TimeoutError, OSError, RuntimeError) as exc:
            raise IBKRConnectionError("TWS historical data unavailable") from exc

    history_fresh = history

    async def history_bundled(self, conids: list[int], period: str = "1m", bar: str = "30min") -> dict:
        results = await asyncio.gather(
            *(self.history(c, period, bar) for c in conids), return_exceptions=True
        )
        items, errors = [], {}
        for conid, result in zip(conids, results):
            if isinstance(result, BaseException):
                if not isinstance(result, IBKRError):
                    raise result
                errors[str(conid)] = str(result)
            else:
                items.append({"conid": conid, "candles": [
                    {"time": b["t"] // 1000, "open": b["o"], "high": b["h"],
                     "low": b["l"], "close": b["c"], "volume": b["v"]}
                    for b in result["data"]
                ], "coverage": result["coverage"]})
        return {"items": items, "errors": errors}

    async def snapshot(self, conids: list[int], fields: str = "") -> list[dict]:
        async def one(conid: int) -> dict:
            async with self._snapshot_slots:
                metadata = await self.adapter.contract_metadata(conid)
                quote = await self.adapter.get_quote(conid, contract_info=metadata)
            close, last = quote.close, quote.last
            change = last - close if last is not None and close is not None else None
            return {
                "conid": conid, "55": metadata["symbol"], "7051": metadata["companyHeader"],
                "secType": metadata["secType"], "31": last, "84": quote.bid, "86": quote.ask,
                "7295": quote.open, "70": quote.high, "71": quote.low, "7741": close,
                "82": change, "83": change / close * 100 if change is not None and close else None,
                "market_data_type": quote.market_data_type,
                **{key: value for key, value in quote.model_dump(mode="json").items()
                   if key in ("received_at", "age_seconds", "freshness", "entry_data_eligible",
                              "unavailable_reason", "greeks")},
                "88": quote.bid_size, "85": quote.ask_size, "7762": quote.volume,
            }
        return list(await asyncio.gather(*(one(c) for c in conids)))

    async def get_watchlists(self) -> list[dict]:
        return await self.db.local_watchlists()

    async def get_watchlist_items(self, watchlist_id: str) -> list[dict]:
        return await self.db.local_watchlist_rows(watchlist_id)

    async def resolve_watchlist_id(self, name: str) -> str | None:
        return next((r["id"] for r in await self.get_watchlists() if r["name"] == name), None)

    async def get_watchlist_members(self, name: str) -> list[dict]:
        watchlist_id = await self.resolve_watchlist_id(name)
        if watchlist_id is None:
            return []
        return [{"conid": int(row.get("conid") or row["C"]),
                 "symbol": row.get("symbol") or row.get("ticker") or row.get("SYM") or ""}
                for row in await self.get_watchlist_items(watchlist_id)
                if row.get("conid") or row.get("C")]

    async def create_watchlist(self, name: str) -> dict:
        try:
            return await self.db.create_local_watchlist(name)
        except sqlite3.IntegrityError as exc:
            raise IBKRRequestError(409, "Watchlist name already exists") from exc

    async def delete_watchlist(self, watchlist_id: str) -> None:
        await self.db.delete_local_watchlist(watchlist_id)

    async def add_to_watchlist(self, watchlist_id: str, name: str, conid: int) -> bool:
        return await self.db.edit_local_watchlist(watchlist_id, conid)

    async def remove_from_watchlist(self, watchlist_id: str, name: str, conid: int) -> bool:
        return await self.db.edit_local_watchlist(watchlist_id, conid, remove=True)

    async def move_between_watchlists(self, conid: int, source_name: str, target_name: str) -> bool:
        source_id = await self.resolve_watchlist_id(source_name)
        target_id = await self.resolve_watchlist_id(target_name)
        if source_id is None or target_id is None:
            raise IBKRRequestError(404, "Source or target local watchlist not found")
        if source_id == target_id:
            return False
        await self.add_to_watchlist(target_id, target_name, conid)
        await self.remove_from_watchlist(source_id, source_name, conid)
        return True
