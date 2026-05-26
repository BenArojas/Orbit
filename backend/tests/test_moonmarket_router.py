from fastapi import FastAPI
from fastapi.testclient import TestClient

from deps import require_ibkr_auth
from routers.moonmarket import router as moonmarket_router


class _FakeState:
    authenticated = True
    selected_account = "DU12345"

    def __init__(self) -> None:
        self.accounts = [
            {"id": "DU12345", "accountId": "DU12345", "accountTitle": "Paper Trading"},
            {"id": "DU99999", "accountId": "DU99999", "accountTitle": "Second Account"},
        ]


class _FakeIbkr:
    def __init__(self) -> None:
        self.state = _FakeState()
        self.requests: list[tuple[str, str, dict | None]] = []

    async def ensure_accounts(self) -> list[dict]:
        return self.state.accounts

    async def _request(self, method: str, endpoint: str, **kwargs):
        self.requests.append((method, endpoint, dict(kwargs)))
        if endpoint == "/portfolio/DU12345/positions/0":
            return [
                {
                    "conid": 265598,
                    "ticker": "AAPL",
                    "name": "Apple Inc",
                    "assetClass": "STK",
                    "position": 5,
                    "mktPrice": 200.0,
                    "avgCost": 175.0,
                    "mktValue": 1000.0,
                    "unrealizedPnl": 125.0,
                    "dailyPnl": 10.0,
                    "currency": "USD",
                },
                {
                    "conid": 756733,
                    "ticker": "SPY",
                    "name": "SPDR S&P 500 ETF",
                    "assetClass": "ETF",
                    "position": 2,
                    "mktPrice": 550.0,
                    "avgCost": 545.0,
                    "mktValue": 1100.0,
                    "unrealizedPnl": 10.0,
                    "dailyPnl": -2.0,
                    "currency": "USD",
                },
            ]
        if endpoint == "/portfolio/DU12345/positions/1":
            return []
        if endpoint == "/pa/performance":
            return {
                "nav": {"dates": ["2026-01-01", "2026-01-02"], "navs": [100000.0, 101250.0]},
                "cps": {"dates": ["2026-01-01", "2026-01-02"], "returns": [0.0, 1.25]},
                "tpps": {"dates": ["2026-01-01", "2026-01-02"], "returns": [0.0, 0.7]},
            }
        raise AssertionError(f"Unexpected IBKR request: {method} {endpoint}")


def _client(fake_ibkr: _FakeIbkr | None = None) -> TestClient:
    # Mount the router on a bare app so the test is isolated from the full
    # lifespan (gateway/IBKR/Ollama startup), which is unnecessary here.
    app = FastAPI()
    app.include_router(moonmarket_router)
    if fake_ibkr is not None:
        app.dependency_overrides[require_ibkr_auth] = lambda: fake_ibkr
    return TestClient(app)


def test_moonmarket_health_is_prefixed_and_ok():
    resp = _client().get("/moonmarket/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["module"] == "moonmarket"
    assert body["status"] == "ok"


def test_moonmarket_accounts_returns_available_accounts_and_selected_account():
    resp = _client(_FakeIbkr()).get("/moonmarket/accounts")

    assert resp.status_code == 200
    body = resp.json()
    assert body["selected_account_id"] == "DU12345"
    assert body["accounts"] == [
        {"account_id": "DU12345", "label": "Paper Trading", "selected": True},
        {"account_id": "DU99999", "label": "Second Account", "selected": False},
    ]


def test_moonmarket_portfolio_pages_positions_and_computes_allocation():
    fake = _FakeIbkr()
    resp = _client(fake).get("/moonmarket/portfolio?account_id=DU12345")

    assert resp.status_code == 200
    body = resp.json()
    assert body["account_id"] == "DU12345"
    assert body["total_market_value"] == 2100.0
    assert body["total_unrealized_pnl"] == 135.0
    assert body["positions"][0]["conid"] == 756733
    assert body["positions"][0]["symbol"] == "SPY"
    assert body["positions"][1]["conid"] == 265598
    assert body["allocation"][0]["percent"] == 52.38
    assert body["allocation"][1]["percent"] == 47.62
    assert ("GET", "/portfolio/DU12345/positions/0", {}) in fake.requests
    assert ("GET", "/portfolio/DU12345/positions/1", {}) in fake.requests


def test_moonmarket_performance_posts_to_ibkr_and_normalizes_series():
    fake = _FakeIbkr()
    resp = _client(fake).get("/moonmarket/performance?account_id=DU12345&period=1Y")

    assert resp.status_code == 200
    body = resp.json()
    assert body["account_id"] == "DU12345"
    assert body["period"] == "1Y"
    assert body["nav"] == {"dates": ["2026-01-01", "2026-01-02"], "values": [100000.0, 101250.0]}
    assert body["cumulative_return"]["values"] == [0.0, 1.25]
    assert body["period_return"]["values"] == [0.0, 0.7]
    assert fake.requests[-1] == (
        "POST",
        "/pa/performance",
        {"json": {"acctIds": ["DU12345"], "period": "1Y"}},
    )
