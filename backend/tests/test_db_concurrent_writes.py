"""
Regression tests for the SQLite write-lock hotfix (Phase 8 follow-up).

Background: DatabaseService shares one sqlite3.Connection across all
asyncio.to_thread worker threads (check_same_thread=False). Python's
sqlite3.Connection is NOT safe for concurrent use — two workers calling
.execute() / .commit() simultaneously can raise
`sqlite3.ProgrammingError: bad parameter or other API misuse`
(SQLITE_MISUSE, error code 21).

This bit us during sectors cold-start, where 11 parallel get_conid()
calls fan out to 11 parallel upsert_cached_conid() writes. The fix:
serialise all writes behind `self._write_lock` (asyncio.Lock).

Tests verify that hammering the cache from many concurrent tasks
neither raises SQLITE_MISUSE nor silently drops rows.
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
async def test_concurrent_upsert_cached_conid_does_not_raise(db):
    """20 concurrent upsert_cached_conid() calls must all complete
    cleanly — no SQLITE_MISUSE, no silent failures.

    Pre-fix: this test reliably failed with
    `sqlite3.ProgrammingError: bad parameter or other API misuse`
    when run on Python 3.10+ with the shared-connection pattern.
    Post-fix: writes serialise behind self._write_lock and all rows land.
    """
    # Build 20 unique (symbol, sec_type) writes
    writes = [
        db.upsert_cached_conid(
            symbol=f"SYM{i:02d}",
            sec_type="STK",
            conid=10_000 + i,
            asset_class="STK",
        )
        for i in range(20)
    ]

    # If the lock is missing, gather() with the default
    # return_exceptions=False will surface the first SQLITE_MISUSE.
    await asyncio.gather(*writes)

    # All 20 rows should be present
    for i in range(20):
        cached = await db.get_cached_conid(f"SYM{i:02d}", "STK")
        assert cached is not None, f"row for SYM{i:02d}/STK is missing"
        assert cached["conid"] == 10_000 + i


@pytest.mark.asyncio
async def test_concurrent_upserts_with_overlapping_keys(db):
    """Concurrent upserts that overlap on the same key (e.g. multiple
    callers asking to cache AAPL/STK at once) must converge: no errors,
    one row, the last writer's conid wins."""
    writes = [
        db.upsert_cached_conid(
            symbol="AAPL",
            sec_type="STK",
            conid=265598 + i,  # different conid per writer
            asset_class="STK",
        )
        for i in range(15)
    ]

    await asyncio.gather(*writes)

    # Exactly one row
    cached = await db.get_cached_conid("AAPL", "STK")
    assert cached is not None
    # Conid is one of the writers' values (whichever ran last under the lock)
    assert cached["conid"] in {265598 + i for i in range(15)}


@pytest.mark.asyncio
async def test_writes_interleaved_with_reads_do_not_raise(db):
    """Mix of concurrent writes and reads — neither should raise.
    Reads bypass the write lock (SQLite WAL mode serialises read-vs-write
    at the file level), but they share the same connection cursor state
    so we still want this to be exercised."""
    # Seed a known row first
    await db.upsert_cached_conid(
        symbol="SEED", sec_type="STK", conid=1, asset_class="STK"
    )

    async def writer(i: int):
        await db.upsert_cached_conid(
            symbol=f"W{i:02d}",
            sec_type="STK",
            conid=20_000 + i,
            asset_class="STK",
        )

    async def reader():
        return await db.get_cached_conid("SEED", "STK")

    # 10 writers + 10 readers, all concurrent
    tasks = [writer(i) for i in range(10)] + [reader() for _ in range(10)]
    results = await asyncio.gather(*tasks)

    # First 10 results are writers (return None); last 10 are readers
    reader_results = results[10:]
    assert all(r is not None for r in reader_results)
    assert all(r["conid"] == 1 for r in reader_results)
    # All writer rows landed
    for i in range(10):
        cached = await db.get_cached_conid(f"W{i:02d}", "STK")
        assert cached is not None and cached["conid"] == 20_000 + i
