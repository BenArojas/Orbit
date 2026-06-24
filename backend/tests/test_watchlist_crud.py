"""
Tests for IBKR watchlist create/delete (CRUD).

Protects promise #3: cache invalidation ensures stored data stays consistent
after mutations.
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
    async def test_invalidates_cache(self):
        ibkr = make_ibkr()
        with patch("cache.cache") as mock_cache:
            mock_cache.delete = AsyncMock()
            await ibkr.create_watchlist("My List")
            mock_cache.delete.assert_awaited_once_with("get_watchlists")


class TestDeleteWatchlist:
    @pytest.mark.asyncio
    async def test_invalidates_cache(self):
        ibkr = make_ibkr()
        with patch("cache.cache") as mock_cache:
            mock_cache.delete = AsyncMock()
            await ibkr.delete_watchlist("999")
            mock_cache.delete.assert_awaited_once_with("get_watchlists")
