"""
Tests for the SQLite conid resolution cache (Phase 8 / Task 1.5).

Conid mappings are stable across IBKR sessions — a symbol resolves to
the same conid forever. We persist the (symbol, sec_type) → (conid,
asset_class, name) mapping in SQLite so a fresh app start pays ~1ms
instead of the 10–13s IBKR resolution cost.

Behavior under test:
  - First lookup of ("AAPL", "STK") calls IBKR; second reads cache only.
  - Cache survives an in-process service restart (real SQLite tempfile).
  - force_refresh=True bypasses the cache and updates the row.
  - Different sec_type for the same symbol stores separate rows.
  - 5 concurrent callers for the same fresh (symbol, sec_type) coalesce
    on a per-key asyncio.Lock so only one IBKR search runs.
"""

import asyncio
import os
import tempfile
from unittest.mock import AsyncMock

import pytest

from services.db import DatabaseService
from services.ibkr import IBKRService
from state import IBKRState


# ── Helpers ──────────────────────────────────────────────────────────


@pytest.fixture
async def db():
    """A real SQLite DatabaseService backed by a temp file (so tests
    that exercise restart semantics can re-open it)."""
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    svc = DatabaseService(db_path=path)
    await svc.initialize()
    try:
        yield svc, path
    finally:
        await svc.close()
        try:
            os.unlink(path)
        except OSError:
            pass


def _make_ibkr_with(db, search_side_effect) -> IBKRService:
    """Bare IBKRService wired to a real DB and a mocked search()."""
    svc = IBKRService.__new__(IBKRService)
    svc.state = IBKRState()
    svc.db = db
    svc._conid_resolve_locks = {}
    svc.ensure_accounts = AsyncMock(return_value=None)
    svc.search = AsyncMock(side_effect=search_side_effect)
    return svc


def _aapl_search_response(symbol: str, sec_type: str = ""):
    """A canned IBKR /iserver/secdef/search response for AAPL/STK."""
    return [
        {
            "conid": 265598,
            "symbol": "AAPL",
            "description": "NASDAQ",
            "sections": [{"secType": "STK"}],
        }
    ]


# ── Tests ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_first_lookup_hits_ibkr_then_caches(db):
    """First call resolves via IBKR; the row appears in conid_cache."""
    db_svc, _ = db
    svc = _make_ibkr_with(db_svc, _aapl_search_response)

    conid = await svc.get_conid("AAPL", "STK")
    assert conid == 265598
    # search() called exactly once
    assert svc.search.call_count == 1

    # Cache row written
    cached = await db_svc.get_cached_conid("AAPL", "STK")
    assert cached is not None
    assert cached["conid"] == 265598
    assert cached["asset_class"] == "STK"


@pytest.mark.asyncio
async def test_second_lookup_reads_cache_only(db):
    """Second call for the same key never hits IBKR."""
    db_svc, _ = db
    svc = _make_ibkr_with(db_svc, _aapl_search_response)

    await svc.get_conid("AAPL", "STK")
    assert svc.search.call_count == 1

    conid = await svc.get_conid("AAPL", "STK")
    assert conid == 265598
    # Still 1 — cache hit, no second IBKR call
    assert svc.search.call_count == 1


@pytest.mark.asyncio
async def test_cache_survives_in_process_service_restart(db):
    """Closing + re-opening the DB (simulating an app restart) preserves
    the cache row; a fresh IBKRService doesn't re-resolve via IBKR."""
    db_svc, path = db
    svc1 = _make_ibkr_with(db_svc, _aapl_search_response)
    await svc1.get_conid("AAPL", "STK")
    assert svc1.search.call_count == 1

    # Simulate restart: close, re-open the same SQLite file with a fresh
    # DatabaseService and a fresh IBKRService.
    await db_svc.close()
    db2 = DatabaseService(db_path=path)
    await db2.initialize()
    try:
        svc2 = _make_ibkr_with(db2, _aapl_search_response)
        conid = await svc2.get_conid("AAPL", "STK")
        assert conid == 265598
        # Fresh service, but it found the cached row — search() never called
        assert svc2.search.call_count == 0
    finally:
        await db2.close()


