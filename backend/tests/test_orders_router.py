from fastapi import FastAPI
from fastapi.testclient import TestClient

from deps import require_ibkr_auth
from routers.orders import router as orders_router


class _FakeState:
    authenticated = True
    selected_account = "DU12345"

    def __init__(self) -> None:
        self.accounts = [
            {"id": "DU12345", "accountId": "DU12345", "accountTitle": "Paper", "isPaper": True},
            {"id": "U12345", "accountId": "U12345", "accountTitle": "Live", "isPaper": False},
        ]


class _FakeIbkr:
    def __init__(self) -> None:
        self.state = _FakeState()
        self.requests: list[tuple[str, str, dict]] = []

    async def ensure_accounts(self) -> list[dict]:
        return self.state.accounts

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
            "price": 165.0,
            "isSingleGroup": True,
        },
    ]

    resp = _client(fake).post(
        "/moonmarket/orders",
        json={"account_id": "DU12345", "orders": bracket},
    )

    assert resp.status_code == 200
    assert fake.requests[-1][2] == {"json": {"orders": bracket}}


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


def test_live_account_blocks_all_order_mutations():
    fake = _FakeIbkr()
    client = _client(fake)

    responses = [
        client.post("/moonmarket/orders", json={"account_id": "U12345", "orders": [_single_order()]}),
        client.post("/moonmarket/orders/U12345/reply/reply-1", json={"confirmed": True}),
        client.delete("/moonmarket/orders/U12345/order-1"),
        client.patch("/moonmarket/orders/U12345/order-1", json=_single_order()),
    ]

    assert [resp.status_code for resp in responses] == [403, 403, 403, 403]
    assert all(resp.json()["detail"]["error"] == "live_trading_blocked" for resp in responses)
