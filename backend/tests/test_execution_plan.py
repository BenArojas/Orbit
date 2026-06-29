"""
Public-boundary tests for execution plan draft, validation, preview, and submit endpoints.

Critical promises covered:
1. Unsafe trades cannot happen — non-equity plans and malformed drafts are rejected.
2. Preview/submit must fail closed outside the paper-only gate.
3. Kill switch blocks new order placement.
"""

from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.testclient import TestClient

from deps import get_execution_plan_service, get_tws_adapter, get_tws_live_policy
from models.execution_plan import ExecutionPlan
from models.tws_execution_assistant import PaperOrderSubmission, TwsModifyOrderRequest, TwsOrderActionResult
from routers.execution_assistant import router as ea_router
from services.execution_plan import ExecutionPlanService
from services.tws_broker_adapter import TwsAdvancedReject, TwsAdvancedRejectError, TwsPlaceOrderGuardError
from services.tws_live_policy import TwsLivePolicyService


class _AdapterStub:
    def __init__(
        self,
        sec_type: str | None = "STK",
        connected: bool = True,
        paper_port: bool = True,
        kill_switch: bool = False,
        raise_on_place: bool = False,
        raise_advanced_reject: bool = False,
        guard_error_code: str | None = None,
    ) -> None:
        self._sec_type = sec_type
        self._connected = connected
        self._paper_port = paper_port
        self._kill_switch = kill_switch
        self._raise_on_place = raise_on_place
        self._raise_advanced_reject = raise_advanced_reject
        self._guard_error_code = guard_error_code
        self.place_paper_order_calls: int = 0
        self.cancel_order_calls: int = 0
        self.modify_order_calls: int = 0

    def is_connected(self) -> bool:
        return self._connected

    def is_paper_port(self) -> bool:
        return self._paper_port

    def is_kill_switch_active(self) -> bool:
        return self._kill_switch

    async def place_paper_order(self, plan: ExecutionPlan, advanced_override: list[str] | None = None) -> PaperOrderSubmission:
        self.place_paper_order_calls += 1
        if self._guard_error_code:
            raise TwsPlaceOrderGuardError(self._guard_error_code)
        if self._raise_on_place:
            raise RuntimeError("Simulated adapter failure during placeOrder.")
        if self._raise_advanced_reject:
            raise TwsAdvancedRejectError(TwsAdvancedReject(
                reason="TWS: Order price is too far from market.",
                override_codes=["BYPASS_PRICE_BASED_VOLATILITY_SLOWDOWN_RESTRICTION"],
                raw={"message": "TWS: Order price is too far from market.", "8229": "BYPASS_PRICE_BASED_VOLATILITY_SLOWDOWN_RESTRICTION"},
            ))
        # "PreSubmitted" mirrors the first async TWS status for auto-transmit orders.
        return PaperOrderSubmission(
            order_id=9001,
            status="PreSubmitted",
            plan_id=plan.plan_id,
            conid=plan.conid,
            symbol=plan.symbol,
            side=plan.side,
            quantity=plan.quantity,
            order_type=plan.order_type,
            limit_price=plan.limit_price,
            stop_price=plan.stop_price,
            submitted_at=datetime(2026, 6, 27, 12, 0, 0, tzinfo=timezone.utc),
        )

    def cancel_order(self, order_id: int, *, mode: str = "paper", live_policy=None) -> TwsOrderActionResult:
        if not self._connected:
            raise TwsPlaceOrderGuardError("not_connected")
        if self._kill_switch:
            raise TwsPlaceOrderGuardError("kill_switch_active")
        self.cancel_order_calls += 1
        if self._guard_error_code:
            raise TwsPlaceOrderGuardError(self._guard_error_code)
        return TwsOrderActionResult(
            order_id=order_id, status="cancel_requested", action="cancel",
            message="Cancel request sent to TWS.",
        )

    async def modify_order(self, order_id: int, req: TwsModifyOrderRequest, *, mode: str = "paper", live_policy=None, advanced_override: list[str] | None = None) -> TwsOrderActionResult:
        if not self._connected:
            raise TwsPlaceOrderGuardError("not_connected")
        if self._kill_switch:
            raise TwsPlaceOrderGuardError("kill_switch_active")
        self.modify_order_calls += 1
        if self._guard_error_code:
            raise TwsPlaceOrderGuardError(self._guard_error_code)
        return TwsOrderActionResult(
            order_id=order_id, status="modify_requested", action="modify",
            message="Modify request sent to TWS.",
        )

    def connected_account_id(self) -> str | None:
        return "U12345" if self._connected else None

    def connected_host(self) -> str:
        return "127.0.0.1"

    def connected_port(self) -> int | None:
        return 7497 if self._paper_port else 7496

    async def get_sec_type(self, conid: int) -> str | None:
        return self._sec_type


