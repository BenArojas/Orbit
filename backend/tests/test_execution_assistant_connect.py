"""
Public-boundary test for TWS connect/disconnect endpoints.

Critical promise: connection failure produces typed visible adapter_state,
not an unhandled 500 — the frontend always receives a structured response.
"""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from deps import get_broker_session, get_tws_adapter
from routers.execution_assistant import router as ea_router
from services.broker_session import BrokerSessionService
from models.tws_execution_assistant import ReconciliationSummary, TwsStatusResponse


class _FakeIbkrState:
    authenticated = True


class _FakeIbkr:
    state = _FakeIbkrState()


class _AdapterStub:
    """Fake adapter that simulates connect success or failure without ib_async."""

    def __init__(self, *, connect_succeeds: bool, api_server_available: bool = False) -> None:
        self._connect_succeeds = connect_succeeds
        self._api_server_available = api_server_available
        self._state = "not_initialized"

    async def connect(self, host: str, port: int, client_id: int) -> None:
        self._state = "connected" if self._connect_succeeds else "error"

    async def disconnect(self) -> None:
        self._state = "disconnected"

    def is_connected(self) -> bool:
        return self._state == "connected"

    async def check_api_server(self) -> bool:
        return self.is_connected() or self._api_server_available

    def get_status(self, mode: str, api_server_available: bool = False) -> TwsStatusResponse:
        return TwsStatusResponse(
            mode=mode,  # type: ignore[arg-type]
            connected=self._state == "connected",
            adapter_state=self._state,  # type: ignore[arg-type]
            kill_switch_active=False,
            reconciliation_summary=ReconciliationSummary(),
            api_server_available=api_server_available,
        )


def _client(*, connect_succeeds: bool, api_server_available: bool = False) -> tuple[TestClient, _AdapterStub]:
    fake_ibkr = _FakeIbkr()
    adapter = _AdapterStub(connect_succeeds=connect_succeeds, api_server_available=api_server_available)
    session = BrokerSessionService(fake_ibkr, adapter)

    app = FastAPI()
    app.include_router(ea_router)
    app.dependency_overrides[get_broker_session] = lambda: session
    app.dependency_overrides[get_tws_adapter] = lambda: adapter

    return TestClient(app), adapter


def test_connect_failure_returns_error_adapter_state():
    """A refused connection must surface as adapter_state='error', not HTTP 500."""
    client, _ = _client(connect_succeeds=False)
    r = client.post(
        "/execution-assistant/connect",
        json={"host": "127.0.0.1", "port": 4002, "client_id": 1},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["adapter_state"] == "error"
    assert body["connected"] is False


def test_api_server_available_surfaces_in_status():
    """api_server_available=True must appear in status even when adapter is not connected."""
    client, _ = _client(connect_succeeds=False, api_server_available=True)
    r = client.get("/execution-assistant/status")
    assert r.status_code == 200
    body = r.json()
    assert body["connected"] is False
    assert body["api_server_available"] is True


def test_disconnect_returns_disconnected_state():
    """Disconnect must return adapter_state='disconnected' immediately."""
    client, _ = _client(connect_succeeds=True)
    client.post(
        "/execution-assistant/connect",
        json={"host": "127.0.0.1", "port": 4002, "client_id": 1},
    )
    r = client.post("/execution-assistant/disconnect")
    assert r.status_code == 200
    assert r.json()["adapter_state"] == "disconnected"
    assert r.json()["connected"] is False
