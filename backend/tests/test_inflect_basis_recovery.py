import os
import tempfile
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from services.db import DatabaseService
from services.inflect.pa_transactions import PaBackfillResult
from services.inflect.service import InflectService

ET = ZoneInfo("US/Eastern")


def _et_ms(year, month, day, hour=9, minute=30) -> int:
    dt = datetime(year, month, day, hour, minute, tzinfo=ET)
    return int(dt.timestamp() * 1000)


class _FakeMoon:
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


async def _seed_recent_sell(db: DatabaseService, *, execution_id="SELL-1") -> int:
    sell_ms = _et_ms(2026, 6, 1, 10)
    await db.upsert_fills(
        [
            {
                "execution_id": execution_id,
                "account_id": "DU1",
                "conid": 265598,
                "symbol": "AAPL",
                "side": "SELL",
                "quantity": 10,
                "price": 110.0,
                "commission": 1.0,
                "sec_type": "STK",
                "trade_time": "2026-06-01T10:00:00-04:00",
                "trade_time_ms": sell_ms,
                "raw_json": {"source": "iserver"},
            }
        ]
    )
    await db.enqueue_basis("DU1", 265598)
    return sell_ms


def _pa_result(*rows, days_used=365, rejected_long_history=False, fallback_days=None):
    return PaBackfillResult(
        rows=list(rows),
        days_used=days_used,
        rejected_long_history=rejected_long_history,
        fallback_days=fallback_days,
    )


@pytest.mark.asyncio
async def test_pa_backfill_dedupes_recent_fill_by_content_key(svc):
    service, db = svc
    sell_ms = await _seed_recent_sell(db)
    buy_ms = _et_ms(2026, 5, 1, 9, 30)

    result = await service.apply_pa_backfill_result(
        "DU1",
        265598,
        _pa_result(
            {
                "conid": 265598,
                "symbol": "AAPL",
                "side": "BUY",
                "quantity": 10,
                "price": 100.0,
                "trade_time": "2026-05-01T09:30:00-04:00",
                "trade_time_ms": buy_ms,
            },
            {
                "conid": 265598,
                "symbol": "AAPL",
                "side": "SELL",
                "quantity": 10,
                "price": 110.0,
                "trade_time": "2026-06-01T10:00:00-04:00",
                "trade_time_ms": sell_ms,
            },
        ),
    )

    fills = await db.list_fills_for_account_range("DU1", 0, sell_ms + 1)
    assert len(fills) == 2
    assert [fill["side"] for fill in fills] == ["BUY", "SELL"]
    assert [fill["source"] for fill in fills] == ["PA_TRANSACTION", "IBKR_TRADES"]
    assert result["imported"] == 1


@pytest.mark.asyncio
async def test_pa_backfill_resolves_incomplete_basis_and_updates_queue(svc):
    service, db = svc
    sell_ms = await _seed_recent_sell(db)
    buy_ms = _et_ms(2026, 5, 1, 9, 30)

    before = await service.trades("DU1", status="INCOMPLETE_BASIS")
    assert len(before.trades) == 1

    result = await service.apply_pa_backfill_result(
        "DU1",
        265598,
        _pa_result(
            {
                "conid": 265598,
                "symbol": "AAPL",
                "buySell": "BUY",
                "qty": 10,
                "price": 100.0,
                "dateTime": "2026-05-01T09:30:00-04:00",
                "trade_time_ms": buy_ms,
            }
        ),
    )

    after = await service.trades("DU1")
    assert [(trade.status, trade.direction) for trade in after.trades] == [
        ("CLOSED", "LONG")
    ]
    assert after.trades[0].net_pnl == pytest.approx(99.0)
    assert result["status"] == "resolved"
    queue = await db.list_backfill_status("DU1")
    assert queue[0]["status"] == "resolved"
    assert queue[0]["days_used"] == 365
    assert queue[0]["last_error"] is None


@pytest.mark.asyncio
async def test_journal_survives_rekey_when_basis_recovery_changes_trade_id(svc):
    service, db = svc
    sell_ms = await _seed_recent_sell(db, execution_id="SELL-OLD")
    old_trade_id = "DU1:265598:SELL-OLD"
    await db.upsert_journal_entry(
        trade_id=old_trade_id,
        account_id="DU1",
        conid=265598,
        setup="Breakout",
        notes="managed the exit well",
        tags=["basis"],
    )

    await service.apply_pa_backfill_result(
        "DU1",
        265598,
        _pa_result(
            {
                "conid": 265598,
                "symbol": "AAPL",
                "side": "BUY",
                "quantity": 10,
                "price": 100.0,
                "trade_time": "2026-05-01T09:30:00-04:00",
                "trade_time_ms": _et_ms(2026, 5, 1, 9, 30),
            }
        ),
    )

    assert await db.get_journal_entry(old_trade_id) is None
    trades = await service.trades("DU1")
    assert len(trades.trades) == 1
    new_trade = trades.trades[0]
    assert new_trade.trade_id != old_trade_id
    assert new_trade.status == "CLOSED"
    assert new_trade.journal_entry is not None
    assert new_trade.journal_entry.notes == "managed the exit well"
    assert new_trade.journal_entry.tags == ["basis"]
    assert new_trade.trade_id.startswith("DU1:265598:PA:")
    assert sell_ms in [fill.trade_time_ms for fill in new_trade.fills]


@pytest.mark.asyncio
async def test_pa_backfill_writes_auto_backfill_audit_row(svc):
    service, db = svc
    await _seed_recent_sell(db)

    await service.apply_pa_backfill_result(
        "DU1",
        265598,
        _pa_result(
            {
                "conid": 265598,
                "symbol": "AAPL",
                "side": "BUY",
                "quantity": 10,
                "price": 100.0,
                "trade_time": "2026-05-01T09:30:00-04:00",
                "trade_time_ms": _et_ms(2026, 5, 1, 9, 30),
            }
        ),
    )

    rows = await db.fetch_all(
        "SELECT action, source, before_json, after_json FROM basis_audit"
    )
    assert len(rows) == 1
    assert rows[0]["action"] == "auto_backfill"
    assert rows[0]["source"] == "PA_TRANSACTION"
    assert "INCOMPLETE_BASIS" in rows[0]["before_json"]
    assert "CLOSED" in rows[0]["after_json"]
