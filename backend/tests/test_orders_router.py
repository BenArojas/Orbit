from fastapi import FastAPI
from fastapi.testclient import TestClient

from deps import require_ibkr_auth
from models import TradingSafetyConfirmation, TradingSafetyDecision
from routers import orders as orders_router_module
from routers.orders import router as orders_router
from routers.trading_safety import router as trading_safety_router


class _FakeState:
    authenticated = True
    selected_account = "DU12345"

    def __init__(self) -> None:
        self.accounts = ["DU12345", "U12345"]
        self.accounts_payload = {
            "accounts": ["DU12345", "U12345"],
            "selectedAccount": "DU12345",
            "aliases": {"DU12345": "Paper", "U12345": "Live"},
            "acctProps": {"DU12345": {"isPaper": True}, "U12345": {"isPaper": False}},
        }


class _FakeIbkr:
    def __init__(self) -> None:
        self.state = _FakeState()
        self.requests: list[tuple[str, str, dict]] = []

    async def ensure_accounts(self) -> None:
        return None

    async def brokerage_accounts(self) -> list[dict]:
        payload = self.state.accounts_payload
        rows = []
        for account_id in self.state.accounts:
            props = payload.get("acctProps", {}).get(account_id, {})
            alias = payload.get("aliases", {}).get(account_id, account_id)
            rows.append(
                {
                    "id": account_id,
                    "accountId": account_id,
                    "accountTitle": alias,
                    "alias": alias,
                    "selected": account_id == self.state.selected_account,
                    **props,
                }
            )
        return rows

    async def _request(self, method: str, endpoint: str, **kwargs):
        self.requests.append((method, endpoint, dict(kwargs)))
        if endpoint.endswith("/orders/whatif"):
            return {"data": [{"amount": {"total": "925.60"}, "warning_message": "margin preview"}]}
        if endpoint.endswith("/orders"):
            return {"data": [{"id": "reply-1"}]}
        if endpoint.startswith("/iserver/reply/"):
            return {"data": [{"order_id": "order-1"}]}
        if endpoint == "/iserver/account/orders":
            if kwargs.get("params") == {"force": "true"}:
                return {"orders": []}
            return {
                "orders": [
                    {
                        "orderId": "order-1",
                        "conid": 265598,
                        "origOrderType": "LMT",
                        "side": "BUY",
                        "timeInForce": "DAY",
                        "totalSize": 5,
                        "price": 180.0,
                    }
                ]
            }
        if "/order/" in endpoint and method == "DELETE":
            return {"order_id": "order-1", "status": "cancelled"}
        if "/order/" in endpoint and method == "POST":
            return {"order_id": "order-1", "status": "modified"}
        raise AssertionError(f"Unexpected IBKR request: {method} {endpoint}")


def _client(fake_ibkr: _FakeIbkr) -> TestClient:
    app = FastAPI()
    app.include_router(orders_router)
    app.include_router(trading_safety_router)
    app.dependency_overrides[require_ibkr_auth] = lambda: fake_ibkr
    return TestClient(app)


def _single_order(conid: int = 265598) -> dict:
    return {
        "conid": conid,
        "side": "BUY",
        "quantity": 5,
        "orderType": "LMT",
        "tif": "DAY",
        "price": 180.0,
    }


def _option_order(conid: int = 7001) -> dict:
    return {
        "conid": conid,
        "assetClass": "OPT",
        "side": "BUY",
        "quantity": 1,
        "orderType": "LMT",
        "tif": "DAY",
        "price": 4.2,
    }


def test_preview_order_posts_whatif_and_allows_live_accounts():
    fake = _FakeIbkr()
    resp = _client(fake).post(
        "/moonmarket/orders/preview",
        json={"account_id": "U12345", "order": _single_order()},
    )

    assert resp.status_code == 200
    assert resp.json()["account_id"] == "U12345"
    assert fake.requests[-1] == (
        "POST",
        "/iserver/account/U12345/orders/whatif",
        {"json": {"orders": [_single_order()]}},
    )


