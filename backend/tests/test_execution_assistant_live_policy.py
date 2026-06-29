from fastapi import FastAPI
from fastapi.testclient import TestClient

from deps import get_tws_adapter, get_tws_live_policy
from routers.execution_assistant import router as ea_router
from services.tws_live_policy import TwsLivePolicyService


class _AdapterStub:
    def __init__(self, *, connected: bool = True, account_id: str | None = "U12345", port: int | None = 7496) -> None:
        self._connected = connected
        self._account_id = account_id
        self._port = port

    def is_connected(self) -> bool:
        return self._connected

    def is_paper_port(self) -> bool:
        return self._port in {4002, 7497}

    def connected_account_id(self) -> str | None:
        return self._account_id

    def connected_host(self) -> str:
        return "127.0.0.1"

    def connected_port(self) -> int | None:
        return self._port


def _client(adapter: _AdapterStub | None = None) -> tuple[TestClient, TwsLivePolicyService]:
    policy = TwsLivePolicyService()
    app = FastAPI()
    app.include_router(ea_router)
    app.dependency_overrides[get_tws_adapter] = lambda: adapter or _AdapterStub()
    app.dependency_overrides[get_tws_live_policy] = lambda: policy
    return TestClient(app), policy


def test_live_arm_requires_allowlisted_account_and_port():
    client, _ = _client()

    r = client.post("/execution-assistant/live/arm", json={
        "account_id": "U12345",
        "host": "127.0.0.1",
        "port": 7496,
    })

    assert r.status_code == 403
    assert r.json()["detail"]["error"] == "live_session_not_allowlisted"


def test_live_arm_rejects_paper_port_even_if_allowlisted():
    client, _ = _client(_AdapterStub(account_id="DU12345", port=7497))
    client.post("/execution-assistant/live/allow", json={
        "account_id": "DU12345",
        "host": "127.0.0.1",
        "port": 7497,
    })

    r = client.post("/execution-assistant/live/arm", json={
        "account_id": "DU12345",
        "host": "127.0.0.1",
        "port": 7497,
    })

    assert r.status_code == 403
    assert r.json()["detail"]["error"] == "paper_port_cannot_arm_live"


def test_live_arm_succeeds_for_matching_allowlisted_live_session():
    client, _ = _client()
    client.post("/execution-assistant/live/allow", json={
        "account_id": "U12345",
        "host": "127.0.0.1",
        "port": 7496,
    })

    r = client.post("/execution-assistant/live/arm", json={
        "account_id": "U12345",
        "host": "127.0.0.1",
        "port": 7496,
    })

    assert r.status_code == 200
    assert r.json()["armed"] is True
    assert r.json()["allowlisted"] is True
