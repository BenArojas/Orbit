"""
Tests for the watchlist_config feature (Phase 6.8).

Covers:
  - DatabaseService CRUD on watchlist_config
  - Router: GET list / GET one (200 + 404) / PUT (upsert, 400 on empty) / DELETE
  - ScannerService._resolve_expire_days — override priority over rule value
  - ScannerService._return_expired_hits — moves stock back + marks moved_back,
    and survives transient IBKR errors
"""
from __future__ import annotations

import sqlite3
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from deps import get_db, get_ibkr
from exceptions import IBKRConnectionError, IBKRError
from routers.watchlist_config import router as wc_router
from services.db import DatabaseService
from services.scanner import ScannerService


# ── DB-layer CRUD (real in-memory SQLite) ──────────────────────

@pytest.fixture()
def db() -> DatabaseService:
    svc = DatabaseService(db_path=":memory:")
    svc._conn = svc._connect()
    svc._create_tables()
    return svc


@pytest.mark.asyncio
async def test_upsert_and_get_roundtrip(db: DatabaseService):
    await db.upsert_watchlist_config("Fast Setups", 2)
    row = await db.get_watchlist_config("Fast Setups")
    assert row is not None
    assert row["name"] == "Fast Setups"
    assert row["auto_expire_days"] == 2


@pytest.mark.asyncio
async def test_upsert_updates_existing_row(db: DatabaseService):
    await db.upsert_watchlist_config("Swing", 5)
    await db.upsert_watchlist_config("Swing", 10)
    row = await db.get_watchlist_config("Swing")
    assert row["auto_expire_days"] == 10


@pytest.mark.asyncio
async def test_upsert_preserves_null_override(db: DatabaseService):
    # NULL means "explicit no-expire override" — different from no row at all.
    await db.upsert_watchlist_config("Manual Review", None)
    row = await db.get_watchlist_config("Manual Review")
    assert row is not None
    assert row["auto_expire_days"] is None


@pytest.mark.asyncio
async def test_get_all_and_delete(db: DatabaseService):
    await db.upsert_watchlist_config("B list", 3)
    await db.upsert_watchlist_config("A list", 7)

    rows = await db.get_all_watchlist_configs()
    # Alphabetical by name.
    assert [r["name"] for r in rows] == ["A list", "B list"]

    assert await db.delete_watchlist_config("A list") is True
    assert await db.delete_watchlist_config("A list") is False
    assert await db.get_watchlist_config("A list") is None


# ── Router (FastAPI TestClient + mock DB) ──────────────────────

@pytest.fixture
def app_and_db():
    app = FastAPI()
    app.include_router(wc_router)

    db = MagicMock()
    db.get_all_watchlist_configs = AsyncMock(return_value=[
        {"name": "Fast Setups", "auto_expire_days": 2, "updated_at": "2026-04-15 10:00:00"},
    ])
    db.get_watchlist_config = AsyncMock(return_value=None)
    db.upsert_watchlist_config = AsyncMock(return_value=None)
    db.delete_watchlist_config = AsyncMock(return_value=True)

    app.dependency_overrides[get_db] = lambda: db

    # PUT /watchlist-config/{name} calls ibkr.resolve_watchlist_id to validate
    # the watchlist exists. Simulate IBKR being offline so the write is still
    # allowed (the router catches IBKRError and proceeds).
    mock_ibkr = MagicMock()
    mock_ibkr.resolve_watchlist_id = AsyncMock(side_effect=IBKRError("offline"))
    app.dependency_overrides[get_ibkr] = lambda: mock_ibkr

    return app, db


def test_router_list_returns_configs(app_and_db):
    app, db = app_and_db
    client = TestClient(app)
    r = client.get("/watchlist-config")
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert data[0]["name"] == "Fast Setups"
    assert data[0]["auto_expire_days"] == 2


def test_router_get_single_404_when_missing(app_and_db):
    app, db = app_and_db
    client = TestClient(app)
    r = client.get("/watchlist-config/Nonexistent")
    assert r.status_code == 404
    db.get_watchlist_config.assert_awaited_once_with("Nonexistent")


def test_router_put_upserts_and_returns_row(app_and_db):
    app, db = app_and_db
    # After the upsert the router re-reads the row, so mock the read.
    db.get_watchlist_config = AsyncMock(return_value={
        "name": "Swing",
        "auto_expire_days": 10,
        "updated_at": "2026-04-15 10:05:00",
    })

    client = TestClient(app)
    r = client.put("/watchlist-config/Swing", json={"auto_expire_days": 10})
    assert r.status_code == 200
    assert r.json()["auto_expire_days"] == 10
    db.upsert_watchlist_config.assert_awaited_once_with("Swing", 10)


def test_router_put_null_is_allowed(app_and_db):
    app, db = app_and_db
    db.get_watchlist_config = AsyncMock(return_value={
        "name": "Manual",
        "auto_expire_days": None,
        "updated_at": "2026-04-15 10:05:00",
    })
    client = TestClient(app)
    r = client.put("/watchlist-config/Manual", json={"auto_expire_days": None})
    assert r.status_code == 200
    assert r.json()["auto_expire_days"] is None