def _client(
    sec_type: str | None = "STK",
    connected: bool = True,
    paper_port: bool = True,
    kill_switch: bool = False,
    raise_on_place: bool = False,
    raise_advanced_reject: bool = False,
    guard_error_code: str | None = None,
) -> TestClient:
    """Convenience helper for tests that only need the TestClient."""
    svc = ExecutionPlanService()
    app = FastAPI()
    app.include_router(ea_router)
    app.dependency_overrides[get_execution_plan_service] = lambda: svc
    app.dependency_overrides[get_tws_adapter] = lambda: _AdapterStub(
        sec_type=sec_type, connected=connected, paper_port=paper_port,
        kill_switch=kill_switch, raise_on_place=raise_on_place,
        raise_advanced_reject=raise_advanced_reject,
        guard_error_code=guard_error_code,
    )
    app.dependency_overrides[get_tws_live_policy] = lambda: TwsLivePolicyService()
    return TestClient(app)


def _setup(
    sec_type: str | None = "STK",
    connected: bool = True,
    paper_port: bool = True,
    kill_switch: bool = False,
    raise_on_place: bool = False,
    raise_advanced_reject: bool = False,
    guard_error_code: str | None = None,
) -> tuple[_AdapterStub, TestClient]:
    """Returns both the stub (for call-count inspection) and a TestClient."""
    stub = _AdapterStub(
        sec_type=sec_type, connected=connected, paper_port=paper_port,
        kill_switch=kill_switch, raise_on_place=raise_on_place,
        raise_advanced_reject=raise_advanced_reject,
        guard_error_code=guard_error_code,
    )
    svc = ExecutionPlanService()
    app = FastAPI()
    app.include_router(ea_router)
    app.dependency_overrides[get_execution_plan_service] = lambda: svc
    app.dependency_overrides[get_tws_adapter] = lambda: stub
    app.dependency_overrides[get_tws_live_policy] = lambda: TwsLivePolicyService()
    return stub, TestClient(app)


