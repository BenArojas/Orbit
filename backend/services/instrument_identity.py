"""
Instrument identity service.

Owns the local conid -> display metadata cache used across Orbit modules.
"""

from __future__ import annotations

from typing import Any

from exceptions import InstrumentCacheMissError
from services.db import DatabaseService


class InstrumentIdentityService:
    """Read and write local display identity for IBKR conids."""

    def __init__(self, db: DatabaseService) -> None:
        self.db = db

    async def get(self, conid: int) -> dict:
        instrument = await self.db.get_instrument(conid)
        if instrument is None:
            raise InstrumentCacheMissError(conid)
        return instrument

    async def get_many(self, conids: list[int]) -> list[dict]:
        return await self.db.get_instruments_by_conids(conids)

    async def cache_snapshot_identity(self, conid: int, row: dict[str, Any]) -> None:
        symbol = self._first_text(row, ("55", "symbol", "ticker", "SYM"))
        if not symbol:
            return

        await self.db.upsert_instrument(
            conid=conid,
            symbol=symbol,
            company_name=self._first_text(
                row,
                ("7051", "companyName", "company_name", "companyHeader", "name", "N"),
            ),
            sec_type=self._first_text(
                row,
                ("secType", "sec_type", "assetClass", "asset_class"),
                default="STK",
            ),
        )

    @staticmethod
    def _first_text(
        row: dict[str, Any],
        keys: tuple[str, ...],
        default: str = "",
    ) -> str:
        for key in keys:
            value = row.get(key)
            if value is not None and str(value).strip():
                return str(value).strip()
        return default
