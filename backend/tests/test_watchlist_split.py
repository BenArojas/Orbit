"""
Tests for the split watchlist endpoints — Phase 8.9 / Commit C.

Old behavior: `GET /watchlist/{id}` returned instruments + market data
snapshots in one call. On watchlist switch the sidebar blocked for
seconds while IBKR polled for quotes.

New behavior:
  GET /watchlist/{id}/instruments  → instruments only (fast)
  GET /watchlist/{id}/quotes       → snapshots for a list of conids

These tests pin both endpoints with a mocked IBKRService + a stub
DatabaseService (for the instrument-cache upsert side effect).
"""
from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from deps import get_db, get_ibkr
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


def _make_client(mock_ibkr: IBKRService, stub_db: _StubDb) -> TestClient:
    app = FastAPI()
    app.include_router(wl_router)
    app.dependency_overrides[get_ibkr] = lambda: mock_ibkr
    app.dependency_overrides[get_db] = lambda: stub_db
    return TestClient(app)


# ── /instruments ──────────────────────────────────────────────

def test_instruments_returns_symbol_and_company_without_snapshot():
    mock_ibkr = AsyncMock(spec=IBKRService)
    mock_ibkr.get_watchlists.return_value = [
        {"id": "42", "name": "My List"},
    ]
    mock_ibkr.get_watchlist_items.return_value = [
        {"conid": 265598, "symbol": "AAPL", "name": "Apple Inc."},
        {"conid": 272093, "symbol": "MSFT", "name": "Microsoft Corp."},
    ]
    stub_db = _StubDb()
    client = _make_client(mock_ibkr, stub_db)

    resp = client.get("/watchlist/42/instruments")
    assert resp.status_code == 200

    body = resp.json()
    assert body["id"] == "42"
    assert body["name"] == "My List"
    assert body["items"] == [
        {"conid": 265598, "symbol": "AAPL", "companyName": "Apple Inc."},
        {"conid": 272093, "symbol": "MSFT", "companyName": "Microsoft Corp."},
    ]

    # Crucial: snapshot must NOT be invoked by the instruments endpoint.
    mock_ibkr.snapshot.assert_not_called()

    # And we seeded the instruments cache for Orbit.
    assert (265598, "AAPL", "Apple Inc.") in stub_db.upserts


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


def test_instruments_empty_watchlist():
    mock_ibkr = AsyncMock(spec=IBKRService)
    mock_ibkr.get_watchlists.return_value = [{"id": "9", "name": "Empty"}]
    mock_ibkr.get_watchlist_items.return_value = []
    stub_db = _StubDb()
    client = _make_client(mock_ibkr, stub_db)

    resp = client.get("/watchlist/9/instruments")
    assert resp.status_code == 200
    body = resp.json()
    assert body["items"] == []
    assert body["name"] == "Empty"


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

def test_quotes_returns_prices_for_requested_conids():
    mock_ibkr = AsyncMock(spec=IBKRService)
    mock_ibkr.snapshot.return_value = [
        {"conid": 265598, "31": "150.25", "83": "1.23", "82": "1.85"},
        {"conid": 272093, "31": "380.10", "83": "-0.50", "82": "-1.90"},
    ]
    stub_db = _StubDb()
    client = _make_client(mock_ibkr, stub_db)

    resp = client.get("/watchlist/42/quotes?conids=265598,272093")
    assert resp.status_code == 200

    body = resp.json()
    assert body == {
        "items": [
            {"conid": 265598, "lastPrice": 150.25, "changePercent": 1.23, "changeAmount": 1.85},
            {"conid": 272093, "lastPrice": 380.10, "changePercent": -0.50, "changeAmount": -1.90},
        ],
    }


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
