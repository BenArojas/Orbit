from fastapi.testclient import TestClient
from routers.moonmarket import router as moonmarket_router
from fastapi import FastAPI


def _client() -> TestClient:
    # Mount the router on a bare app so the test is isolated from the full
    # lifespan (gateway/IBKR/Ollama startup), which is unnecessary here.
    app = FastAPI()
    app.include_router(moonmarket_router)
    return TestClient(app)


def test_moonmarket_health_is_prefixed_and_ok():
    resp = _client().get("/moonmarket/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["module"] == "moonmarket"
    assert body["status"] == "ok"
