"""
Guard the agent discovery manifest's safety promise.

The manifest at /.well-known/agent.json tells any connecting agent that Orbit
never trades autonomously. That claim is a non-negotiable project rule — if a
refactor ever flips it, this test fails loudly. The route is mounted on a bare
app so the test needs no IBKR/Ollama lifespan.
"""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers.agent import router


def _client() -> TestClient:
    app = FastAPI(title="Orbit", version="0.1.0")
    app.include_router(router)
    return TestClient(app)


def test_manifest_declares_no_autonomous_trading():
    resp = _client().get("/.well-known/agent.json")
    assert resp.status_code == 200
    safety = resp.json()["safety"]
    assert safety["autonomous_trading"] is False
    assert safety["decision_support_only"] is True
    assert safety["broker_execution_requires_human"] is True


def test_manifest_points_at_machine_interfaces():
    body = _client().get("/.well-known/agent.json").json()
    assert body["name"] == "Orbit"
    assert body["interfaces"]["openapi"].endswith("/openapi.json")
    assert body["interfaces"]["llms_txt"].startswith("https://github.com/")
