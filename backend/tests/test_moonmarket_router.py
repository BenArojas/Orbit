from fastapi import FastAPI
from fastapi.testclient import TestClient

from deps import get_db, require_ibkr_auth
from routers.moonmarket import router as moonmarket_router
from services.db import DatabaseService


class _FakeState:
    authenticated = True
    selected_account = "DU12345"

    def __init__(self) -> None:
        self.accounts = ["DU12345", "U12345", "DU99999"]
        self.accounts_payload = {
            "accounts": ["DU12345", "U12345", "DU99999"],
            "selectedAccount": "DU12345",
            "aliases": {
                "DU12345": "Paper Trading",
                "U12345": "Live Trading",
                "DU99999": "Second Paper Account",
            },
            "acctProps": {
                "DU12345": {},
                "U12345": {"isPaper": False},
                "DU99999": {},
            },
            "isPaper": True,
        }


class _FakeIbkr:
    def __init__(self) -> None:
        self.state = _FakeState()
        self.requests: list[tuple[str, str, dict | None]] = []

    async def ensure_accounts(self) -> None:
        return None

    async def brokerage_accounts(self) -> list[dict]:
        payload = self.state.accounts_payload
        rows = []
        for account_id in self.state.accounts:
            props = payload.get("acctProps", {}).get(account_id, {})
            alias = payload.get("aliases", {}).get(account_id, account_id)
            row = {
                "id": account_id,
                "accountId": account_id,
                "accountTitle": alias,
                "alias": alias,
                "selected": account_id == self.state.selected_account,
                **props,
            }
            if (
                "isPaper" not in row
                and payload.get("isPaper") is not None
                and account_id == self.state.selected_account
            ):
                row["isPaper"] = payload["isPaper"]
            rows.append(row)
        return rows

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
        if endpoint == "/portfolio/DU12345/ledger":
            return {
                "BASE": {
                    "currency": "USD",
                    "secondkey": "BASE",
                    "cashbalance": 100.0,
                    "netliquidationvalue": 2200.0,
                }
            }
        if endpoint == "/pa/performance":
            if kwargs.get("json", {}).get("period") == "1M":
                return {
                    "nav": {
                        "data": [{"id": "DU12345", "navs": [100000.0, 101250.0]}],
                        "dates": ["2026-01-01", "2026-01-02"],
                    },
                    "cps": {
                        "data": [{"id": "DU12345", "returns": [0.0, 0.0125]}],
                        "dates": ["2026-01-01", "2026-01-02"],
                    },
                    "tpps": {
                        "data": [{"id": "DU12345", "returns": [0.0, 0.007]}],
                        "dates": ["2026-01-01", "2026-01-02"],
                    },
                }
            return {
                "nav": {"dates": ["2026-01-01", "2026-01-02"], "navs": [100000.0, 101250.0]},
                "cps": {"dates": ["2026-01-01", "2026-01-02"], "returns": [0.0, 1.25]},
                "tpps": {"dates": ["2026-01-01", "2026-01-02"], "returns": [0.0, 0.7]},
            }
        if endpoint == "/pa/allperiods":
            return {
                "currencyType": "base",
                "included": ["DU12345"],
                "DU12345": {
                    "1Y": {
                        "nav": [100000.0, 101250.0],
                        "cps": [0.0, 0.0125],
                        "dates": ["2026-01-01", "2026-01-02"],
                    },
                    "YTD": {
                        "nav": [101000.0, 103000.0],
                        "cps": [0.0, 0.0198],
                        "dates": ["2026-02-01", "2026-02-02"],
                    },
                    "periods": ["1Y", "YTD"],
                    "baseCurrency": "USD",
                },
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
        {"account_id": "DU12345", "label": "Paper Trading", "selected": True, "is_paper": True},
        {"account_id": "U12345", "label": "Live Trading", "selected": False, "is_paper": False},
        {"account_id": "DU99999", "label": "Second Paper Account", "selected": False, "is_paper": True},
    ]


