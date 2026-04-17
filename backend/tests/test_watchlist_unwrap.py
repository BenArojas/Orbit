"""
Tests for IBKR watchlist response unwrapping (Phase 8 / Task 8.9).

Regression: IBKR's /iserver/watchlists returns:
    {"data": {"user_lists": [...]}, ...}

Previously the service did `data.get("data", ...)` which returned the inner
DICT (not the list), then the router iterated a dict and got string keys,
crashing with "'str' object has no attribute 'get'" (HTTP 500).

These tests pin down every response shape we need to handle.
"""
from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from deps import get_ibkr
from routers.watchlist import router as wl_router
from services.ibkr import IBKRService


# ── Service-level unwrap (isolated from FastAPI) ───────────────

@pytest.fixture()
def ibkr_service(monkeypatch) -> IBKRService:
    """Build an IBKRService with a mocked _request + no-op ensure_accounts."""
    svc = IBKRService.__new__(IBKRService)  # bypass __init__
    svc.ensure_accounts = AsyncMock(return_value=None)
    svc._request = AsyncMock()
    # Bypass the @cached TTL — important when running multiple shapes in one test
    # session (otherwise the first mocked return value sticks for 60s).
    svc.get_watchlists = IBKRService.get_watchlists.__wrapped__.__get__(svc)
    return svc


@pytest.mark.asyncio
async def test_unwrap_nested_data_user_lists(ibkr_service: IBKRService):
    """Real IBKR shape: {'data': {'user_lists': [...]}}"""
    ibkr_service._request.return_value = {
        "data": {
            "scanners_only": False,
            "show_scanners": False,
            "bulk_delete": False,
            "user_lists": [
                {"id": "0", "name": "Favorites", "type": "user"},
                {"id": "1", "name": "Tech ETFs", "type": "user"},
            ],
        },
        "action": "content",
        "MID": "2",
    }
    result = await ibkr_service.get_watchlists()
    assert len(result) == 2
    assert result[0]["id"] == "0"
    assert result[1]["name"] == "Tech ETFs"


@pytest.mark.asyncio
async def test_unwrap_flat_user_lists(ibkr_service: IBKRService):
    """Alternate shape: {'user_lists': [...]}"""
    ibkr_service._request.return_value = {
        "user_lists": [{"id": "5", "name": "Swing"}],
    }
    result = await ibkr_service.get_watchlists()
    assert result == [{"id": "5", "name": "Swing"}]


@pytest.mark.asyncio
async def test_unwrap_data_as_list(ibkr_service: IBKRService):
    """Simplified shape: {'data': [...]}"""
    ibkr_service._request.return_value = {
        "data": [{"id": "9", "name": "Crypto"}],
    }
    result = await ibkr_service.get_watchlists()
    assert result == [{"id": "9", "name": "Crypto"}]


@pytest.mark.asyncio
async def test_unwrap_direct_list(ibkr_service: IBKRService):
    """Legacy / stub shape: direct list."""
    ibkr_service._request.return_value = [
        {"id": "1", "name": "A"},
        {"id": "2", "name": "B"},
    ]
    result = await ibkr_service.get_watchlists()
    assert len(result) == 2


@pytest.mark.asyncio
async def test_unwrap_filters_non_dict_entries(ibkr_service: IBKRService):
    """If IBKR sneaks a string into user_lists, we must filter it out."""
    ibkr_service._request.return_value = {
        "data": {
            "user_lists": [
                {"id": "1", "name": "Real"},
                "stray-string",          # the thing that used to crash us
                None,
                {"id": "2", "name": "Also real"},
            ],
        },
    }
    result = await ibkr_service.get_watchlists()
    assert len(result) == 2
    assert all(isinstance(wl, dict) for wl in result)


@pytest.mark.asyncio
async def test_unwrap_empty_response(ibkr_service: IBKRService):
    """Empty dict should not crash — return []."""
    ibkr_service._request.return_value = {}
    result = await ibkr_service.get_watchlists()
    assert result == []


@pytest.mark.asyncio
async def test_unwrap_null_user_lists(ibkr_service: IBKRService):
    """user_lists: null must be coerced to []."""
    ibkr_service._request.return_value = {"data": {"user_lists": None}}
    result = await ibkr_service.get_watchlists()
    assert result == []


# ── Router-level end-to-end (the actual 500 scenario) ─────────

def _make_app(mock_ibkr: IBKRService) -> FastAPI:
    app = FastAPI()
    app.include_router(wl_router)
    app.dependency_overrides[get_ibkr] = lambda: mock_ibkr
    return app


@pytest.mark.asyncio
async def test_router_returns_200_with_real_ibkr_shape():
    """The exact shape that caused the 500 — must now return 200."""
    mock_ibkr = AsyncMock(spec=IBKRService)
    mock_ibkr.get_watchlists.return_value = [
        {"id": "0", "name": "Favorites", "type": "user"},
        {"id": "1", "name": "Tech ETFs", "type": "user"},
    ]
    app = _make_app(mock_ibkr)
    client = TestClient(app)

    resp = client.get("/watchlist/lists")
    assert resp.status_code == 200
    body = resp.json()
    assert body == [
        {"id": "0", "name": "Favorites"},
        {"id": "1", "name": "Tech ETFs"},
    ]


@pytest.mark.asyncio
async def test_router_skips_non_dict_entries():
    """Defense in depth: if service ever returns bad data, router shouldn't 500."""
    mock_ibkr = AsyncMock(spec=IBKRService)
    mock_ibkr.get_watchlists.return_value = [
        "bad",
        {"id": "1", "name": "Good"},
        None,
    ]
    app = _make_app(mock_ibkr)
    client = TestClient(app)

    resp = client.get("/watchlist/lists")
    assert resp.status_code == 200
    assert resp.json() == [{"id": "1", "name": "Good"}]
