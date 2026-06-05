"""
Tests for Branch 5 watchlist endpoints:
  POST   /watchlist/{id}/instruments         — add conid
  DELETE /watchlist/{id}/instruments/{conid} — remove conid
  GET    /watchlist/membership?conid=X       — which watchlists contain conid

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

    def test_add_returns_added_true(self):
        ibkr = make_ibkr(add_result=True)
        resp = _client(ibkr).post("/watchlist/wl1/instruments", json={"conid": 265598})
        assert resp.status_code == 200
        body = resp.json()
        assert body["added"] is True
        assert body["conid"] == 265598

    def test_add_returns_added_false_when_already_present(self):
        ibkr = make_ibkr(add_result=False)
        resp = _client(ibkr).post("/watchlist/wl1/instruments", json={"conid": 265598})
        assert resp.status_code == 200
        assert resp.json()["added"] is False

    def test_add_404_when_watchlist_not_found(self):
        ibkr = make_ibkr(watchlists=[{"id": "wl99", "name": "Other"}])
        resp = _client(ibkr).post("/watchlist/wl1/instruments", json={"conid": 265598})
        assert resp.status_code == 404

    def test_add_calls_ibkr_with_correct_args(self):
        ibkr = make_ibkr()
        _client(ibkr).post("/watchlist/wl1/instruments", json={"conid": 265598})
        ibkr.add_to_watchlist.assert_called_once_with("wl1", "RS Leaders", 265598)

    def test_add_422_on_missing_conid(self):
        ibkr = make_ibkr()
        resp = _client(ibkr).post("/watchlist/wl1/instruments", json={})
        assert resp.status_code == 422


# ─── DELETE /{watchlist_id}/instruments/{conid} ──────────────────────────────

class TestRemoveWatchlistInstrument:
    def teardown_method(self):
        _cleanup()

    def test_remove_returns_removed_true(self):
        ibkr = make_ibkr(remove_result=True)
        resp = _client(ibkr).delete("/watchlist/wl1/instruments/265598")
        assert resp.status_code == 200
        body = resp.json()
        assert body["removed"] is True
        assert body["conid"] == 265598

    def test_remove_returns_removed_false_when_not_present(self):
        ibkr = make_ibkr(remove_result=False)
        resp = _client(ibkr).delete("/watchlist/wl1/instruments/265598")
        assert resp.status_code == 200
        assert resp.json()["removed"] is False

    def test_remove_404_when_watchlist_not_found(self):
        ibkr = make_ibkr(watchlists=[])
        resp = _client(ibkr).delete("/watchlist/wl1/instruments/265598")
        assert resp.status_code == 404

    def test_remove_calls_ibkr_with_correct_args(self):
        ibkr = make_ibkr()
        _client(ibkr).delete("/watchlist/wl1/instruments/265598")
        ibkr.remove_from_watchlist.assert_called_once_with("wl1", "RS Leaders", 265598)


# ─── GET /membership?conid=X ─────────────────────────────────────────────────

class TestWatchlistMembership:
    def teardown_method(self):
        _cleanup()

    def test_membership_returns_empty_when_not_in_any(self):
        ibkr = make_ibkr(watchlist_items=[])
        resp = _client(ibkr).get("/watchlist/membership?conid=265598")
        assert resp.status_code == 200
        body = resp.json()
        assert body["conid"] == 265598
        assert body["watchlist_ids"] == []

    def test_membership_finds_conid_by_C_key(self):
        # IBKR's native format uses "C" for conid
        ibkr = make_ibkr(
            watchlists=[{"id": "wl1", "name": "RS Leaders"}],
            watchlist_items=[{"C": 265598}],
        )
        resp = _client(ibkr).get("/watchlist/membership?conid=265598")
        assert resp.status_code == 200
        assert "wl1" in resp.json()["watchlist_ids"]

    def test_membership_finds_conid_by_conid_key(self):
        ibkr = make_ibkr(
            watchlists=[{"id": "wl1", "name": "RS Leaders"}],
            watchlist_items=[{"conid": 265598}],
        )
        resp = _client(ibkr).get("/watchlist/membership?conid=265598")
        assert resp.status_code == 200
        assert "wl1" in resp.json()["watchlist_ids"]

    def test_membership_excludes_non_member_watchlists(self):
        # wl1 has the conid, wl2 does not
        items_by_id = {"wl1": [{"C": 265598}], "wl2": [{"C": 999999}]}

        async def get_items(wl_id):
            return items_by_id.get(wl_id, [])

        ibkr = make_ibkr(
            watchlists=[
                {"id": "wl1", "name": "RS Leaders"},
                {"id": "wl2", "name": "Other"},
            ],
        )
        ibkr.get_watchlist_items = get_items

        resp = _client(ibkr).get("/watchlist/membership?conid=265598")
        body = resp.json()
        assert "wl1" in body["watchlist_ids"]
        assert "wl2" not in body["watchlist_ids"]

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
