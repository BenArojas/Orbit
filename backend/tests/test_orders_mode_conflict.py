"""
Public-boundary test for mode-aware CP mutation block (Slice 3).

Critical promise: Unsafe trades cannot happen — Client Portal order mutations
must be rejected at the router boundary before reaching the execution adapter
while broker session mode is 'tws'.
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from deps import get_broker_session, require_ibkr_auth
from routers.orders import router as orders_router
from routers.trading_safety import router as trading_safety_router
from services.broker_session import BrokerSessionService


class _FakeIbkrState:
    authenticated = True


class _FakeIbkr:
    state = _FakeIbkrState()


class _FakeTwsAdapter:
    def __init__(self, *, connected: bool) -> None:
        self._connected = connected

    def is_connected(self) -> bool:
        return self._connected


def _client(tws_mode: bool) -> TestClient:
    fake = _FakeIbkr()
    session = BrokerSessionService(fake, _FakeTwsAdapter(connected=tws_mode))

    app = FastAPI()
    app.include_router(orders_router)
    app.include_router(trading_safety_router)
    app.dependency_overrides[require_ibkr_auth] = lambda: fake
    app.dependency_overrides[get_broker_session] = lambda: session
    # raise_server_exceptions=False so non-409 errors (e.g. missing IBKR stub)
    # surface as HTTP 500 rather than crashing the test — only needed for
    # the passthrough assertions where we intentionally don't stub IBKR.
    return TestClient(app, raise_server_exceptions=False)


def _order() -> dict:
    return {
        "conid": 265598,
        "side": "BUY",
        "quantity": 1,
        "orderType": "LMT",
        "tif": "DAY",
        "price": 180.0,
    }


# ── TWS mode blocks all four mutation routes with 409 ────────────────────────

def test_tws_mode_blocks_place():
    resp = _client(tws_mode=True).post(
        "/moonmarket/orders", json={"account_id": "DU1", "orders": [_order()]}
    )
    assert resp.status_code == 409
    detail = resp.json()["detail"]
    assert detail["error"] == "broker_session_mode_conflict"
    assert detail["current_mode"] == "tws"


def test_tws_mode_blocks_reply():
    resp = _client(tws_mode=True).post(
        "/moonmarket/orders/DU1/reply/r1", json={"confirmed": True}
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "broker_session_mode_conflict"


def test_tws_mode_blocks_cancel():
    resp = _client(tws_mode=True).delete("/moonmarket/orders/DU1/order-1")
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "broker_session_mode_conflict"


def test_tws_mode_blocks_modify():
    resp = _client(tws_mode=True).patch(
        "/moonmarket/orders/DU1/order-1", json=_order()
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "broker_session_mode_conflict"


# ── Preview is NOT blocked — it is a read/preview endpoint ──────────────────

def test_tws_mode_does_not_block_preview():
    """POST /preview must not return 409; any other error is fine here."""
    resp = _client(tws_mode=True).post(
        "/moonmarket/orders/preview",
        json={"account_id": "DU1", "order": _order()},
    )
    assert resp.status_code != 409


# ── Client-portal mode: mutations are not intercepted by mode guard ──────────

@pytest.mark.parametrize("method,path,body", [
    ("post",   "/moonmarket/orders",              {"account_id": "DU1", "orders": [_order()]}),
    ("delete", "/moonmarket/orders/DU1/order-1",  None),
])
def test_cp_mode_does_not_return_409(method: str, path: str, body: dict | None):
    """In client_portal mode, mutations must not be intercepted by the mode guard."""
    client = _client(tws_mode=False)
    kwargs = {"json": body} if body is not None else {}
    resp = getattr(client, method)(path, **kwargs)
    assert resp.status_code != 409
