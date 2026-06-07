from __future__ import annotations

import os
import tempfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from deps import get_db, get_ibkr, get_instrument_identity
from routers.instruments import router as instruments_router
from routers.market import router as market_router
from services.db import DatabaseService
from services.instrument_identity import InstrumentIdentityService


class _FakeIbkr:
    async def snapshot(self, conids: list[int], fields: str) -> list[dict]:
        return [
            {
                "conid": conid,
                "55": "AAPL",
                "7051": "Apple Inc",
                "31": "181.10",
                "84": "181.00",
                "86": "181.20",
                "88": "300",
                "85": "200",
            }
            for conid in conids
        ]


@pytest.fixture
async def db_service():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    db = DatabaseService(db_path=path)
    await db.initialize()
    try:
        yield db
    finally:
        await db.close()
        try:
            os.unlink(path)
        except OSError:
            pass


def _client(db: DatabaseService) -> TestClient:
    app = FastAPI()
    identity = InstrumentIdentityService(db)
    app.include_router(market_router)
    app.include_router(instruments_router)
    app.dependency_overrides[get_ibkr] = lambda: _FakeIbkr()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_instrument_identity] = lambda: identity
    return TestClient(app)


@pytest.mark.asyncio
async def test_quote_populates_identity_that_instruments_endpoint_reads(db_service):
    client = _client(db_service)

    quote = client.get("/market/quote/265598")
    assert quote.status_code == 200
    quote_body = quote.json()
    assert quote_body["symbol"] == "AAPL"
    assert quote_body["companyName"] == "Apple Inc"
    assert quote_body["bidSize"] == 300.0
    assert quote_body["askSize"] == 200.0

    instrument = client.get("/instruments/265598")
    assert instrument.status_code == 200
    assert instrument.json() == {
        "conid": 265598,
        "symbol": "AAPL",
        "company_name": "Apple Inc",
        "sec_type": "STK",
        "cached_at": instrument.json()["cached_at"],
    }


@pytest.mark.asyncio
async def test_instruments_endpoint_preserves_404_for_identity_cache_miss(db_service):
    response = _client(db_service).get("/instruments/999999")

    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()
