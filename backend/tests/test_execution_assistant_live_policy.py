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


# ── Task 2: Live Place Path ──────────────────────────────────────────────────

from datetime import datetime, timezone

from deps import get_execution_plan_service
from models.execution_plan import ExecutionPlan
from models.tws_execution_assistant import PaperOrderPreview, PaperOrderSubmission


class _PlanServiceStub:
    def get(self, plan_id: str) -> ExecutionPlan | None:
        return ExecutionPlan(
            plan_id=plan_id,
            conid=270639,
            symbol="INTC",
            side="BUY",
            quantity=20,
            order_type="LMT",
            limit_price=120,
            stop_price=None,
            status="valid",
            validation_errors=[],
            created_at=datetime.now(timezone.utc),
        )

    def preview_paper(self, plan: ExecutionPlan) -> PaperOrderPreview:
        return PaperOrderPreview(
            plan_id=plan.plan_id,
            conid=plan.conid,
            symbol=plan.symbol,
            side=plan.side,
            quantity=plan.quantity,
            order_type=plan.order_type,
            limit_price=plan.limit_price,
            stop_price=plan.stop_price,
            tif="DAY",
            transmit=False,
            paper_only=True,
        )


class _LivePlaceAdapter(_AdapterStub):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.place_calls = 0

    async def place_order(self, plan, *, mode, live_policy=None, advanced_override=None):
        self.place_calls += 1
        if live_policy is not None:
            live_policy.assert_live_allowed(
                account_id=self.connected_account_id(),
                host=self.connected_host(),
                port=self.connected_port(),
                is_connected=self.is_connected(),
                is_paper_port=self.is_paper_port(),
            )
        return PaperOrderSubmission(
            order_id=77,
            status="sent_to_tws",
            plan_id=plan.plan_id,
            conid=plan.conid,
            symbol=plan.symbol,
            side=plan.side,
            quantity=plan.quantity,
            order_type=plan.order_type,
            limit_price=plan.limit_price,
            stop_price=plan.stop_price,
            submitted_at=datetime.now(timezone.utc),
        )


def _client_with_plan(adapter: _LivePlaceAdapter) -> tuple[TestClient, TwsLivePolicyService]:
    client, policy = _client(adapter)
    client.app.dependency_overrides[get_execution_plan_service] = lambda: _PlanServiceStub()
    return client, policy


def test_live_place_fails_closed_when_not_armed():
    adapter = _LivePlaceAdapter()
    client, _ = _client_with_plan(adapter)

    r = client.post("/execution-assistant/plans/p1/place-live")

    assert r.status_code == 403
    assert r.json()["detail"]["error"] == "live_session_not_allowlisted"
    assert adapter.place_calls == 0


def test_live_place_succeeds_when_allowlisted_and_armed():
    adapter = _LivePlaceAdapter()
    client, _ = _client_with_plan(adapter)
    client.post("/execution-assistant/live/allow", json={"account_id": "U12345", "host": "127.0.0.1", "port": 7496})
    client.post("/execution-assistant/live/arm", json={"account_id": "U12345", "host": "127.0.0.1", "port": 7496})

    r = client.post("/execution-assistant/plans/p1/place-live")

    assert r.status_code == 200
    assert r.json()["order_id"] == 77
    assert adapter.place_calls == 1


# ── Task 3: Live Cancel, Modify, And Override ────────────────────────────────

class _LiveActionAdapter(_LivePlaceAdapter):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.cancel_calls = 0
        self.modify_calls = 0

    def cancel_order(self, order_id, *, mode="paper", live_policy=None):
        self.cancel_calls += 1
        if mode == "live" and live_policy is not None:
            live_policy.assert_live_allowed(
                account_id=self.connected_account_id(),
                host=self.connected_host(),
                port=self.connected_port(),
                is_connected=self.is_connected(),
                is_paper_port=self.is_paper_port(),
            )
        return {"order_id": order_id, "status": "cancel_requested", "action": "cancel", "message": "Cancel request sent to TWS."}

    async def modify_order(self, order_id, req, *, mode="paper", live_policy=None, advanced_override=None):
        self.modify_calls += 1
        if mode == "live" and live_policy is not None:
            live_policy.assert_live_allowed(
                account_id=self.connected_account_id(),
                host=self.connected_host(),
                port=self.connected_port(),
                is_connected=self.is_connected(),
                is_paper_port=self.is_paper_port(),
            )
        return {"order_id": order_id, "status": "modify_requested", "action": "modify", "message": "Modify request sent to TWS."}


def test_live_cancel_requires_armed_policy():
    adapter = _LiveActionAdapter()
    client, _ = _client(adapter)

    r = client.delete("/execution-assistant/orders/77")

    assert r.status_code == 403
    assert r.json()["detail"]["error"] == "live_session_not_allowlisted"
    assert adapter.cancel_calls == 0


def test_live_modify_succeeds_when_armed():
    adapter = _LiveActionAdapter()
    client, _ = _client(adapter)
    client.post("/execution-assistant/live/allow", json={"account_id": "U12345", "host": "127.0.0.1", "port": 7496})
    client.post("/execution-assistant/live/arm", json={"account_id": "U12345", "host": "127.0.0.1", "port": 7496})

    r = client.patch("/execution-assistant/orders/77", json={"quantity": 10, "limit_price": 121, "stop_price": None})

    assert r.status_code == 200
    assert r.json()["action"] == "modify"
    assert adapter.modify_calls == 1
