"""
Tests for the split watchlist endpoints — failure/graceful-degradation paths.

Protects promise #5: bad/missing data from IBKR does not crash the endpoint.
"""
from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from deps import get_db, get_ibkr, get_instrument_identity
from routers.watchlist import router as wl_router
from services.ibkr import IBKRService


class _StubDb:
    """Minimal DatabaseService fake — just the upsert we call."""
    def __init__(self) -> None:
        self.upserts: list[tuple[int, str, str]] = []

    async def upsert_instrument(
        self,
        conid: int,
        symbol: str,
        company_name: str = "",
        sec_type: str = "STK",
    ) -> None:
        self.upserts.append((conid, symbol, company_name))


class _RecordingIdentity:
    def __init__(self) -> None:
        self.watchlist_rows: list[dict] = []

    def normalize_watchlist_identity(self, row: dict) -> dict | None:
        raw_conid = row.get("conid") or row.get("C")
        if not raw_conid:
            return None
        try:
            conid = int(raw_conid)
        except (TypeError, ValueError):
            return None
        return {
            "conid": conid,
            "symbol": row.get("symbol", "") or row.get("SYM", "") or row.get("ticker", ""),
            "companyName": row.get("name", "") or row.get("N", "") or row.get("companyHeader", ""),
        }

    async def cache_watchlist_identity(self, row: dict) -> None:
        self.watchlist_rows.append(row)


def _make_client(mock_ibkr: IBKRService, stub_db: _StubDb) -> TestClient:
    app = FastAPI()
    identity = _RecordingIdentity()
    app.include_router(wl_router)
    app.dependency_overrides[get_ibkr] = lambda: mock_ibkr
    app.dependency_overrides[get_db] = lambda: stub_db
    app.dependency_overrides[get_instrument_identity] = lambda: identity
    client = TestClient(app)
    client.identity = identity
    return client


# ── /instruments ──────────────────────────────────────────────

def test_instruments_skips_non_dict_entries():
    """IBKR sometimes returns bare strings/null inside the list — skip them."""
    mock_ibkr = AsyncMock(spec=IBKRService)
    mock_ibkr.get_watchlists.return_value = [{"id": "7", "name": "X"}]
    mock_ibkr.get_watchlist_items.return_value = [
        "stray-string",
        None,
        {"conid": 1, "symbol": "A", "name": "Alpha"},
    ]
    stub_db = _StubDb()
    client = _make_client(mock_ibkr, stub_db)

    resp = client.get("/watchlist/7/instruments")
    assert resp.status_code == 200
    assert resp.json()["items"] == [
        {"conid": 1, "symbol": "A", "companyName": "Alpha"},
    ]


def test_instruments_unknown_watchlist_id_still_returns_200():
    """Don't 404 on unknown id — return empty with blank name."""
    mock_ibkr = AsyncMock(spec=IBKRService)
    mock_ibkr.get_watchlists.return_value = [{"id": "1", "name": "Other"}]
    mock_ibkr.get_watchlist_items.return_value = []
    stub_db = _StubDb()
    client = _make_client(mock_ibkr, stub_db)

    resp = client.get("/watchlist/nope/instruments")
    assert resp.status_code == 200
    assert resp.json()["name"] == ""


# ── /quotes ──────────────────────────────────────────────────

def test_quotes_fills_nulls_for_missing_conids():
    """If IBKR returns no snapshot for a conid, the row still appears with null fields."""
    mock_ibkr = AsyncMock(spec=IBKRService)
    mock_ibkr.snapshot.return_value = [
        {"conid": 265598, "31": "150.25", "83": "1.23", "82": "1.85"},
    ]
    stub_db = _StubDb()
    client = _make_client(mock_ibkr, stub_db)

    resp = client.get("/watchlist/42/quotes?conids=265598,999999")
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) == 2
    assert items[1] == {
        "conid": 999999, "lastPrice": None, "changePercent": None, "changeAmount": None,
    }


def test_quotes_with_empty_conids_returns_empty_list():
    mock_ibkr = AsyncMock(spec=IBKRService)
    stub_db = _StubDb()
    client = _make_client(mock_ibkr, stub_db)

    resp = client.get("/watchlist/42/quotes?conids=")
    assert resp.status_code == 200
    assert resp.json() == {"items": []}
    mock_ibkr.snapshot.assert_not_called()


def test_quotes_skips_bad_conid_strings():
    """Non-numeric conids in the query string shouldn't 500."""
    mock_ibkr = AsyncMock(spec=IBKRService)
    mock_ibkr.snapshot.return_value = [
        {"conid": 265598, "31": "150.25", "83": "1.23", "82": "1.85"},
    ]
    stub_db = _StubDb()
    client = _make_client(mock_ibkr, stub_db)

    resp = client.get("/watchlist/42/quotes?conids=abc,265598,,xyz")
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) == 1
    assert items[0]["conid"] == 265598
