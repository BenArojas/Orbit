"""
DB-layer tests for Inflect's journal_entries table (Phase A / Task A4).

Covers the upsert → update → get round-trip, tags JSON encode/decode,
bulk lookup by conid, and concurrent-write safety on the shared
sqlite3.Connection (the same write-lock invariant exercised by
test_db_concurrent_writes.py).
"""

import asyncio
import os
import tempfile

import pytest

from services.db import DatabaseService


@pytest.fixture
async def db():
    """A real SQLite DatabaseService backed by a temp file."""
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    svc = DatabaseService(db_path=path)
    await svc.initialize()
    try:
        yield svc
    finally:
        await svc.close()
        try:
            os.unlink(path)
        except OSError:
            pass


@pytest.mark.asyncio
async def test_insert_then_get_round_trip(db):
    """A freshly inserted entry reads back with decoded tags."""
    await db.upsert_journal_entry(
        trade_id="DU123:265598:exec-1",
        account_id="DU123",
        conid=265598,
        setup="Breakout",
        notes="clean break of the range high",
        tags=["momentum", "earnings"],
    )

    entry = await db.get_journal_entry("DU123:265598:exec-1")
    assert entry is not None
    assert entry["account_id"] == "DU123"
    assert entry["conid"] == 265598
    assert entry["setup"] == "Breakout"
    assert entry["notes"] == "clean break of the range high"
    assert entry["tags"] == ["momentum", "earnings"]
    assert entry["created_at"]
    assert entry["updated_at"]


@pytest.mark.asyncio
async def test_get_missing_returns_none(db):
    assert await db.get_journal_entry("nope:1:x") is None


@pytest.mark.asyncio
async def test_update_overwrites_fields_and_preserves_created_at(db):
    """Upserting the same trade_id updates fields but keeps created_at."""
    await db.upsert_journal_entry(
        trade_id="DU1:1:a",
        account_id="DU1",
        conid=1,
        setup="Breakout",
        notes="first",
        tags=["a"],
    )
    first = await db.get_journal_entry("DU1:1:a")

    await db.upsert_journal_entry(
        trade_id="DU1:1:a",
        account_id="DU1",
        conid=1,
        setup="Mean reversion",
        notes="second",
        tags=["b", "c"],
    )
    second = await db.get_journal_entry("DU1:1:a")

    assert second["setup"] == "Mean reversion"
    assert second["notes"] == "second"
    assert second["tags"] == ["b", "c"]
    # created_at is stable across the update; the row is not duplicated.
    assert second["created_at"] == first["created_at"]


@pytest.mark.asyncio
async def test_empty_or_none_tags_store_as_empty_list(db):
    """None and [] both round-trip to an empty list, not null/garbage."""
    await db.upsert_journal_entry(
        trade_id="DU1:1:none",
        account_id="DU1",
        conid=1,
        setup=None,
        notes=None,
        tags=None,
    )
    await db.upsert_journal_entry(
        trade_id="DU1:1:empty",
        account_id="DU1",
        conid=1,
        setup=None,
        notes=None,
        tags=[],
    )

    assert (await db.get_journal_entry("DU1:1:none"))["tags"] == []
    assert (await db.get_journal_entry("DU1:1:empty"))["tags"] == []


@pytest.mark.asyncio
async def test_get_entries_for_conids_bulk(db):
    """Bulk lookup returns only entries for the requested conids."""
    await db.upsert_journal_entry(
        trade_id="DU1:10:a", account_id="DU1", conid=10,
        setup="Breakout", notes=None, tags=["x"],
    )
    await db.upsert_journal_entry(
        trade_id="DU1:20:b", account_id="DU1", conid=20,
        setup=None, notes="note", tags=[],
    )
    await db.upsert_journal_entry(
        trade_id="DU1:30:c", account_id="DU1", conid=30,
        setup=None, notes=None, tags=[],
    )

    rows = await db.get_journal_entries_for_conids([10, 20])
    by_trade = {r["trade_id"]: r for r in rows}
    assert set(by_trade) == {"DU1:10:a", "DU1:20:b"}
    assert by_trade["DU1:10:a"]["tags"] == ["x"]

    assert await db.get_journal_entries_for_conids([]) == []


@pytest.mark.asyncio
async def test_concurrent_upserts_do_not_raise(db):
    """20 concurrent journal upserts must all land — no SQLITE_MISUSE.

    Same shared-connection invariant as test_db_concurrent_writes.py:
    every write goes through self._write_lock via _run_write.
    """
    writes = [
        db.upsert_journal_entry(
            trade_id=f"DU1:{i}:e{i}",
            account_id="DU1",
            conid=i,
            setup="Breakout",
            notes=f"note {i}",
            tags=[f"t{i}"],
        )
        for i in range(20)
    ]
    await asyncio.gather(*writes)

    for i in range(20):
        entry = await db.get_journal_entry(f"DU1:{i}:e{i}")
        assert entry is not None
        assert entry["conid"] == i
        assert entry["tags"] == [f"t{i}"]


@pytest.mark.asyncio
async def test_list_fills_for_account_range(db):
    """The matcher's input query returns in-range fills oldest-first and
    excludes other accounts and NULL-timestamp rows."""
    await db.upsert_fills([
        {
            "execution_id": "f3", "account_id": "DU1", "conid": 1,
            "side": "BUY", "quantity": 1, "trade_time": "t3",
            "trade_time_ms": 3000,
        },
        {
            "execution_id": "f1", "account_id": "DU1", "conid": 1,
            "side": "BUY", "quantity": 1, "trade_time": "t1",
            "trade_time_ms": 1000,
        },
        {
            "execution_id": "f2", "account_id": "DU1", "conid": 1,
            "side": "SELL", "quantity": 1, "trade_time": "t2",
            "trade_time_ms": 2000,
        },
        # Out of range (too late)
        {
            "execution_id": "f9", "account_id": "DU1", "conid": 1,
            "side": "SELL", "quantity": 1, "trade_time": "t9",
            "trade_time_ms": 9000,
        },
        # Different account
        {
            "execution_id": "other", "account_id": "DU2", "conid": 1,
            "side": "BUY", "quantity": 1, "trade_time": "t2",
            "trade_time_ms": 2000,
        },
    ])

    rows = await db.list_fills_for_account_range("DU1", 1000, 3000)
    assert [r["execution_id"] for r in rows] == ["f1", "f2", "f3"]
