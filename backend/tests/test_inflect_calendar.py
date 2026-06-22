"""Calendar-aggregation tests for InflectService.

Protects promise #3: open positions must not appear in the PnL calendar.
Uses a real temp-file DatabaseService and a fake account resolver so no
IBKR call is made.
"""

import os
import tempfile
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from services.db import DatabaseService
from services.inflect.service import InflectService

ET = ZoneInfo("US/Eastern")


def _et_ms(year, month, day, hour=12, minute=0) -> int:
    dt = datetime(year, month, day, hour, minute, tzinfo=ET)
    return int(dt.timestamp() * 1000)


class _FakeMoon:
    """Stand-in for MoonMarketService — only account resolution is used."""

    async def _resolve_account_id(self, account_id):
        return account_id or "DU1"


@pytest.fixture
async def svc():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    db = DatabaseService(db_path=path)
    await db.initialize()
    service = InflectService(ibkr=None, db=db, moonmarket=_FakeMoon())
    try:
        yield service, db
    finally:
        await db.close()
        try:
            os.unlink(path)
        except OSError:
            pass


@pytest.mark.asyncio
async def test_open_trade_excluded_from_calendar(svc):
    service, db = svc
    # An unflattened position must not appear in any day bucket.
    await db.upsert_fills([
        {
            "execution_id": "open-only", "account_id": "DU1", "conid": 7,
            "side": "BUY", "quantity": 10, "price": 10.0, "net_amount": 100.0,
            "commission": 0.0, "sec_type": "STK", "symbol": "AAPL",
            "trade_time": "t1", "trade_time_ms": _et_ms(2026, 6, 5, 9),
        },
    ])
    resp = await service.calendar("DU1", 2026, 6)
    assert resp.days == []
    assert resp.total_net_pnl == 0.0
    assert resp.days_traded == 0