def test_moonmarket_accounts_prefers_explicit_paper_flag_over_prefix():
    fake = _FakeIbkr()
    fake.state.accounts = ["DU-LIVE", "U-PAPER"]
    fake.state.selected_account = "DU-LIVE"
    fake.state.accounts_payload = {
        "accounts": ["DU-LIVE", "U-PAPER"],
        "selectedAccount": "DU-LIVE",
        "aliases": {
            "DU-LIVE": "Explicit Live",
            "U-PAPER": "Explicit Paper",
        },
        "acctProps": {
            "DU-LIVE": {"isPaper": False},
            "U-PAPER": {"isPaper": True},
        },
    }

    resp = _client(fake).get("/moonmarket/accounts")

    assert resp.status_code == 200
    body = resp.json()
    assert body["accounts"][0]["is_paper"] is False
    assert body["accounts"][1]["is_paper"] is True


def test_moonmarket_portfolio_pages_positions_and_computes_allocation():
    fake = _FakeIbkr()
    resp = _client(fake).get("/moonmarket/portfolio?account_id=DU12345")

    assert resp.status_code == 200
    body = resp.json()
    assert body["account_id"] == "DU12345"
    assert body["total_market_value"] == 2200.0
    assert body["total_unrealized_pnl"] == 135.0
    assert body["positions"][0]["conid"] == 756733
    assert body["positions"][0]["symbol"] == "SPY"
    assert body["positions"][1]["conid"] == 265598
    assert body["positions"][2]["asset_class"] == "CASH"
    assert body["positions"][2]["symbol"] == "CASH"
    assert body["allocation"][0]["percent"] == 50.0
    assert body["allocation"][1]["percent"] == 45.45
    assert body["allocation"][2]["percent"] == 4.55
    assert body["allocation"][2]["asset_class"] == "CASH"
    assert ("GET", "/portfolio/DU12345/positions/0", {}) in fake.requests
    assert ("GET", "/portfolio/DU12345/positions/1", {}) in fake.requests
    assert ("GET", "/portfolio/DU12345/ledger", {}) in fake.requests


def test_moonmarket_performance_posts_all_periods_and_normalizes_series():
    fake = _FakeIbkr()
    resp = _client(fake).get("/moonmarket/performance?account_id=DU12345&period=1Y")

    assert resp.status_code == 200
    body = resp.json()
    assert body["account_id"] == "DU12345"
    assert body["period"] == "1Y"
    assert body["nav"] == {"dates": ["2026-01-01", "2026-01-02"], "values": [100000.0, 101250.0]}
    assert body["cumulative_return"]["values"] == [0.0, 0.0125]
    assert body["period_return"]["values"] == [0.0, 0.0125]
    assert fake.requests[-1] == (
        "POST",
        "/pa/allperiods",
        {"json": {"acctIds": ["DU12345"]}},
    )


def test_moonmarket_performance_selects_requested_period_from_all_periods_payload():
    fake = _FakeIbkr()
    resp = _client(fake).get("/moonmarket/performance?account_id=DU12345&period=YTD")

    assert resp.status_code == 200
    body = resp.json()
    assert body["nav"] == {"dates": ["2026-02-01", "2026-02-02"], "values": [101000.0, 103000.0]}
    assert body["cumulative_return"]["values"] == [0.0, 0.0198]
    assert body["period_return"]["values"] == [0.0, 0.0198]


def test_moonmarket_performance_reuses_all_periods_payload_for_picker_changes():
    fake = _FakeIbkr()
    client = _client(fake)

    first = client.get("/moonmarket/performance?account_id=DU12345&period=1Y")
    second = client.get("/moonmarket/performance?account_id=DU12345&period=YTD")

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["nav"]["values"] == [100000.0, 101250.0]
    assert second.json()["nav"]["values"] == [101000.0, 103000.0]
    assert second.json()["cumulative_return"]["values"] == [0.0, 0.0198]
    all_period_requests = [request for request in fake.requests if request[1] == "/pa/allperiods"]
    assert all_period_requests == [
        ("POST", "/pa/allperiods", {"json": {"acctIds": ["DU12345"]}})
    ]


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
    assert ("GET", "/iserver/account/trades", {"params": {"days": 7}}) in fake.requests


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