def test_router_put_rejects_empty_name(app_and_db):
    app, _db = app_and_db
    client = TestClient(app)
    r = client.put("/watchlist-config/%20%20", json={"auto_expire_days": 1})
    assert r.status_code == 400


def test_router_delete_204_then_404(app_and_db):
    app, db = app_and_db
    client = TestClient(app)
    r = client.delete("/watchlist-config/Swing")
    assert r.status_code == 204
    db.delete_watchlist_config.assert_awaited_once_with("Swing")

    db.delete_watchlist_config = AsyncMock(return_value=False)
    r = client.delete("/watchlist-config/Unknown")
    assert r.status_code == 404


# ── Scanner: expiry priority ───────────────────────────────────

def make_scanner(db=None, ibkr=None) -> ScannerService:
    return ScannerService(ibkr=ibkr or MagicMock(), db=db or MagicMock())


@pytest.mark.asyncio
async def test_resolve_expire_days_uses_watchlist_override():
    db = MagicMock()
    db.get_watchlist_config = AsyncMock(return_value={
        "name": "Fast Setups", "auto_expire_days": 2, "updated_at": "x",
    })
    scanner = make_scanner(db=db)
    rule = {"ibkr_mirror_target": "Fast Setups"}
    days = await scanner._resolve_expire_days(rule)
    assert days == 2


@pytest.mark.asyncio
async def test_resolve_expire_days_null_override_means_no_expiry():
    # watchlist_config row with NULL explicitly disables auto-expire for this target.
    db = MagicMock()
    db.get_watchlist_config = AsyncMock(return_value={
        "name": "Manual", "auto_expire_days": None, "updated_at": "x",
    })
    scanner = make_scanner(db=db)
    rule = {"ibkr_mirror_target": "Manual"}
    days = await scanner._resolve_expire_days(rule)
    assert days is None


@pytest.mark.asyncio
async def test_resolve_expire_days_no_row_returns_none():
    """Under the new schema there is no rule-level fallback — no row ⇒ no expiry."""
    db = MagicMock()
    db.get_watchlist_config = AsyncMock(return_value=None)
    scanner = make_scanner(db=db)
    rule = {"ibkr_mirror_target": "Unknown"}
    days = await scanner._resolve_expire_days(rule)
    assert days is None


@pytest.mark.asyncio
async def test_resolve_expire_days_no_mirror_target_skips_lookup():
    db = MagicMock()
    db.get_watchlist_config = AsyncMock(return_value=None)
    scanner = make_scanner(db=db)
    rule = {"ibkr_mirror_target": None}
    days = await scanner._resolve_expire_days(rule)
    assert days is None
    db.get_watchlist_config.assert_not_awaited()


@pytest.mark.asyncio
async def test_resolve_expire_days_lookup_error_returns_none():
    db = MagicMock()
    db.get_watchlist_config = AsyncMock(side_effect=sqlite3.OperationalError("boom"))
    scanner = make_scanner(db=db)
    rule = {"ibkr_mirror_target": "Explode"}
    days = await scanner._resolve_expire_days(rule)
    assert days is None


# ── Scanner: auto-return expired hits ──────────────────────────

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

    # Both hits moved back — note the *reversed* direction (target → source).
    assert ibkr.move_between_watchlists.await_count == 2
    first_call = ibkr.move_between_watchlists.await_args_list[0].kwargs
    assert first_call["conid"] == 1001
    assert first_call["source_name"] == "RSI Oversold"
    assert first_call["target_name"] == "My Stocks"

    assert db.mark_moved_back.await_count == 2


@pytest.mark.asyncio
async def test_return_expired_hits_skips_mark_on_move_failure():
    db = MagicMock()
    db.get_expired_hits = AsyncMock(return_value=[
        {"id": 1, "conid": 1001, "source_watchlist": "A", "target_watchlist": "B"},
    ])
    db.mark_moved_back = AsyncMock(return_value=True)

    ibkr = MagicMock()
    ibkr.move_between_watchlists = AsyncMock(side_effect=IBKRConnectionError("ibkr down"))

    scanner = make_scanner(db=db, ibkr=ibkr)
    await scanner._return_expired_hits()

    # IBKR errored → we must NOT mark moved_back, otherwise the retry loop loses it.
    db.mark_moved_back.assert_not_awaited()


@pytest.mark.asyncio
async def test_return_expired_hits_get_expired_failure_is_swallowed():
    db = MagicMock()
    db.get_expired_hits = AsyncMock(side_effect=sqlite3.OperationalError("sqlite locked"))
    ibkr = MagicMock()
    ibkr.move_between_watchlists = AsyncMock()

    scanner = make_scanner(db=db, ibkr=ibkr)
    # Must not raise.
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
