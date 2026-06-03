import os
import tempfile
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from models.inflect import BasisLotUpsertRequest
from services.db import DatabaseService
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


async def _seed_sell(
    db: DatabaseService,
    *,
    execution_id: str = "SELL-1",
    conid: int = 265598,
    symbol: str = "AAPL",
    quantity: float = 10,
    price: float = 110,
    year: int = 2026,
    month: int = 6,
    day: int = 1,
) -> None:
    sell_ms = _et_ms(year, month, day, 10)
    await db.upsert_fills(
        [
            {
                "execution_id": execution_id,
                "account_id": "DU1",
                "conid": conid,
                "symbol": symbol,
                "side": "SELL",
                "quantity": quantity,
                "price": price,
                "commission": 1.0,
                "sec_type": "STK",
                "trade_time": datetime.fromtimestamp(sell_ms / 1000, ET).isoformat(),
                "trade_time_ms": sell_ms,
            }
        ]
    )


def _lot_payload(
    *,
    conid: int = 265598,
    side: str = "LONG",
    quantity: float = 10,
    entry_date: str = "2026-05-01",
    entry_price: float = 100,
) -> BasisLotUpsertRequest:
    return BasisLotUpsertRequest(
        conid=conid,
        side=side,
        quantity=quantity,
        entry_date=entry_date,
        entry_price=entry_price,
        commission=0.5,
        note="manual basis",
    )


@pytest.mark.asyncio
async def test_long_manual_lot_resolves_needs_basis_and_rekeys_journal(svc):
    service, db = svc
    await _seed_sell(db)
    old_trade_id = "DU1:265598:SELL-1"
    await db.upsert_journal_entry(
        trade_id=old_trade_id,
        account_id="DU1",
        conid=265598,
        setup="Breakout",
        notes="sale of existing shares",
        tags=["manual"],
    )

    before = await service.trades("DU1")
    assert [(trade.status, trade.direction) for trade in before.trades] == [
        ("INCOMPLETE_BASIS", "UNKNOWN")
    ]

    lot = await service.create_basis_lot("DU1", _lot_payload())

    after = await service.trades("DU1")
    assert len(after.trades) == 1
    trade = after.trades[0]
    assert trade.status == "CLOSED"
    assert trade.direction == "LONG"
    assert trade.trade_id == f"DU1:265598:LOT:{lot.id}"
    assert trade.net_pnl == pytest.approx(98.5)
    assert trade.journal_entry is not None
    assert trade.journal_entry.notes == "sale of existing shares"
    assert await db.get_journal_entry(old_trade_id) is None

    rows = await db.fetch_all(
        "SELECT action, source, before_json, after_json FROM basis_audit"
    )
    assert len(rows) == 1
    assert rows[0]["action"] == "lot_create"
    assert rows[0]["source"] == "MANUAL"
    assert "INCOMPLETE_BASIS" in rows[0]["before_json"]
    assert "CLOSED" in rows[0]["after_json"]


@pytest.mark.asyncio
async def test_short_manual_lot_opens_a_proven_short(svc):
    service, db = svc
    await db.upsert_fills(
        [
            {
                "execution_id": "BUY-COVER",
                "account_id": "DU1",
                "conid": 265598,
                "symbol": "AAPL",
                "side": "BUY",
                "quantity": 10,
                "price": 90,
                "commission": 1.0,
                "sec_type": "STK",
                "trade_time": "2026-06-01T10:00:00-04:00",
                "trade_time_ms": _et_ms(2026, 6, 1, 10),
            }
        ]
    )

    lot = await service.create_basis_lot(
        "DU1",
        _lot_payload(side="SHORT", entry_price=100),
    )

    trades = await service.trades("DU1")
    assert len(trades.trades) == 1
    trade = trades.trades[0]
    assert trade.trade_id == f"DU1:265598:LOT:{lot.id}"
    assert trade.status == "CLOSED"
    assert trade.direction == "SHORT"
    assert trade.net_pnl == pytest.approx(98.5)
    assert trade.fills[0].execution_id == f"LOT:{lot.id}"


@pytest.mark.asyncio
async def test_deleting_consumed_lot_returns_trade_to_needs_basis_and_rekeys(svc):
    service, db = svc
    await _seed_sell(db)
    lot = await service.create_basis_lot("DU1", _lot_payload())
    resolved_trade_id = f"DU1:265598:LOT:{lot.id}"
    await db.upsert_journal_entry(
        trade_id=resolved_trade_id,
        account_id="DU1",
        conid=265598,
        setup="Breakout",
        notes="keep this note",
        tags=["delete"],
    )

    await service.delete_basis_lot(lot_id=lot.id, account_id="DU1")

    trades = await service.trades("DU1")
    assert len(trades.trades) == 1
    trade = trades.trades[0]
    assert trade.trade_id == "DU1:265598:SELL-1"
    assert trade.status == "INCOMPLETE_BASIS"
    assert trade.direction == "UNKNOWN"
    assert trade.journal_entry is not None
    assert trade.journal_entry.notes == "keep this note"
    assert await db.get_journal_entry(resolved_trade_id) is None

    rows = await db.fetch_all(
        "SELECT action, source, before_json, after_json FROM basis_audit "
        "ORDER BY id"
    )
    assert [row["action"] for row in rows] == ["lot_create", "lot_delete"]
    assert rows[-1]["source"] == "MANUAL"
    assert "CLOSED" in rows[-1]["before_json"]
    assert "INCOMPLETE_BASIS" in rows[-1]["after_json"]

