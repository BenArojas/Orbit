"""Critical promises: only the desktop mutates; real accounts never receive orders."""
import re
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from deps import get_tws_adapter
from main import app
from services.tws_broker_adapter import TwsBrokerAdapter
from sidecar_security import SESSION_HEADER, WS_PROTOCOL, legacy_order_route


def test_desktop_session_covers_all_routes_and_streams():
    client = TestClient(app)  # No lifespan: never starts Gateway or opens user DB.
    headers = {SESSION_HEADER: app.state.session_secret}
    mutations = [
        (path, method.upper())
        for path, operations in app.openapi()["paths"].items()
        for method in operations if method in {"post", "put", "patch", "delete"}
    ]
    assert len(mutations) > 40  # Full mounted route inventory, not one new endpoint.
    for route_path, method in mutations:
        path = re.sub(r"\{[^}]+\}", "1", route_path)
        for credential in ({}, {SESSION_HEADER: "wrong-session"}):
            response = client.request(method, path, headers=credential, json={})
            assert response.status_code == 401, (method, path, response.status_code)
        if legacy_order_route(path):
            response = client.request(method, path, headers=headers, json={})
            assert response.status_code == 403, (method, path)
            assert response.json()["error"] == "legacy_trading_disabled"

    assert client.get("/session/status", headers=headers).json() == {
        "authenticated": True, "paper_only": True,
    }
    assert client.get("/session/status", headers={SESSION_HEADER: "previous-launch"}).status_code == 401
    assert client.get("/session/status", headers={**headers, "Origin": "https://untrusted.example"}).status_code == 401
    assert client.get("/settings").status_code == 401
    assert client.post("/mcp-server/mcp", headers=headers, json={}).status_code == 404
    preflight = client.options("/settings/example", headers={
        "Origin": "tauri://localhost", "Access-Control-Request-Method": "PUT",
        "Access-Control-Request-Headers": SESSION_HEADER,
    })
    assert preflight.status_code == 200
    assert client.get("/.well-known/agent.json").status_code == 200

    for path in ("/ws", "/execution-assistant/ws"):
        for protocols in ([], [WS_PROTOCOL, "wrong-session"]):
            with pytest.raises(WebSocketDisconnect):
                with client.websocket_connect(path, subprotocols=protocols):
                    pytest.fail("Unauthenticated stream accepted")
        # URL credentials are not an alternative authentication mechanism.
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(f"{path}?token=not-a-header"):
                pytest.fail("Query credential accepted")

    adapter = SimpleNamespace(
        is_connected=lambda: False,
        stream_register_socket=lambda ws: None,
        stream_cleanup=lambda ws: None,
    )
    previous = getattr(app.state, "tws_adapter", None)
    app.state.tws_adapter = adapter
    try:
        with client.websocket_connect("/execution-assistant/ws", subprotocols=[WS_PROTOCOL, app.state.session_secret]) as ws:
            assert ws.receive_json() == {"type": "tws_stream_status", "connected": False}
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(
                "/execution-assistant/ws", subprotocols=[WS_PROTOCOL, app.state.session_secret],
                headers={"Origin": "https://untrusted.example"},
            ):
                pytest.fail("Foreign origin stream accepted")
    finally:
        app.state.tws_adapter = previous

    previous_ibkr = getattr(app.state, "ibkr", None)
    app.state.ibkr = SimpleNamespace(
        state=SimpleNamespace(authenticated=False, ws_connected=True),
        set_broadcast=lambda callback: None,
    )
    try:
        with client.websocket_connect("/ws", subprotocols=[WS_PROTOCOL, app.state.session_secret]) as ws:
            assert ws.receive_json()["type"] == "connection_status"
    finally:
        app.state.ibkr = previous_ibkr


@pytest.mark.parametrize("port,accounts,connected,expected", [
    (4002, ["DU12345"], True, 200),
    (7497, ["DU12345"], True, 200),
    (4002, ["DUQ12345"], True, 200),
    (4001, ["DU12345"], True, 403),
    (7496, ["DU12345"], True, 403),
    (4002, ["U12345"], True, 403),
    (4002, [], True, 403),
    (4002, ["DU12345", "U12345"], True, 403),
    (4002, ["DU12345", "DU67890"], True, 403),
    (4002, ["DU-not-an-account"], True, 403),
    (4002, ["DUQR12345"], True, 403),
    (4002, ["du12345"], True, 403),
    (4002, ["DUQ"], True, 403),
    (4002, ["DU12345"], False, 409),
])
def test_paper_order_identity_at_real_api_boundary(port, accounts, connected, expected):
    adapter = TwsBrokerAdapter()
    broker = MagicMock()
    broker.isConnected.return_value = connected
    broker.managedAccounts.return_value = accounts
    broker.reqTickersAsync = AsyncMock(side_effect=lambda contract: [SimpleNamespace(
        contract=contract, time=datetime.now(timezone.utc), marketDataType=1,
        last=10, close=10, open=10, high=10, low=10, bid=9.99, ask=10,
    )])
    broker.client.getReqId.side_effect = iter(range(100, 200))
    broker.placeOrder.side_effect = lambda contract, order: SimpleNamespace(
        order=order, orderStatus=SimpleNamespace(status="PreSubmitted"), advancedError="",
    )
    adapter._ib = broker
    adapter._state = "connected"
    adapter._connected_port = port
    app.dependency_overrides[get_tws_adapter] = lambda: adapter
    client = TestClient(app)
    try:
        response = client.post("/execution-assistant/order-packages/place-paper", headers={
            SESSION_HEADER: app.state.session_secret,
        }, json={
            "kind": "bracket", "conid": 123, "symbol": "TEST", "side": "BUY",
            "quantity": 1, "order_type": "LMT", "limit_price": 10,
            "stop_price": 9, "target_price": 12,
        })
        assert response.status_code == expected, response.json()
        if expected == 200:
            assert broker.placeOrder.call_count > 0
            assert all(call.args[1].account == accounts[0] for call in broker.placeOrder.call_args_list)
        else:
            broker.placeOrder.assert_not_called()
        # Even internal legacy callers cannot re-enable live order submission.
        from services.tws_broker_adapter import TwsPlaceOrderGuardError
        with pytest.raises(TwsPlaceOrderGuardError, match="live_trading_disabled"):
            adapter._ensure_order_mutation_allowed(mode="live", live_policy=MagicMock())
    finally:
        app.dependency_overrides.pop(get_tws_adapter, None)
