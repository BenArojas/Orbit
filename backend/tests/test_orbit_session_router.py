"""
Public-boundary test for GET/POST /orbit/session/mode.

Critical promise: incompatible broker modules fail closed before rendering —
the session contract that drives frontend gating must be correct at the
router/API boundary, not just in the service.
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


def _client(*, authenticated: bool) -> tuple[TestClient, BrokerSessionService]:
    """Return (client, session_service) so tests can inspect service state."""
    fake = _FakeIbkr(authenticated=authenticated)
    session = BrokerSessionService(fake)

    app = FastAPI()
    app.include_router(orbit_session_router)
    app.dependency_overrides[get_broker_session] = lambda: session

    return TestClient(app), session


# ── GET /orbit/session/mode ──────────────────────────────────────────────────

def test_get_mode_unauthenticated():
    client, _ = _client(authenticated=False)
    r = client.get("/orbit/session/mode")
    assert r.status_code == 200
    body = r.json()
    assert body["mode"] == "none"
    assert body["available_modules"] == []


def test_get_mode_authenticated():
    client, _ = _client(authenticated=True)
    r = client.get("/orbit/session/mode")
    assert r.status_code == 200
    body = r.json()
    assert body["mode"] == "client_portal"
    assert set(body["available_modules"]) == {"parallax", "moonmarket", "inflect"}
    assert "tws-execution-assistant" not in body["available_modules"]


# ── POST /orbit/session/mode ─────────────────────────────────────────────────

def test_post_tws_enters_tws_mode():
    client, _ = _client(authenticated=True)
    r = client.post("/orbit/session/mode", json={"target": "tws"})
    assert r.status_code == 200
    body = r.json()
    assert body["mode"] == "tws"
    assert body["available_modules"] == ["tws-execution-assistant"]


def test_post_client_portal_clears_tws_override():
    client, _ = _client(authenticated=True)
    # Enter TWS mode first
    client.post("/orbit/session/mode", json={"target": "tws"})
    # Clear back to client_portal
    r = client.post("/orbit/session/mode", json={"target": "client_portal"})
    assert r.status_code == 200
    body = r.json()
    assert body["mode"] == "client_portal"
    assert "parallax" in body["available_modules"]
    assert "tws-execution-assistant" not in body["available_modules"]


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
