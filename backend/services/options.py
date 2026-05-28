"""MoonMarket options-chain read model."""

from __future__ import annotations

from typing import Literal

from models import MoonMarketOptionContract
from services.ibkr import IBKRService, _safe_float

OPTION_QUOTE_FIELDS = "31,84,86,85,88,7762,7308"


class OptionLookupError(LookupError):
    """Raised when IBKR cannot resolve option-chain data."""


class OptionService:
    """Normalize IBKR option secdef and snapshot payloads for MoonMarket."""

    def __init__(self, ibkr: IBKRService) -> None:
        self.ibkr = ibkr

    async def expirations(self, underlying_conid: int, symbol: str) -> list[str]:
        symbol_hint = symbol.strip().upper()
        if not symbol_hint:
            raise OptionLookupError("symbol is required to load IBKR option expirations")
        expirations = await self.ibkr.option_expirations(symbol_hint, underlying_conid)
        if not expirations:
            raise OptionLookupError(f"No option expirations found for {symbol_hint}")
        return expirations

    async def strikes(self, underlying_conid: int, expiration: str) -> list[float]:
        raw = await self.ibkr.option_strikes(underlying_conid, expiration)
        values: set[float] = set()
        for side in ("call", "put"):
            for strike in raw.get(side) or []:
                parsed = _safe_float(strike)
                if parsed is not None:
                    values.add(parsed)
        return sorted(values)

    async def contract_pair(
        self,
        underlying_conid: int,
        expiration: str,
        strike: float,
    ) -> dict[str, MoonMarketOptionContract]:
        call_rows = await self.ibkr.option_contract_info(underlying_conid, expiration, strike, "C")
        put_rows = await self.ibkr.option_contract_info(underlying_conid, expiration, strike, "P")
        raw_contracts = [
            row
            for row in (
                call_rows[0] if call_rows else None,
                put_rows[0] if put_rows else None,
            )
            if row
        ]
        conids = [int(row["conid"]) for row in raw_contracts if row.get("conid") is not None]
        quote_rows = await self.ibkr.snapshot(conids=conids, fields=OPTION_QUOTE_FIELDS) if conids else []
        quotes_by_conid: dict[int, dict[str, object]] = {}
        for row in quote_rows:
            try:
                row_conid = int(row.get("conid"))
            except (TypeError, ValueError):
                continue
            quotes_by_conid[row_conid] = row

        result: dict[str, MoonMarketOptionContract] = {}
        for row in raw_contracts:
            right = str(row.get("right") or "").upper()
            if right not in {"C", "P"}:
                continue
            side = "call" if right == "C" else "put"
            contract_id = int(row["conid"])
            quote = quotes_by_conid.get(contract_id, {})
            result[side] = self._contract(
                row=row,
                quote=quote,
                underlying_conid=underlying_conid,
                expiration=expiration,
                strike=strike,
                right=right,
            )
        return result

    def _contract(
        self,
        row: dict[str, object],
        quote: dict[str, object],
        underlying_conid: int,
        expiration: str,
        strike: float,
        right: Literal["C", "P"],
    ) -> MoonMarketOptionContract:
        side = "call" if right == "C" else "put"
        contract_id = int(row["conid"])
        return MoonMarketOptionContract(
            contractId=contract_id,
            underlyingConid=underlying_conid,
            expiration=expiration,
            strike=strike,
            right=right,
            type=side,
            symbol=str(row.get("symbol") or quote.get("55") or ""),
            lastPrice=_safe_float(quote.get("31") or quote.get("lastPrice")),
            bid=_safe_float(quote.get("84") or quote.get("bid")),
            ask=_safe_float(quote.get("86") or quote.get("ask")),
            volume=_safe_float(quote.get("7762") or quote.get("volume")),
            delta=_safe_float(quote.get("7308") or quote.get("delta")),
            bidSize=_safe_float(quote.get("85") or quote.get("bidSize")),
            askSize=_safe_float(quote.get("88") or quote.get("askSize")),
        )
