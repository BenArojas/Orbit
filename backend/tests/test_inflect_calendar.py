"""Calendar-aggregation tests for InflectService.

Exercises day bucketing by close date (US/Eastern), weekly rollups, month
totals, OPEN-trade exclusion, and the timezone edge at the month boundary.
Uses a real temp-file DatabaseService (the matcher reads fills from it) and a
fake account resolver so no IBKR call is made.
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


async def _round_trip(db, *, conid, open_ms, close_ms, entry, exit_, qty=10):
    """Upsert a buy→sell pair that closes at close_ms."""
    await db.upsert_fills([
        {
            "execution_id": f"{conid}-o-{open_ms}", "account_id": "DU1",
            "conid": conid, "side": "BUY", "quantity": qty, "price": entry,
            "net_amount": entry * qty, "commission": 0.0, "sec_type": "STK",
            "symbol": "AAPL", "trade_time": f"t{open_ms}", "trade_time_ms": open_ms,
        },
        {
            "execution_id": f"{conid}-c-{close_ms}", "account_id": "DU1",
            "conid": conid, "side": "SELL", "quantity": qty, "price": exit_,
            "net_amount": exit_ * qty, "commission": 0.0, "sec_type": "STK",
            "symbol": "AAPL", "trade_time": f"t{close_ms}", "trade_time_ms": close_ms,
        },
    ])


@pytest.mark.asyncio
async def test_two_trades_same_day_sum_and_count(svc):
    service, db = svc
    # Two round trips closing on 2026-06-02 (different conids).
    await _round_trip(db, conid=1, open_ms=_et_ms(2026, 6, 2, 9),
                      close_ms=_et_ms(2026, 6, 2, 10), entry=10.0, exit_=11.0)
    await _round_trip(db, conid=2, open_ms=_et_ms(2026, 6, 2, 11),
                      close_ms=_et_ms(2026, 6, 2, 12), entry=20.0, exit_=22.0)

    resp = await service.calendar("DU1", 2026, 6)
    days = {d.date: d for d in resp.days}
    assert "2026-06-02" in days
    # (11-10)*10 + (22-20)*10 = 10 + 20 = 30
    assert days["2026-06-02"].net_pnl == pytest.approx(30.0)
    assert days["2026-06-02"].trade_count == 2
    assert resp.total_net_pnl == pytest.approx(30.0)
    assert resp.days_traded == 1


@pytest.mark.asyncio
async def test_weekly_rollups(svc):
    service, db = svc
    # June 2026: Jun 1 is Monday → Sun-start grid week 1 = Jun 1–6.
    await _round_trip(db, conid=1, open_ms=_et_ms(2026, 6, 2, 9),
                      close_ms=_et_ms(2026, 6, 2, 10), entry=10.0, exit_=11.0)
    await _round_trip(db, conid=2, open_ms=_et_ms(2026, 6, 3, 9),
                      close_ms=_et_ms(2026, 6, 3, 10), entry=10.0, exit_=12.0)
    # Jun 10 (Wednesday) is in week 2.
    await _round_trip(db, conid=3, open_ms=_et_ms(2026, 6, 10, 9),
                      close_ms=_et_ms(2026, 6, 10, 10), entry=10.0, exit_=13.0)

    resp = await service.calendar("DU1", 2026, 6)
    weeks = {w.week_index: w for w in resp.weeks}
    # week 1: 10 + 20 = 30 over 2 trading days
    assert weeks[1].net_pnl == pytest.approx(30.0)
    assert weeks[1].trading_days == 2
    # week 2: 30 over 1 trading day
    assert weeks[2].net_pnl == pytest.approx(30.0)
    assert weeks[2].trading_days == 1


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


@pytest.mark.asyncio
async def test_timezone_edge_buckets_by_eastern_close(svc):
    service, db = svc
    # Close at 2026-06-01 22:00 ET (= 2026-06-02 02:00 UTC) → buckets to Jun 1.
    await _round_trip(db, conid=1, open_ms=_et_ms(2026, 6, 1, 20),
                      close_ms=_et_ms(2026, 6, 1, 22), entry=10.0, exit_=11.0)
    # Close at 2026-05-31 22:00 ET → previous month, excluded from June.
    await _round_trip(db, conid=2, open_ms=_et_ms(2026, 5, 31, 20),
                      close_ms=_et_ms(2026, 5, 31, 22), entry=10.0, exit_=11.0)

    resp = await service.calendar("DU1", 2026, 6)
    dates = {d.date for d in resp.days}
    assert dates == {"2026-06-01"}
    assert resp.days_traded == 1
