from __future__ import annotations

import sqlite3
from unittest.mock import AsyncMock, MagicMock

import pytest

from exceptions import IBKRConnectionError
from services.db import DatabaseService
from services.scanner import ScannerService


def make_scanner(db=None, ibkr=None) -> ScannerService:
    return ScannerService(ibkr=ibkr or MagicMock(), db=db or MagicMock())


@pytest.mark.asyncio
async def test_resolve_expire_days_lookup_error_returns_none():
    """DB error during expiry lookup returns None safely (no crash)."""
    db = MagicMock()
    db.get_watchlist_config = AsyncMock(side_effect=sqlite3.OperationalError("boom"))
    scanner = make_scanner(db=db)
    rule = {"ibkr_mirror_target": "Explode"}
    days = await scanner._resolve_expire_days(rule)
    assert days is None


@pytest.mark.asyncio
async def test_return_expired_hits_moves_back_and_marks():
    db = MagicMock()
    db.get_expired_hits = AsyncMock(return_value=[
        {"id": 1, "conid": 1001, "source_watchlist": "My Stocks", "target_watchlist": "RSI Oversold"},
        {"id": 2, "conid": 1002, "source_watchlist": "My Stocks", "target_watchlist": "Gap Plays"},
    ])
    db.mark_moved_back = AsyncMock(return_value=True)

    ibkr = MagicMock()
    ibkr.move_between_watchlists = AsyncMock(return_value=None)

    scanner = make_scanner(db=db, ibkr=ibkr)
    await scanner._return_expired_hits()

    assert ibkr.move_between_watchlists.await_count == 2
    first_call = ibkr.move_between_watchlists.await_args_list[0].kwargs
    assert first_call["conid"] == 1001
    assert first_call["source_name"] == "RSI Oversold"
    assert first_call["target_name"] == "My Stocks"
    assert db.mark_moved_back.await_count == 2


@pytest.mark.asyncio
async def test_return_expired_hits_skips_mark_on_move_failure():
    """IBKR failure during move-back must NOT mark the hit — preserve retry."""
    db = MagicMock()
    db.get_expired_hits = AsyncMock(return_value=[
        {"id": 1, "conid": 1001, "source_watchlist": "A", "target_watchlist": "B"},
    ])
    db.mark_moved_back = AsyncMock(return_value=True)

    ibkr = MagicMock()
    ibkr.move_between_watchlists = AsyncMock(side_effect=IBKRConnectionError("ibkr down"))

    scanner = make_scanner(db=db, ibkr=ibkr)
    await scanner._return_expired_hits()

    db.mark_moved_back.assert_not_awaited()


@pytest.mark.asyncio
async def test_return_expired_hits_get_expired_failure_is_swallowed():
    db = MagicMock()
    db.get_expired_hits = AsyncMock(side_effect=sqlite3.OperationalError("sqlite locked"))
    ibkr = MagicMock()
    ibkr.move_between_watchlists = AsyncMock()

    scanner = make_scanner(db=db, ibkr=ibkr)
    await scanner._return_expired_hits()
    ibkr.move_between_watchlists.assert_not_awaited()


@pytest.mark.asyncio
async def test_return_expired_hits_skips_rows_missing_fields():
    db = MagicMock()
    db.get_expired_hits = AsyncMock(return_value=[
        {"id": 1, "conid": 1001, "source_watchlist": "A", "target_watchlist": ""},
        {"id": 2, "conid": None, "source_watchlist": "A", "target_watchlist": "B"},
    ])
    db.mark_moved_back = AsyncMock()
    ibkr = MagicMock()
    ibkr.move_between_watchlists = AsyncMock()

    scanner = make_scanner(db=db, ibkr=ibkr)
    await scanner._return_expired_hits()

    ibkr.move_between_watchlists.assert_not_awaited()
    db.mark_moved_back.assert_not_awaited()