@pytest.mark.asyncio
async def test_force_refresh_bypasses_cache_and_updates_row(db):
    """force_refresh=True skips the cache read but still writes the
    fresh result back. The cache row's conid is updated if IBKR returns
    a different one (we test by changing the mocked response)."""
    db_svc, _ = db

    async def first_search(symbol, sec_type=""):
        return _aapl_search_response(symbol, sec_type)

    svc = _make_ibkr_with(db_svc, first_search)
    await svc.get_conid("AAPL", "STK")
    cached_v1 = await db_svc.get_cached_conid("AAPL", "STK")
    assert cached_v1["conid"] == 265598
    initial_resolved_at = cached_v1["resolved_at"]

    # IBKR re-issues a different conid (very rare in practice — corporate
    # action). Swap the mocked search and force a refresh.
    async def second_search(symbol, sec_type=""):
        return [
            {
                "conid": 999999,
                "symbol": "AAPL",
                "description": "NASDAQ",
                "sections": [{"secType": "STK"}],
            }
        ]

    svc.search = AsyncMock(side_effect=second_search)
    # Wait a beat so resolved_at moves forward measurably.
    await asyncio.sleep(1.1)

    conid = await svc.get_conid("AAPL", "STK", force_refresh=True)
    assert conid == 999999
    assert svc.search.call_count == 1  # IBKR was called

    cached_v2 = await db_svc.get_cached_conid("AAPL", "STK")
    assert cached_v2["conid"] == 999999
    assert cached_v2["resolved_at"] > initial_resolved_at


@pytest.mark.asyncio
async def test_different_sec_type_stores_separate_rows(db):
    """USD/STK and USD/CASH resolve to different conids and are stored
    as separate rows keyed by (symbol, sec_type)."""
    db_svc, _ = db

    async def fake_search(symbol, sec_type=""):
        # USD/STK fakery — pretend there's a stock named USD
        if sec_type.upper() == "STK":
            return [
                {
                    "conid": 11111,
                    "symbol": "USD",
                    "description": "NYSE",
                    "sections": [{"secType": "STK"}],
                }
            ]
        # USD/CASH (forex)
        if sec_type.upper() == "CASH":
            return [
                {
                    "conid": 22222,
                    "symbol": "USD",
                    "description": "IDEALPRO",
                    "sections": [{"secType": "CASH"}],
                }
            ]
        return []

    svc = _make_ibkr_with(db_svc, fake_search)

    stk_conid = await svc.get_conid("USD", "STK")
    cash_conid = await svc.get_conid("USD", "CASH")
    assert stk_conid == 11111
    assert cash_conid == 22222

    # Both rows present in the cache, keyed by (symbol, sec_type)
    stk_row = await db_svc.get_cached_conid("USD", "STK")
    cash_row = await db_svc.get_cached_conid("USD", "CASH")
    assert stk_row is not None and stk_row["conid"] == 11111
    assert cash_row is not None and cash_row["conid"] == 22222
    assert stk_row["asset_class"] == "STK"
    assert cash_row["asset_class"] == "CASH"


@pytest.mark.asyncio
async def test_concurrent_first_time_callers_coalesce_on_lock(db):
    """5 simultaneous get_conid("AAPL","STK") calls before any cache
    exists must result in exactly 1 IBKR search."""
    db_svc, _ = db

    # Slow the search slightly so all 5 callers contend on the lock
    async def slow_search(symbol, sec_type=""):
        await asyncio.sleep(0.05)
        return _aapl_search_response(symbol, sec_type)

    svc = _make_ibkr_with(db_svc, slow_search)

    results = await asyncio.gather(
        *(svc.get_conid("AAPL", "STK") for _ in range(5))
    )
    assert all(r == 265598 for r in results)
    # Critical: exactly one IBKR search across the 5 concurrent callers
    assert svc.search.call_count == 1


@pytest.mark.asyncio
async def test_unwired_db_falls_back_to_ibkr_every_call(db):
    """When self.db is None (e.g. tests that build a bare IBKRService),
    the cache layer is a no-op — every call hits IBKR. This is the
    pre-Phase-8 behavior, preserved by design so existing tests don't
    break."""
    db_svc, _ = db  # We don't actually use the DB here
    svc = _make_ibkr_with(db_svc, _aapl_search_response)
    svc.db = None

    await svc.get_conid("AAPL", "STK")
    await svc.get_conid("AAPL", "STK")
    # No cache layer, so 2 calls = 2 IBKR searches
    assert svc.search.call_count == 2


@pytest.mark.asyncio
async def test_cached_hit_populates_state_conid_asset_class(db):
    """A cached hit must still populate state.conid_asset_class so the
    snapshot pre-warm path (Task 1.4) finds the (symbol, asset_class)
    pair without a DB roundtrip on every snapshot."""
    db_svc, _ = db
    svc = _make_ibkr_with(db_svc, _aapl_search_response)

    # First call writes the cache and populates state
    await svc.get_conid("AAPL", "STK")
    assert svc.state.conid_asset_class.get(265598) == ("AAPL", "STK")

    # Clear in-memory state (simulate a session reset)
    svc.state.conid_asset_class.clear()

    # Second call hits the cache; state must be re-populated from the row
    await svc.get_conid("AAPL", "STK")
    assert svc.state.conid_asset_class.get(265598) == ("AAPL", "STK")
