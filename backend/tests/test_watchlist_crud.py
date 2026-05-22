"""
Tests for IBKR watchlist create/delete (CRUD).

Covers:
  - IBKRService.create_watchlist — POSTs /iserver/watchlist with empty rows,
    returns {id, name}, invalidates cache.
  - IBKRService.delete_watchlist — DELETEs /iserver/watchlist with the id
    param, invalidates cache.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from services.ibkr import IBKRService


def make_ibkr() -> IBKRService:
    """Return an IBKRService with a mocked _request."""
    svc = IBKRService.__new__(IBKRService)
    svc.base_url = "https://localhost:5000/v1/api"
    svc.state = MagicMock()
    svc.state.accounts_fetched = True
    svc.http = AsyncMock()
    svc._tickle_task = None
    svc._ws_task = None
    svc._request = AsyncMock(return_value={})
    return svc


class TestCreateWatchlist:
    @pytest.mark.asyncio
    async def test_posts_to_iserver_watchlist_with_empty_rows(self):
        ibkr = make_ibkr()
        with patch("cache.cache") as mock_cache:
            mock_cache.delete = AsyncMock()
            result = await ibkr.create_watchlist("My List")

        ibkr._request.assert_awaited_once()
        args, kwargs = ibkr._request.call_args
        assert args[0] == "POST"
        assert args[1] == "/iserver/watchlist"
        body = kwargs["json"]
        assert body["name"] == "My List"
        assert body["rows"] == []
        assert "id" in body

        assert result["name"] == "My List"
        assert result["id"] == body["id"]

    @pytest.mark.asyncio
    async def test_includes_conids_as_rows(self):
        ibkr = make_ibkr()
        with patch("cache.cache") as mock_cache:
            mock_cache.delete = AsyncMock()
            await ibkr.create_watchlist("Tech", conids=[265598, 12345])

        body = ibkr._request.call_args.kwargs["json"]
        assert {"C": 265598} in body["rows"]
        assert {"C": 12345} in body["rows"]

    @pytest.mark.asyncio
    async def test_invalidates_cache(self):
        ibkr = make_ibkr()
        with patch("cache.cache") as mock_cache:
            mock_cache.delete = AsyncMock()
            await ibkr.create_watchlist("My List")
            mock_cache.delete.assert_awaited_once_with("get_watchlists")


class TestDeleteWatchlist:
    @pytest.mark.asyncio
    async def test_deletes_with_id_param(self):
        ibkr = make_ibkr()
        with patch("cache.cache") as mock_cache:
            mock_cache.delete = AsyncMock()
            await ibkr.delete_watchlist("999")

        ibkr._request.assert_awaited_once()
        args, kwargs = ibkr._request.call_args
        assert args[0] == "DELETE"
        assert args[1] == "/iserver/watchlist"
        assert kwargs["params"] == {"id": "999"}

    @pytest.mark.asyncio
    async def test_invalidates_cache(self):
        ibkr = make_ibkr()
        with patch("cache.cache") as mock_cache:
            mock_cache.delete = AsyncMock()
            await ibkr.delete_watchlist("999")
            mock_cache.delete.assert_awaited_once_with("get_watchlists")
