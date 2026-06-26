"""
Public-boundary test for execution plan draft and validation endpoints.

Critical promise: unsafe trades cannot happen — plans for non-equity instruments
and malformed drafts must be rejected by validation before any submission exists.
"""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from deps import get_execution_plan_service, get_tws_adapter
from routers.execution_assistant import router as ea_router
from services.execution_plan import ExecutionPlanService


class _AdapterStub:
    def __init__(self, sec_type: str | None = "STK") -> None:
        self._sec_type = sec_type

    async def get_sec_type(self, conid: int) -> str | None:
        return self._sec_type


def _client(sec_type: str | None = "STK") -> TestClient:
    svc = ExecutionPlanService()
    app = FastAPI()
    app.include_router(ea_router)
    app.dependency_overrides[get_execution_plan_service] = lambda: svc
    app.dependency_overrides[get_tws_adapter] = lambda: _AdapterStub(sec_type=sec_type)
    return TestClient(app)


def _draft(**kwargs) -> dict:
    return {
        "conid": 265598,
        "symbol": "AAPL",
        "side": "BUY",
        "quantity": 10.0,
        "order_type": "LMT",
        "limit_price": 180.0,
        **kwargs,
    }


# ── Draft creation ───────────────────────────────────────────────────────────

def test_create_draft_returns_draft_status():
    r = _client().post("/execution-assistant/plans/draft", json=_draft())
    assert r.status_code == 201
    body = r.json()
    assert body["status"] == "draft"
    assert body["validation_errors"] == []
    assert "plan_id" in body


def test_get_plan_returns_saved_draft():
    client = _client()
    plan_id = client.post("/execution-assistant/plans/draft", json=_draft()).json()["plan_id"]
    r = client.get(f"/execution-assistant/plans/{plan_id}")
    assert r.status_code == 200
    assert r.json()["plan_id"] == plan_id


def test_get_unknown_plan_returns_404():
    assert _client().get("/execution-assistant/plans/nonexistent").status_code == 404


# ── Validation ───────────────────────────────────────────────────────────────

def test_valid_stock_lmt_plan_passes():
    client = _client(sec_type="STK")
    plan_id = client.post("/execution-assistant/plans/draft", json=_draft()).json()["plan_id"]
    r = client.post(f"/execution-assistant/plans/{plan_id}/validate")
    assert r.json()["status"] == "valid"
    assert r.json()["validation_errors"] == []


def test_non_equity_instrument_is_rejected():
    """A futures contract must be rejected even if all other fields are correct."""
    client = _client(sec_type="FUT")
    plan_id = client.post("/execution-assistant/plans/draft", json=_draft()).json()["plan_id"]
    r = client.post(f"/execution-assistant/plans/{plan_id}/validate")
    body = r.json()
    assert body["status"] == "invalid"
    assert any("v1" in e for e in body["validation_errors"])


def test_unresolvable_conid_is_rejected():
    """An unknown conid (TWS not connected, or bad ID) must not silently pass."""
    client = _client(sec_type=None)
    plan_id = client.post("/execution-assistant/plans/draft", json=_draft()).json()["plan_id"]
    assert client.post(f"/execution-assistant/plans/{plan_id}/validate").json()["status"] == "invalid"


def test_lmt_without_price_is_rejected():
    client = _client()
    plan_id = client.post(
        "/execution-assistant/plans/draft",
        json=_draft(order_type="LMT", limit_price=None),
    ).json()["plan_id"]
    assert client.post(f"/execution-assistant/plans/{plan_id}/validate").json()["status"] == "invalid"


def test_mkt_order_without_price_is_valid():
    client = _client(sec_type="STK")
    plan_id = client.post(
        "/execution-assistant/plans/draft",
        json=_draft(order_type="MKT", limit_price=None),
    ).json()["plan_id"]
    assert client.post(f"/execution-assistant/plans/{plan_id}/validate").json()["status"] == "valid"
