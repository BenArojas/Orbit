"""
Tests for Branch 5 watchlist endpoints — error/failure paths only.

Protects promise #5: external failures and bad inputs are rejected safely
and visibly (404, 422, graceful skip).

Uses FastAPI TestClient with mocked IBKRService to avoid live IBKR calls.
"""

import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock

from deps import get_ibkr
from main import app  # root FastAPI app


# ─── Helpers ────────────────────────────────────────────────────────────────

def make_ibkr(
    watchlists=None,
    watchlist_items=None,
    add_result=True,
    remove_result=True,
):
    ibkr = AsyncMock()
    ibkr.get_watchlists = AsyncMock(
        return_value=watchlists
        if watchlists is not None
        else [{"id": "wl1", "name": "RS Leaders"}, {"id": "wl2", "name": "Watchlist 2"}]
    )
    ibkr.get_watchlist_items = AsyncMock(
        return_value=watchlist_items if watchlist_items is not None else []
    )
    ibkr.add_to_watchlist = AsyncMock(return_value=add_result)
    ibkr.remove_from_watchlist = AsyncMock(return_value=remove_result)
    return ibkr


def _client(ibkr):
    """Return a TestClient with get_ibkr overridden for this test."""
    app.dependency_overrides[get_ibkr] = lambda: ibkr
    client = TestClient(app)
    return client


def _cleanup():
    app.dependency_overrides.pop(get_ibkr, None)


# ─── POST /{watchlist_id}/instruments ────────────────────────────────────────

class TestAddWatchlistInstrument:
    def teardown_method(self):
        _cleanup()

    def test_add_404_when_watchlist_not_found(self):
        ibkr = make_ibkr(watchlists=[{"id": "wl99", "name": "Other"}])
        resp = _client(ibkr).post("/watchlist/wl1/instruments", json={"conid": 265598})
        assert resp.status_code == 404

    def test_add_422_on_missing_conid(self):
        ibkr = make_ibkr()
        resp = _client(ibkr).post("/watchlist/wl1/instruments", json={})
        assert resp.status_code == 422


# ─── DELETE /{watchlist_id}/instruments/{conid} ──────────────────────────────

class TestRemoveWatchlistInstrument:
    def teardown_method(self):
        _cleanup()

    def test_remove_404_when_watchlist_not_found(self):
        ibkr = make_ibkr(watchlists=[])
        resp = _client(ibkr).delete("/watchlist/wl1/instruments/265598")
        assert resp.status_code == 404


# ─── GET /membership?conid=X ─────────────────────────────────────────────────

class TestWatchlistMembership:
    def teardown_method(self):
        _cleanup()

    def test_membership_missing_conid_param_422(self):
        ibkr = make_ibkr()
        resp = _client(ibkr).get("/watchlist/membership")
        assert resp.status_code == 422

    def test_membership_skips_non_dict_items(self):
        # IBKR occasionally injects bare strings — they must be skipped gracefully
        ibkr = make_ibkr(
            watchlists=[{"id": "wl1", "name": "RS Leaders"}],
            watchlist_items=["Section Header", {"C": 265598}],
        )
        resp = _client(ibkr).get("/watchlist/membership?conid=265598")
        assert resp.status_code == 200
        assert "wl1" in resp.json()["watchlist_ids"]

    def test_membership_endpoint_is_not_shadowed_by_watchlist_id_route(self):
        """
        Confirm that GET /watchlist/membership is routed to the membership handler,
        not treated as a wildcard /{watchlist_id}/instruments request.
        """
        ibkr = make_ibkr(watchlist_items=[])
        resp = _client(ibkr).get("/watchlist/membership?conid=1")
        # Should be 200 from the membership endpoint, not 422/404 from instruments
        assert resp.status_code == 200
        assert "watchlist_ids" in resp.json()
