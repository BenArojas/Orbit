from fastapi import FastAPI
from fastapi.testclient import TestClient

from deps import get_db, require_ibkr_auth
from routers.moonmarket import router as moonmarket_router
from services.db import DatabaseService


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
        if endpoint == "/iserver/account/trades":
            return [
                {
                    "execution_id": "E-BUY-1",
                    "accountId": "DU12345",
                    "conid": 265598,
                    "symbol": "AAPL",
                    "order_description": "BOT 5 AAPL",
                    "side": "B",
                    "trade_time_r": 1779805920000,
                    "size": 5,
                    "price": 185.12,
                    "commission": 1.0,
                    "net_amount": -925.6,
                    "sec_type": "STK",
                },
                {
                    "executionId": "E-SELL-1",
                    "acctId": "DU12345",
                    "contractId": "756733",
                    "ticker": "SPY",
                    "orderDescription": "SLD 2 SPY",
                    "side": "SLD",
                    "tradeTimeR": 1779809520000,
                    "quantity": 2,
                    "price": 550.5,
                    "commission": 1.25,
                    "netAmount": 1101.0,
                    "secType": "ETF",
                },
                {
                    "execution_id": "BAD-NO-CONID",
                    "accountId": "DU12345",
                    "symbol": "MSFT",
                    "side": "BUY",
                    "size": 1,
                    "trade_time_r": 1779813120000,
                },
                {
                    "execution_id": "OLD-VALID",
                    "accountId": "DU12345",
                    "conid": 320227571,
                    "symbol": "QQQ",
                    "order_description": "BOT 1 QQQ",
                    "side": "B",
                    "trade_time_r": 1777593600000,
                    "size": 1,
                    "price": 450.0,
                    "commission": 1.0,
                    "net_amount": -450.0,
                    "sec_type": "ETF",
                },
            ]
        if endpoint == "/iserver/account/orders":
            if kwargs.get("params") == {"force": "true"}:
                return {"orders": []}
            return {
                "orders": [
                    {
                        "orderId": 123456789,
                        "conid": 265598,
                        "ticker": "AAPL",
                        "orderDesc": "BUY 5 AAPL LIMIT 180.00",
                        "side": "BUY",
                        "orderType": "LMT",
                        "quantity": 5,
                        "remainingQuantity": 5,
                        "price": 180.0,
                        "status": "Submitted",
                    }
                ]
            }
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


def _client(
    fake_ibkr: _FakeIbkr | None = None,
    db: DatabaseService | None = None,
) -> TestClient:
    # Mount the router on a bare app so the test is isolated from the full
    # lifespan (gateway/IBKR/Ollama startup), which is unnecessary here.
    app = FastAPI()
    app.include_router(moonmarket_router)
    if fake_ibkr is not None:
        app.dependency_overrides[require_ibkr_auth] = lambda: fake_ibkr
    if db is not None:
        app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


def _memory_db() -> DatabaseService:
    db = DatabaseService(db_path=":memory:")
    db._conn = db._connect()
    db._create_tables()
    db._migrate()
    return db


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


def test_moonmarket_trades_normalizes_summary_and_upserts_fills():
    fake = _FakeIbkr()
    db = _memory_db()
    resp = _client(fake, db).get("/moonmarket/trades?account_id=DU12345&days=7")

    assert resp.status_code == 200
    body = resp.json()
    assert body["account_id"] == "DU12345"
    assert body["days"] == 7
    assert body["summary"] == {
        "total_trades": 2,
        "total_volume": 7.0,
        "total_commissions": 2.25,
        "net_cash": 175.4,
        "buy_count": 1,
        "sell_count": 1,
    }
    assert body["trades"][0] == {
        "execution_id": "E-SELL-1",
        "account_id": "DU12345",
        "conid": 756733,
        "symbol": "SPY",
        "description": "SLD 2 SPY",
        "side": "SELL",
        "quantity": 2.0,
        "price": 550.5,
        "net_amount": 1101.0,
        "commission": 1.25,
        "sec_type": "ETF",
        "trade_time": "2026-05-26T15:32:00+00:00",
        "trade_time_ms": 1779809520000,
    }
    assert body["trades"][1]["execution_id"] == "E-BUY-1"
    assert body["trades"][1]["side"] == "BUY"
    assert [row["execution_id"] for row in db._fetchall("SELECT execution_id FROM fills ORDER BY trade_time_ms DESC")] == [
        "E-SELL-1",
        "E-BUY-1",
    ]
    assert ("GET", "/iserver/account/trades", {}) in fake.requests


def test_moonmarket_live_orders_warms_and_returns_read_only_orders():
    fake = _FakeIbkr()
    resp = _client(fake).get("/moonmarket/live-orders?account_id=DU12345")

    assert resp.status_code == 200
    body = resp.json()
    assert body == {
        "account_id": "DU12345",
        "orders": [
            {
                "order_id": "123456789",
                "conid": 265598,
                "symbol": "AAPL",
                "description": "BUY 5 AAPL LIMIT 180.00",
                "side": "BUY",
                "order_type": "LMT",
                "quantity": 5.0,
                "remaining_quantity": 5.0,
                "limit_price": 180.0,
                "status": "Submitted",
            }
        ],
    }
    assert fake.requests[-2:] == [
        ("GET", "/iserver/account/orders", {"params": {"force": "true"}}),
        ("GET", "/iserver/account/orders", {}),
    ]
    assert "cancel_url" not in body["orders"][0]
    assert "modify_url" not in body["orders"][0]
