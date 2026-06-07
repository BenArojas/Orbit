"""
Tests for GET /market/conid/{symbol} company_name enrichment.

Covers:
  - resolve_conid returns companyName when IBKR search finds a matching result
  - companyName is upserted into the instruments table
  - companyName is empty string (not None) when no search match found
  - resolve_conid still succeeds when ibkr.search raises
"""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock


class TestResolveConidCompanyName:
    def _make_app(self, get_conid_result, search_results, db_calls: list):
        """Wire up a minimal FastAPI test client with mocked dependencies."""
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from routers.market import router
        from deps import get_ibkr, get_db

        app = FastAPI()

        mock_ibkr = MagicMock()
        mock_ibkr.get_conid = AsyncMock(return_value=get_conid_result)
        mock_ibkr.search = AsyncMock(return_value=search_results)

        mock_db = MagicMock()

        async def _upsert(**kwargs):
            db_calls.append(kwargs)

        mock_db.upsert_instrument = _upsert

        app.include_router(router)
        app.dependency_overrides[get_ibkr] = lambda: mock_ibkr
        app.dependency_overrides[get_db] = lambda: mock_db

        return TestClient(app)

    def test_company_name_returned_when_search_matches(self):
        db_calls = []
        client = self._make_app(
            get_conid_result=265598,
            search_results=[
                {"conid": 265598, "symbol": "AAPL", "companyHeader": "Apple Inc"},
                {"conid": 999999, "symbol": "AAPLX", "companyHeader": "Other"},
            ],
            db_calls=db_calls,
        )

        resp = client.get("/market/conid/AAPL")
        assert resp.status_code == 200
        data = resp.json()
        assert data["conid"] == 265598
        assert data["symbol"] == "AAPL"
        assert data["companyName"] == "Apple Inc"

    def test_company_name_upserted_into_db(self):
        db_calls = []
        client = self._make_app(
            get_conid_result=265598,
            search_results=[
                {"conid": 265598, "symbol": "AAPL", "companyHeader": "Apple Inc"},
            ],
            db_calls=db_calls,
        )

        client.get("/market/conid/AAPL")

        assert len(db_calls) == 1
        assert db_calls[0]["conid"] == 265598
        assert db_calls[0]["company_name"] == "Apple Inc"

    def test_company_name_empty_when_no_match_in_search(self):
        db_calls = []
        client = self._make_app(
            get_conid_result=265598,
            search_results=[
                # Different conid — no exact match
                {"conid": 999999, "symbol": "AAPLX", "companyHeader": "Other Corp"},
            ],
            db_calls=db_calls,
        )

        resp = client.get("/market/conid/AAPL")
        assert resp.status_code == 200
        data = resp.json()
        assert data["companyName"] == ""

    def test_still_succeeds_when_search_raises(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from routers.market import router
        from deps import get_ibkr, get_db
        from exceptions import IBKRConnectionError

        app = FastAPI()
        db_calls = []

        mock_ibkr = MagicMock()
        mock_ibkr.get_conid = AsyncMock(return_value=265598)
        mock_ibkr.search = AsyncMock(side_effect=IBKRConnectionError("IBKR down"))

        mock_db = MagicMock()

        async def _upsert(**kwargs):
            db_calls.append(kwargs)

        mock_db.upsert_instrument = _upsert

        app.include_router(router)
        app.dependency_overrides[get_ibkr] = lambda: mock_ibkr
        app.dependency_overrides[get_db] = lambda: mock_db

        client = TestClient(app)
        resp = client.get("/market/conid/AAPL")

        assert resp.status_code == 200
        data = resp.json()
        assert data["conid"] == 265598
        assert data["companyName"] == ""  # graceful degradation