def test_trading_safety_order_action_describes_live_place_confirmation():
    fake = _FakeIbkr()
    resp = _client(fake).get(
        "/moonmarket/trading-safety/order-action?account_id=U12345&action=place"
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body == {
        "account_id": "U12345",
        "action": "place",
        "allowed": True,
        "mode": "live_confirmation_required",
        "confirmation": {
            "required": True,
            "title": "Real-money order",
            "message": "Review and confirm before sending this live order to IBKR.",
            "confirm_label": "Place Live Order",
        },
    }


def test_place_order_posts_single_order_for_paper_account():
    fake = _FakeIbkr()
    resp = _client(fake).post(
        "/moonmarket/orders",
        json={"account_id": "DU12345", "orders": [_single_order()]},
    )

    assert resp.status_code == 200
    assert resp.json()["account_id"] == "DU12345"
    assert fake.requests[-1] == (
        "POST",
        "/iserver/account/DU12345/orders",
        {"json": {"orders": [_single_order()]}},
    )


def test_place_order_stops_before_ibkr_when_trading_safety_rejects(monkeypatch):
    class _DenyPolicy:
        async def evaluate_order_action(self, account_id: str, action: str):
            return TradingSafetyDecision(
                account_id=account_id,
                action=action,
                allowed=False,
                mode="rejected",
                confirmation=TradingSafetyConfirmation(
                    required=False,
                    title=None,
                    message="Trading Safety rejected this order.",
                    confirm_label=None,
                ),
            )

    monkeypatch.setattr(orders_router_module, "_safety_policy", lambda _ibkr: _DenyPolicy(), raising=False)

    fake = _FakeIbkr()
    resp = _client(fake).post(
        "/moonmarket/orders",
        json={"account_id": "U12345", "orders": [_single_order()]},
    )

    assert resp.status_code == 403
    assert resp.json()["detail"]["error"] == "trading_safety_rejected"
    assert not any(endpoint.endswith("/orders") for _, endpoint, _ in fake.requests)


def test_place_order_preserves_bracket_payload_for_paper_account():
    fake = _FakeIbkr()
    bracket = [
        {**_single_order(), "cOID": "brkt-1"},
        {
            "conid": 265598,
            "parentId": "brkt-1",
            "side": "SELL",
            "quantity": 5,
            "orderType": "LMT",
            "tif": "GTC",
            "price": 200.0,
            "isSingleGroup": True,
        },
        {
            "conid": 265598,
            "parentId": "brkt-1",
            "side": "SELL",
            "quantity": 5,
            "orderType": "STP",
            "tif": "GTC",
            "auxPrice": 165.0,
            "isSingleGroup": True,
        },
    ]

    resp = _client(fake).post(
        "/moonmarket/orders",
        json={"account_id": "DU12345", "orders": bracket},
    )

    assert resp.status_code == 200
    assert fake.requests[-1][2] == {"json": {"orders": bracket}}


def test_place_order_maps_stop_price_to_ibkr_aux_price():
    fake = _FakeIbkr()
    order = {
        "conid": 265598,
        "side": "SELL",
        "quantity": 5,
        "orderType": "STP",
        "tif": "DAY",
        "price": 175.0,
    }

    resp = _client(fake).post(
        "/moonmarket/orders",
        json={"account_id": "DU12345", "orders": [order]},
    )

    assert resp.status_code == 200
    assert fake.requests[-1] == (
        "POST",
        "/iserver/account/DU12345/orders",
        {
            "json": {
                "orders": [
                    {
                        "conid": 265598,
                        "side": "SELL",
                        "quantity": 5.0,
                        "orderType": "STP",
                        "tif": "DAY",
                        "auxPrice": 175.0,
                    }
                ]
            }
        },
    )


def test_place_order_maps_internal_stop_limit_type_to_ibkr_wire_value():
    fake = _FakeIbkr()
    order = {
        "conid": 265598,
        "side": "SELL",
        "quantity": 5,
        "orderType": "STP_LIMIT",
        "tif": "DAY",
        "price": 174.0,
        "auxPrice": 175.0,
    }

    resp = _client(fake).post(
        "/moonmarket/orders",
        json={"account_id": "DU12345", "orders": [order]},
    )

    assert resp.status_code == 200
    assert fake.requests[-1] == (
        "POST",
        "/iserver/account/DU12345/orders",
        {
            "json": {
                "orders": [
                    {
                        "conid": 265598,
                        "side": "SELL",
                        "quantity": 5.0,
                        "orderType": "STP LMT",
                        "tif": "DAY",
                        "price": 174.0,
                        "auxPrice": 175.0,
                    }
                ]
            }
        },
    )


def test_place_single_option_order_posts_one_order_for_paper_account():
    fake = _FakeIbkr()
    resp = _client(fake).post(
        "/moonmarket/orders",
        json={"account_id": "DU12345", "orders": [_option_order()]},
    )

    expected_payload = {key: value for key, value in _option_order().items() if key != "assetClass"}
    assert resp.status_code == 200
    assert fake.requests[-1] == (
        "POST",
        "/iserver/account/DU12345/orders",
        {"json": {"orders": [expected_payload]}},
    )


def test_option_bracket_payload_is_rejected_before_ibkr_call():
    fake = _FakeIbkr()
    orders = [
        {**_option_order(), "cOID": "opt-brkt-1"},
        {**_option_order(), "parentId": "opt-brkt-1", "side": "SELL", "orderType": "LMT", "price": 6.0},
        {**_option_order(), "parentId": "opt-brkt-1", "side": "SELL", "orderType": "STP", "price": 3.0},
    ]

    resp = _client(fake).post("/moonmarket/orders", json={"account_id": "DU12345", "orders": orders})

    assert resp.status_code == 400
    assert resp.json()["detail"]["error"] == "option_bracket_not_supported"
    assert not any(endpoint.endswith("/orders") for _, endpoint, _ in fake.requests)


def test_reply_requires_account_id_for_paper_guard():
    fake = _FakeIbkr()
    resp = _client(fake).post(
        "/moonmarket/orders/DU12345/reply/reply-1",
        json={"confirmed": True},
    )

    assert resp.status_code == 200
    assert fake.requests[-1] == (
        "POST",
        "/iserver/reply/reply-1",
        {"json": {"confirmed": True}},
    )


def test_reply_stops_before_ibkr_when_trading_safety_rejects(monkeypatch):
    class _DenyPolicy:
        async def evaluate_order_action(self, account_id: str, action: str):
            return TradingSafetyDecision(
                account_id=account_id,
                action=action,
                allowed=False,
                mode="rejected",
                confirmation=TradingSafetyConfirmation(
                    required=False,
                    title=None,
                    message="Trading Safety rejected this reply.",
                    confirm_label=None,
                ),
            )

    monkeypatch.setattr(orders_router_module, "_safety_policy", lambda _ibkr: _DenyPolicy(), raising=False)

    fake = _FakeIbkr()
    resp = _client(fake).post(
        "/moonmarket/orders/U12345/reply/reply-1",
        json={"confirmed": True},
    )

    assert resp.status_code == 403
    assert resp.json()["detail"]["error"] == "trading_safety_rejected"
    assert not any(endpoint.startswith("/iserver/reply/") for _, endpoint, _ in fake.requests)


def test_cancel_and_modify_call_ibkr_for_paper_account():
    fake = _FakeIbkr()
    client = _client(fake)

    cancel = client.delete("/moonmarket/orders/DU12345/order-1")
    modify = client.patch(
        "/moonmarket/orders/DU12345/order-1",
        json={"conid": 265598, "side": "BUY", "quantity": 5, "orderType": "LMT", "tif": "DAY", "price": 181.0},
    )

    assert cancel.status_code == 200
    assert modify.status_code == 200
    assert ("DELETE", "/iserver/account/DU12345/order/order-1", {}) in fake.requests
    assert fake.requests[-1] == (
        "POST",
        "/iserver/account/DU12345/order/order-1",
        {"json": {"conid": 265598, "orderType": "LMT", "side": "BUY", "tif": "DAY", "quantity": 5.0, "price": 181.0}},
    )


def test_cancel_stops_before_ibkr_when_trading_safety_rejects(monkeypatch):
    class _DenyPolicy:
        async def evaluate_order_action(self, account_id: str, action: str):
            return TradingSafetyDecision(
                account_id=account_id,
                action=action,
                allowed=False,
                mode="rejected",
                confirmation=TradingSafetyConfirmation(
                    required=False,
                    title=None,
                    message="Trading Safety rejected this cancel.",
                    confirm_label=None,
                ),
            )

    monkeypatch.setattr(orders_router_module, "_safety_policy", lambda _ibkr: _DenyPolicy(), raising=False)

    fake = _FakeIbkr()
    resp = _client(fake).delete("/moonmarket/orders/U12345/order-1")

    assert resp.status_code == 403
    assert resp.json()["detail"]["error"] == "trading_safety_rejected"
    assert not any(method == "DELETE" and "/order/" in endpoint for method, endpoint, _ in fake.requests)


def test_modify_stops_before_ibkr_when_trading_safety_rejects(monkeypatch):
    class _DenyPolicy:
        async def evaluate_order_action(self, account_id: str, action: str):
            return TradingSafetyDecision(
                account_id=account_id,
                action=action,
                allowed=False,
                mode="rejected",
                confirmation=TradingSafetyConfirmation(
                    required=False,
                    title=None,
                    message="Trading Safety rejected this modify.",
                    confirm_label=None,
                ),
            )

    monkeypatch.setattr(orders_router_module, "_safety_policy", lambda _ibkr: _DenyPolicy(), raising=False)

    fake = _FakeIbkr()
    resp = _client(fake).patch("/moonmarket/orders/U12345/order-1", json=_single_order())

    assert resp.status_code == 403
    assert resp.json()["detail"]["error"] == "trading_safety_rejected"
    assert not any(method == "POST" and "/order/" in endpoint for method, endpoint, _ in fake.requests)


def test_live_account_allows_all_order_mutations():
    fake = _FakeIbkr()
    client = _client(fake)

    responses = [
        client.post("/moonmarket/orders", json={"account_id": "U12345", "orders": [_single_order()]}),
        client.post("/moonmarket/orders/U12345/reply/reply-1", json={"confirmed": True}),
        client.delete("/moonmarket/orders/U12345/order-1"),
        client.patch("/moonmarket/orders/U12345/order-1", json=_single_order()),
    ]

    assert [resp.status_code for resp in responses] == [200, 200, 200, 200]
    assert ("POST", "/iserver/account/U12345/orders", {"json": {"orders": [_single_order()]}}) in fake.requests
    assert ("POST", "/iserver/reply/reply-1", {"json": {"confirmed": True}}) in fake.requests
    assert ("DELETE", "/iserver/account/U12345/order/order-1", {}) in fake.requests


def _trail_order(conid: int = 265598) -> dict:
    return {
        "conid": conid,
        "side": "SELL",
        "quantity": 5,
        "orderType": "TRAIL",
        "tif": "GTC",
        "trailingType": "%",
        "trailingAmt": 5,
        "outsideRTH": True,
    }


def _traillmt_order(conid: int = 265598) -> dict:
    return {
        "conid": conid,
        "side": "SELL",
        "quantity": 5,
        "orderType": "TRAILLMT",
        "tif": "GTC",
        "trailingType": "amt",
        "trailingAmt": 2,
        "price": 178.0,
        "auxPrice": 183.0,
    }


def test_place_trail_order_serializes_trailing_and_rth_fields():
    fake = _FakeIbkr()
    resp = _client(fake).post(
        "/moonmarket/orders",
        json={"account_id": "DU12345", "orders": [_trail_order()]},
    )

    assert resp.status_code == 200
    sent = fake.requests[-1][2]["json"]["orders"][0]
    assert sent["orderType"] == "TRAIL"
    assert sent["trailingType"] == "%"
    assert sent["trailingAmt"] == 5
    assert sent["outsideRTH"] is True
    assert "price" not in sent


def test_place_traillmt_order_includes_limit_price():
    fake = _FakeIbkr()
    resp = _client(fake).post(
        "/moonmarket/orders",
        json={"account_id": "DU12345", "orders": [_traillmt_order()]},
    )

    assert resp.status_code == 200
    sent = fake.requests[-1][2]["json"]["orders"][0]
    assert sent["orderType"] == "TRAILLMT"
    assert sent["price"] == 178.0
    assert sent["auxPrice"] == 183.0
    assert sent["trailingType"] == "amt"
    assert sent["trailingAmt"] == 2
    assert "outsideRTH" not in sent or sent["outsideRTH"] is False


def test_place_rejects_stop_order_without_stop_price():
    fake = _FakeIbkr()
    resp = _client(fake).post(
        "/moonmarket/orders",
        json={
            "account_id": "DU12345",
            "orders": [{"conid": 1, "side": "BUY", "quantity": 1, "orderType": "STP", "tif": "DAY"}],
        },
    )
    assert resp.status_code == 422


def test_place_rejects_stop_limit_missing_a_leg():
    fake = _FakeIbkr()
    # missing auxPrice (stop)
    resp = _client(fake).post(
        "/moonmarket/orders",
        json={
            "account_id": "DU12345",
            "orders": [{"conid": 1, "side": "BUY", "quantity": 1, "orderType": "STP_LIMIT", "tif": "DAY", "price": 10}],
        },
    )
    assert resp.status_code == 422
