"""
Public-boundary test for GET/POST /orbit/session/mode.

Critical promise: incompatible broker modules fail closed before rendering —
the session contract that drives frontend gating must be correct at the
router/API boundary, not just in the service.

Mode is now connection-derived:
  1. TWS adapter connected  → "tws"  (wins if both active)
  2. CP authenticated       → "client_portal"
  3. Neither                → "none"
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from deps import get_broker_session
from routers.orbit_session import router as orbit_session_router
from services.broker_session import BrokerSessionService


class _FakeIbkrState:
    def __init__(self, *, authenticated: bool) -> None:
        self.authenticated = authenticated


class _FakeIbkr:
    def __init__(self, *, authenticated: bool) -> None:
        self.state = _FakeIbkrState(authenticated=authenticated)


class _FakeTwsAdapter:
    def __init__(self, *, connected: bool) -> None:
        self._connected = connected

    def is_connected(self) -> bool:
        return self._connected


def _client(*, authenticated: bool, tws_connected: bool = False) -> tuple[TestClient, BrokerSessionService]:
    """Return (client, session_service) so tests can inspect service state."""
    session = BrokerSessionService(_FakeIbkr(authenticated=authenticated), _FakeTwsAdapter(connected=tws_connected))

    app = FastAPI()
    app.include_router(orbit_session_router)
    app.dependency_overrides[get_broker_session] = lambda: session

    return TestClient(app), session


# ── Mode derivation ──────────────────────────────────────────────────────────

def test_neither_connected_yields_none_with_tws_launchable():
    """In none mode, TWS module is the setup entry point — CP modules stay locked."""
    client, _ = _client(authenticated=False, tws_connected=False)
    r = client.get("/orbit/session/mode")
    assert r.status_code == 200
    body = r.json()
    assert body["mode"] == "none"
    assert body["available_modules"] == ["tws-execution-assistant"]
    assert "parallax" not in body["available_modules"]
    assert "moonmarket" not in body["available_modules"]


def test_cp_auth_no_tws_yields_client_portal():
    client, _ = _client(authenticated=True, tws_connected=False)
    r = client.get("/orbit/session/mode")
    assert r.status_code == 200
    body = r.json()
    assert body["mode"] == "client_portal"
    assert set(body["available_modules"]) == {"parallax", "moonmarket", "inflect"}
    assert "tws-execution-assistant" not in body["available_modules"]


def test_tws_connected_yields_tws_mode():
    client, _ = _client(authenticated=False, tws_connected=True)
    r = client.get("/orbit/session/mode")
    assert r.status_code == 200
    body = r.json()
    assert body["mode"] == "tws"
    assert body["available_modules"] == ["tws-execution-assistant"]


def test_tws_wins_when_both_active():
    """TWS connection takes priority over CP auth for module gating."""
    client, _ = _client(authenticated=True, tws_connected=True)
    r = client.get("/orbit/session/mode")
    assert r.status_code == 200
    body = r.json()
    assert body["mode"] == "tws"
    assert body["available_modules"] == ["tws-execution-assistant"]
    assert "parallax" not in body["available_modules"]


# ── POST /orbit/session/mode (now a no-op; validation + response still work) ─

def test_post_returns_current_connection_derived_mode():
    """POST /mode is a no-op; response reflects actual connection state."""
    client, _ = _client(authenticated=True, tws_connected=False)
    r = client.post("/orbit/session/mode", json={"target": "tws"})
    assert r.status_code == 200
    # Mode is still client_portal — the POST doesn't change anything
    assert r.json()["mode"] == "client_portal"


def test_post_none_is_rejected():
    """'none' is not a valid switch target — it must fail validation."""
    client, _ = _client(authenticated=True)
    r = client.post("/orbit/session/mode", json={"target": "none"})
    assert r.status_code == 422


@pytest.mark.parametrize("bad_body", [
    {},
    {"target": ""},
    {"target": "live"},
    {"target": 42},
    {"mode": "tws"},  # wrong key name
])
def test_post_invalid_bodies_rejected(bad_body: dict):
    client, _ = _client(authenticated=True)
    r = client.post("/orbit/session/mode", json=bad_body)
    assert r.status_code == 422
