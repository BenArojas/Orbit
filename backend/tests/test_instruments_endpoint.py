"""
Tests for GET /instruments/{conid} — instruments cache endpoint.

Covers:
  - 200 response when instrument is in the SQLite cache
  - 404 response when instrument is not cached
  - Response shape includes conid, symbol, company_name, sec_type, cached_at
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

# We import app directly so we can swap deps
from main import app
from deps import get_db


# ── Helpers ───────────────────────────────────────────────────

def _make_db(instrument: dict | None):
    """Stub DatabaseService whose get_instrument returns a fixture."""
    db = MagicMock()
    db.get_instrument = AsyncMock(return_value=instrument)
    return db


# ── Tests ─────────────────────────────────────────────────────

class TestGetInstrument:
    def test_returns_instrument_when_cached(self):
        cached = {
            "conid": 265598,
            "symbol": "AAPL",
            "company_name": "Apple Inc",
            "sec_type": "STK",
            "cached_at": "2026-05-05 10:00:00",
        }
        app.dependency_overrides[get_db] = lambda: _make_db(cached)

        with TestClient(app) as client:
            resp = client.get("/instruments/265598")

        assert resp.status_code == 200
        body = resp.json()
        assert body["conid"] == 265598
        assert body["symbol"] == "AAPL"
        assert body["company_name"] == "Apple Inc"
        assert body["sec_type"] == "STK"
        assert "cached_at" in body

        app.dependency_overrides.clear()

    def test_returns_404_when_not_cached(self):
        app.dependency_overrides[get_db] = lambda: _make_db(None)

        with TestClient(app) as client:
            resp = client.get("/instruments/999999")

        assert resp.status_code == 404
        assert "not found" in resp.json()["detail"].lower()

        app.dependency_overrides.clear()

    def test_calls_db_with_correct_conid(self):
        db = _make_db(None)
        app.dependency_overrides[get_db] = lambda: db

        with TestClient(app) as client:
            client.get("/instruments/265598")

        db.get_instrument.assert_awaited_once_with(265598)
        app.dependency_overrides.clear()
