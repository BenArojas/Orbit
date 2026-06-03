import os
import tempfile
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from services.db import DatabaseService
from services.inflect.storage import cleanup_storage, storage_stats

ET = ZoneInfo("US/Eastern")


def _et_ms(year, month, day, hour=10) -> int:
    return int(datetime(year, month, day, hour, tzinfo=ET).timestamp() * 1000)


@pytest.fixture
async def db():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    service = DatabaseService(db_path=path)
    await service.initialize()
    try:
        yield service
    finally:
        await service.close()
        try:
            os.unlink(path)
        except OSError:
            pass


async def _seed(db: DatabaseService) -> None:
    await db.upsert_fills(
        [
            {
                "execution_id": "old",
                "account_id": "DU1",
                "conid": 101,
                "symbol": "AAPL",
                "side": "BUY",
                "quantity": 1,
                "price": 10,
                "trade_time": "2026-05-01T10:00:00-04:00",
                "trade_time_ms": _et_ms(2026, 5, 1),
                "raw_json": {"payload": "old"},
            },
            {
                "execution_id": "new",
                "account_id": "DU1",
                "conid": 101,
                "symbol": "AAPL",
                "side": "SELL",
                "quantity": 1,
                "price": 11,
                "trade_time": "2026-06-01T10:00:00-04:00",
                "trade_time_ms": _et_ms(2026, 6, 1),
                "raw_json": {"payload": "new"},
            },
        ]
    )
    await db.create_basis_lot(
        account_id="DU1",
        conid=101,
        side="LONG",
        quantity=1,
        entry_date="2026-04-01",
        entry_price=9,
        commission=None,
        note=None,
    )
    await db.insert_basis_audit(
        account_id="DU1",
        conid=101,
        action="lot_create",
        source="MANUAL",
        before_json="[]",
        after_json="[]",
    )


@pytest.mark.asyncio
async def test_storage_stats_reports_size_counts_and_raw_payload_bytes(db):
    await _seed(db)

    stats = await storage_stats(db)

    assert stats.file_size_bytes > 0
    assert stats.table_counts["fills"] == 2
    assert stats.table_counts["basis_lots"] == 1
    assert stats.table_counts["basis_audit"] == 1
    assert stats.raw_json_bytes > 0


@pytest.mark.asyncio
async def test_cleanup_requires_confirm_and_clears_only_old_raw_json(db):
    await _seed(db)

    with pytest.raises(ValueError, match="confirm"):
        await cleanup_storage(db, before_date="2026-06-01", confirm=False)

    result = await cleanup_storage(db, before_date="2026-06-01", confirm=True)

    assert result.cleared_raw_payloads == 1
    assert result.deleted_rows == 0
    assert result.export_recommended is True

    rows = await db.fetch_all(
        """
        SELECT execution_id, raw_json
        FROM fills
        ORDER BY execution_id
        """
    )
    assert len(rows) == 2
    assert rows[0]["execution_id"] == "new"
    assert rows[0]["raw_json"] is not None
    assert rows[1]["execution_id"] == "old"
    assert rows[1]["raw_json"] is None
    assert (await db.fetch_all("SELECT COUNT(*) AS n FROM basis_lots"))[0]["n"] == 1
    assert (await db.fetch_all("SELECT COUNT(*) AS n FROM basis_audit"))[0]["n"] == 1

