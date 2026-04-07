"""
Tests for the locked_fibonacci_drawings SQLite CRUD.

Uses a real in-memory SQLite database (no mocks) to verify the full
round-trip of save → list → get → delete.
"""
from __future__ import annotations

import asyncio

import pytest

from services.db import DatabaseService


@pytest.fixture()
def db():
    """
    Create a fresh in-memory DatabaseService, run table creation, and
    return it. The :memory: database is destroyed when the test ends.
    """
    svc = DatabaseService(db_path=":memory:")
    # Run the sync parts directly (no event loop needed for init internals)
    svc._conn = svc._connect()
    svc._create_tables()
    return svc


@pytest.fixture()
def sample_fib():
    return {
        "conid": 265598,
        "timeframe": "1D",
        "tool_type": "retracement",
        "swing_high_price": 198.50,
        "swing_high_time": 1700000000,
        "swing_low_price": 170.25,
        "swing_low_time": 1699500000,
        "direction": "up",
        "user_note": "Daily golden pocket play",
    }


@pytest.mark.asyncio
async def test_save_and_get(db: DatabaseService, sample_fib: dict):
    lock_id = await db.save_locked_fib(**sample_fib)
    assert lock_id > 0

    row = await db.get_locked_fib(lock_id)
    assert row is not None
    assert row["conid"] == 265598
    assert row["swing_high_price"] == 198.50
    assert row["direction"] == "up"
    assert row["user_note"] == "Daily golden pocket play"


@pytest.mark.asyncio
async def test_list_by_conid(db: DatabaseService, sample_fib: dict):
    await db.save_locked_fib(**sample_fib)

    # Different timeframe, same conid
    fib2 = {**sample_fib, "timeframe": "1W", "swing_high_time": 1700100000}
    await db.save_locked_fib(**fib2)

    # Different conid
    fib3 = {**sample_fib, "conid": 99999}
    await db.save_locked_fib(**fib3)

    rows = await db.list_locked_fibs(265598)
    assert len(rows) == 2
    assert all(r["conid"] == 265598 for r in rows)


@pytest.mark.asyncio
async def test_delete(db: DatabaseService, sample_fib: dict):
    lock_id = await db.save_locked_fib(**sample_fib)
    deleted = await db.delete_locked_fib(lock_id)
    assert deleted is True

    row = await db.get_locked_fib(lock_id)
    assert row is None


@pytest.mark.asyncio
async def test_delete_nonexistent(db: DatabaseService):
    deleted = await db.delete_locked_fib(999)
    assert deleted is False


@pytest.mark.asyncio
async def test_duplicate_lock_returns_existing(db: DatabaseService, sample_fib: dict):
    """
    Locking the exact same swing twice should not create a duplicate —
    it should return the ID of the existing row.
    """
    id1 = await db.save_locked_fib(**sample_fib)
    id2 = await db.save_locked_fib(**sample_fib)
    assert id1 == id2

    rows = await db.list_locked_fibs(265598)
    assert len(rows) == 1


@pytest.mark.asyncio
async def test_extension_and_retracement_coexist(db: DatabaseService, sample_fib: dict):
    """
    A retracement and extension lock on the same swing should both be
    stored (different tool_type = different unique key).
    """
    await db.save_locked_fib(**sample_fib)
    ext_fib = {**sample_fib, "tool_type": "extension"}
    await db.save_locked_fib(**ext_fib)

    rows = await db.list_locked_fibs(265598)
    assert len(rows) == 2
    tool_types = {r["tool_type"] for r in rows}
    assert tool_types == {"retracement", "extension"}