def _draft(**kwargs) -> dict:
    return {
        "conid": 265598,
        "symbol": "AAPL",
        "side": "BUY",
        "quantity": 10.0,
        "order_type": "LMT",
        "limit_price": 180.0,
        "stop_price": None,
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


# ── Paper preview gate ────────────────────────────────────────────────────────

def test_preview_paper_returns_preview_for_valid_plan_on_paper_port():
    """Critical promise: a valid plan on a paper port returns an exact preview."""
    client = _client(sec_type="STK", connected=True, paper_port=True)
    plan_id = client.post("/execution-assistant/plans/draft", json=_draft()).json()["plan_id"]
    client.post(f"/execution-assistant/plans/{plan_id}/validate")
    r = client.post(f"/execution-assistant/plans/{plan_id}/preview-paper")
    assert r.status_code == 200
    body = r.json()
    assert body["paper_only"] is True
    assert body["transmit"] is False
    assert body["conid"] == 265598
    assert body["symbol"] == "AAPL"
    assert body["side"] == "BUY"
    assert body["quantity"] == 10.0
    assert body["order_type"] == "LMT"
    assert body["limit_price"] == 180.0
    assert body["tif"] == "DAY"


def test_preview_paper_rejected_on_non_paper_port():
    """Critical promise: preview is blocked outside paper ports (fail closed)."""
    client = _client(sec_type="STK", connected=True, paper_port=False)
    plan_id = client.post("/execution-assistant/plans/draft", json=_draft()).json()["plan_id"]
    client.post(f"/execution-assistant/plans/{plan_id}/validate")
    r = client.post(f"/execution-assistant/plans/{plan_id}/preview-paper")
    assert r.status_code == 403
    assert r.json()["detail"]["error"] == "not_paper_port"


def test_preview_paper_rejected_when_not_connected():
    """Critical promise: preview is blocked if adapter is not connected."""
    client = _client(sec_type="STK", connected=False, paper_port=True)
    plan_id = client.post("/execution-assistant/plans/draft", json=_draft()).json()["plan_id"]
    r = client.post(f"/execution-assistant/plans/{plan_id}/preview-paper")
    assert r.status_code == 409
    assert r.json()["detail"]["error"] == "not_connected"


def test_preview_paper_rejected_for_unvalidated_plan():
    """Critical promise: draft-status plans cannot be previewed."""
    client = _client(sec_type="STK", connected=True, paper_port=True)
    plan_id = client.post("/execution-assistant/plans/draft", json=_draft()).json()["plan_id"]
    r = client.post(f"/execution-assistant/plans/{plan_id}/preview-paper")
    assert r.status_code == 422
    assert r.json()["detail"]["error"] == "plan_not_valid"


# ── Paper submit gate — fail-closed proofs ───────────────────────────────────
# Each test verifies both the HTTP rejection AND that the broker was never called.

def test_place_paper_order_calls_broker_exactly_once_on_happy_path():
    """Critical promise: a valid plan on a paper port reaches the broker exactly once."""
    stub, client = _setup(sec_type="STK", connected=True, paper_port=True)
    plan_id = client.post("/execution-assistant/plans/draft", json=_draft()).json()["plan_id"]
    client.post(f"/execution-assistant/plans/{plan_id}/validate")
    r = client.post(f"/execution-assistant/plans/{plan_id}/place-paper")
    assert r.status_code == 200
    body = r.json()
    assert body["order_id"] == 9001
    assert body["status"] == "PreSubmitted"
    assert body["symbol"] == "AAPL"
    assert stub.place_paper_order_calls == 1


def test_place_paper_order_blocked_when_disconnected_broker_not_called():
    """Critical promise: disconnected adapter rejects before touching the broker."""
    stub, client = _setup(sec_type="STK", connected=False, paper_port=True)
    plan_id = client.post("/execution-assistant/plans/draft", json=_draft()).json()["plan_id"]
    # Cannot validate without a connected adapter in reality, but draft is enough
    # to reach the submit gate and prove the connection check fires first.
    r = client.post(f"/execution-assistant/plans/{plan_id}/place-paper")
    assert r.status_code == 409
    assert r.json()["detail"]["error"] == "not_connected"
    assert stub.place_paper_order_calls == 0


def test_place_paper_order_blocked_on_non_paper_port_broker_not_called():
    """Critical promise: live/unknown port rejects before touching the broker."""
    stub, client = _setup(sec_type="STK", connected=True, paper_port=False)
    plan_id = client.post("/execution-assistant/plans/draft", json=_draft()).json()["plan_id"]
    client.post(f"/execution-assistant/plans/{plan_id}/validate")
    r = client.post(f"/execution-assistant/plans/{plan_id}/place-paper")
    assert r.status_code == 403
    assert r.json()["detail"]["error"] == "not_paper_port"
    assert stub.place_paper_order_calls == 0


def test_place_paper_order_blocked_for_unvalidated_plan_broker_not_called():
    """Critical promise: draft-status plan rejects before touching the broker."""
    stub, client = _setup(sec_type="STK", connected=True, paper_port=True)
    plan_id = client.post("/execution-assistant/plans/draft", json=_draft()).json()["plan_id"]
    # deliberately skip validate — plan remains in "draft" status
    r = client.post(f"/execution-assistant/plans/{plan_id}/place-paper")
    assert r.status_code == 422
    assert r.json()["detail"]["error"] == "plan_not_valid"
    assert stub.place_paper_order_calls == 0


def test_place_paper_order_blocked_by_kill_switch_broker_not_called():
    """Critical promise: active kill switch rejects before touching the broker."""
    stub, client = _setup(sec_type="STK", connected=True, paper_port=True, kill_switch=True)
    plan_id = client.post("/execution-assistant/plans/draft", json=_draft()).json()["plan_id"]
    client.post(f"/execution-assistant/plans/{plan_id}/validate")
    r = client.post(f"/execution-assistant/plans/{plan_id}/place-paper")
    assert r.status_code == 409
    assert r.json()["detail"]["error"] == "kill_switch_active"
    assert stub.place_paper_order_calls == 0


def test_place_paper_order_unknown_outcome_when_adapter_raises():
    """Critical promise: adapter failure returns unknown_outcome (not 500).

    unknown_outcome signals that the order may have reached TWS. The broker
    call count is 1 — the request was attempted, which is why the outcome
    is ambiguous rather than definitively rejected.
    """
    stub, client = _setup(sec_type="STK", connected=True, paper_port=True, raise_on_place=True)
    plan_id = client.post("/execution-assistant/plans/draft", json=_draft()).json()["plan_id"]
    client.post(f"/execution-assistant/plans/{plan_id}/validate")
    r = client.post(f"/execution-assistant/plans/{plan_id}/place-paper")
    assert r.status_code == 409
    assert r.json()["detail"]["error"] == "unknown_outcome"
    assert stub.place_paper_order_calls == 1  # attempted, not silently skipped


def test_place_paper_order_adapter_guard_not_collapsed_into_unknown_outcome():
    """Critical promise: TwsPlaceOrderGuardError routes to its specific code, not unknown_outcome.

    Simulates state change between the router's pre-call check and the adapter call
    (e.g. connection dropped after is_connected() returned True). The order was never
    sent, so the outcome is deterministic — must NOT be reported as ambiguous.
    """
    stub, client = _setup(
        sec_type="STK", connected=True, paper_port=True, guard_error_code="not_connected"
    )
    plan_id = client.post("/execution-assistant/plans/draft", json=_draft()).json()["plan_id"]
    client.post(f"/execution-assistant/plans/{plan_id}/validate")
    r = client.post(f"/execution-assistant/plans/{plan_id}/place-paper")
    assert r.status_code == 409
    assert r.json()["detail"]["error"] == "not_connected"   # specific, not unknown_outcome
    assert stub.place_paper_order_calls == 1                # guard fired inside adapter


# ── STP / STP LMT order type validation ──────────────────────────────────────

def test_stp_without_stop_price_is_rejected():
    client = _client(sec_type="STK")
    plan_id = client.post(
        "/execution-assistant/plans/draft",
        json=_draft(order_type="STP", limit_price=None, stop_price=None),
    ).json()["plan_id"]
    body = client.post(f"/execution-assistant/plans/{plan_id}/validate").json()
    assert body["status"] == "invalid"
    assert "positive stop price" in body["validation_errors"][0]


def test_stp_lmt_requires_stop_and_limit_prices():
    client = _client(sec_type="STK")
    plan_id = client.post(
        "/execution-assistant/plans/draft",
        json=_draft(order_type="STP LMT", limit_price=None, stop_price=175.0),
    ).json()["plan_id"]
    body = client.post(f"/execution-assistant/plans/{plan_id}/validate").json()
    assert body["status"] == "invalid"
    assert any("positive limit price" in e for e in body["validation_errors"])


def test_stp_lmt_preview_contains_stop_and_limit_prices():
    client = _client(sec_type="STK", connected=True, paper_port=True)
    plan_id = client.post(
        "/execution-assistant/plans/draft",
        json=_draft(order_type="STP LMT", limit_price=181.0, stop_price=180.0),
    ).json()["plan_id"]
    client.post(f"/execution-assistant/plans/{plan_id}/validate")
    body = client.post(f"/execution-assistant/plans/{plan_id}/preview-paper").json()
    assert body["order_type"] == "STP LMT"
    assert body["stop_price"] == 180.0
    assert body["limit_price"] == 181.0


# ── Cancel / Modify order endpoints ──────────────────────────────────────────

def test_cancel_order_calls_broker_once_on_paper_port():
    stub, client = _setup(sec_type="STK", connected=True, paper_port=True)
    r = client.delete("/execution-assistant/orders/9001")
    assert r.status_code == 200
    assert r.json()["action"] == "cancel"
    assert stub.cancel_order_calls == 1


def test_cancel_on_live_port_blocked_by_unarmed_live_policy():
    """Critical promise: cancel on a live port is blocked by the unarmed live policy, not the broker."""
    stub, client = _setup(sec_type="STK", connected=True, paper_port=False)
    r = client.delete("/execution-assistant/orders/9001")
    assert r.status_code == 403
    assert r.json()["detail"]["error"] == "live_session_not_allowlisted"
    assert stub.cancel_order_calls == 0


def test_modify_order_calls_broker_once_on_paper_port():
    stub, client = _setup(sec_type="STK", connected=True, paper_port=True)
    r = client.patch(
        "/execution-assistant/orders/9001",
        json={"quantity": 5.0, "limit_price": 182.0, "stop_price": None},
    )
    assert r.status_code == 200
    assert r.json()["action"] == "modify"
    assert stub.modify_order_calls == 1


def test_modify_on_live_port_blocked_by_unarmed_live_policy():
    """Critical promise: modify on a live port is blocked by the unarmed live policy, not the broker."""
    stub, client = _setup(sec_type="STK", connected=True, paper_port=False)
    r = client.patch(
        "/execution-assistant/orders/9001",
        json={"quantity": 5.0, "limit_price": 182.0, "stop_price": None},
    )
    assert r.status_code == 403
    assert r.json()["detail"]["error"] == "live_session_not_allowlisted"
    assert stub.modify_order_calls == 0


# ── Advanced reject / override ────────────────────────────────────────────────

def test_advanced_reject_returns_override_payload_without_resubmitting():
    """Critical promise: TWS advanced reject surfaces as typed 409 — broker was NOT called twice."""
    stub, client = _setup(sec_type="STK", connected=True, paper_port=True, raise_advanced_reject=True)
    plan_id = client.post("/execution-assistant/plans/draft", json=_draft()).json()["plan_id"]
    client.post(f"/execution-assistant/plans/{plan_id}/validate")
    r = client.post(f"/execution-assistant/plans/{plan_id}/place-paper")
    assert r.status_code == 409
    body = r.json()
    assert body["detail"]["error"] == "advanced_reject"
    assert "reject" in body["detail"]
    assert "reason" in body["detail"]["reject"]
    assert stub.place_paper_order_calls == 1  # attempted exactly once, never auto-resubmitted
