from fastapi import FastAPI
from fastapi.testclient import TestClient

from deps import get_db, get_ibkr
from routers.market import router


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


class _FakeDb:
    async def upsert_instrument(
        self,
        conid: int,
        symbol: str,
        company_name: str,
        sec_type: str = "STK",
    ) -> None:
        return None


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_ibkr] = lambda: _FakeIbkr()
    app.dependency_overrides[get_db] = lambda: _FakeDb()
    return TestClient(app)


def test_quote_includes_bid_and_ask_sizes():
    resp = _client().get("/market/quote/265598")
    assert resp.status_code == 200
    body = resp.json()
    assert body["bid"] == 181.0
    assert body["ask"] == 181.2
    assert body["bidSize"] == 300.0
    assert body["askSize"] == 200.0


def test_bundled_quotes_include_bid_and_ask_sizes():
    resp = _client().get("/market/quotes?conids=265598,76792991")
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert [item["conid"] for item in items] == [265598, 76792991]
    assert items[0]["bidSize"] == 300.0
    assert items[0]["askSize"] == 200.0
