# TWS Live Trading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable TWS live place, cancel, and modify only after an explicit allowlisted session arm.

**Architecture:** Add a small process-local `TwsLivePolicyService` that owns live allowlist and arm state. Keep broker mutation code behind `TwsBrokerAdapter`; routers enforce policy before calling the adapter, and the adapter rechecks the same policy immediately before `placeOrder`, `cancelOrder`, or modify-through-`placeOrder`. Frontend mirrors the new policy contract in `src/modules/tws-execution-assistant/api.ts` and adds a compact live policy panel to the existing cockpit.

**Tech Stack:** FastAPI, Pydantic, `ib_async` behind `TwsBrokerAdapter`, React 19, TypeScript, TanStack Query.

## Global Constraints

- Orbit remains decision support, never autonomous trading.
- All broker access stays behind FastAPI and `TwsBrokerAdapter`.
- `ib_async` types must not leak into routers, frontend contracts, database models, or module UI.
- TWS remains an exclusive broker session mode; Client Portal mutation modules stay gated while TWS is active.
- Unknown account, unknown port, stale live arm, kill switch, disconnected adapter, or rejected policy fails closed.
- Live arming requires an explicit local allowlist of live ports/accounts.
- Live arming is session-level only.
- A live arm lasts until TWS disconnect, app close/backend restart, or account change.
- Live arm covers place, cancel, and modify.
- Backend rechecks allowlist and armed state immediately before forwarding every live mutation to TWS.
- Advanced rejects and ambiguous outcomes remain visible for live operations.
- Follow `docs/testing.md`: default to zero new tests unless a changed behavior threatens an uncovered critical promise; add at most one public-boundary test per critical promise per slice.

---

## File Map

- Create `backend/services/tws_live_policy.py`: process-local allowlist + arm state, no SQLite.
- Modify `backend/models/tws_execution_assistant.py`: live policy request/response models and shared order submission naming.
- Modify `backend/deps.py`: `get_tws_live_policy`.
- Modify `backend/main.py`: instantiate `TwsLivePolicyService`.
- Modify `backend/routers/execution_assistant.py`: live policy endpoints, live preview/place endpoints, and policy-aware cancel/modify/override calls.
- Modify `backend/services/tws_broker_adapter.py`: expose connected endpoint/account context and recheck live policy inside live mutation methods.
- Modify `backend/tests/test_execution_assistant_live_policy.py`: public-boundary fail-closed and success checks for live policy.
- Modify `src/modules/tws-execution-assistant/api.ts`: TypeScript models and API calls.
- Modify `src/modules/tws-execution-assistant/TwsExecutionAssistantModule.tsx`: live arm panel, route paper/live order review, live labels and errors.

## Interfaces

Backend models to add:

```python
class TwsLiveAllowlistRequest(BaseModel):
    account_id: str
    host: str = "127.0.0.1"
    port: int

class TwsLiveArmRequest(BaseModel):
    account_id: str
    host: str = "127.0.0.1"
    port: int

class TwsLivePolicyStatus(BaseModel):
    connected_account_id: str | None = None
    connected_host: str = "127.0.0.1"
    connected_port: int | None = None
    is_paper_port: bool = False
    allowlisted: bool = False
    armed: bool = False
    arm_expires_on: list[str] = ["disconnect", "app_restart", "account_change"]
```

Policy service public methods:

```python
class TwsLivePolicyService:
    def status(self, *, account_id: str | None, host: str, port: int | None, is_connected: bool, is_paper_port: bool) -> TwsLivePolicyStatus: ...
    def allow(self, req: TwsLiveAllowlistRequest) -> TwsLivePolicyStatus: ...
    def arm(self, req: TwsLiveArmRequest, *, account_id: str | None, host: str, port: int | None, is_connected: bool, is_paper_port: bool) -> TwsLivePolicyStatus: ...
    def disarm(self) -> None: ...
    def assert_live_allowed(self, *, account_id: str | None, host: str, port: int | None, is_connected: bool, is_paper_port: bool) -> None: ...
```

Adapter methods to add or rename:

```python
def connected_account_id(self) -> str | None: ...
def connected_host(self) -> str: ...
def connected_port(self) -> int | None: ...
async def place_order(self, plan: ExecutionPlan, *, mode: Literal["paper", "live"], live_policy: TwsLivePolicyService | None = None, advanced_override: list[str] | None = None) -> PaperOrderSubmission: ...
def cancel_order(self, order_id: int, *, mode: Literal["paper", "live"], live_policy: TwsLivePolicyService | None = None) -> TwsOrderActionResult: ...
async def modify_order(self, order_id: int, req: TwsModifyOrderRequest, *, mode: Literal["paper", "live"], live_policy: TwsLivePolicyService | None = None, advanced_override: list[str] | None = None) -> TwsOrderActionResult: ...
```

The response class may stay named `PaperOrderSubmission` for compatibility in Task 2, but frontend-facing copy must use live/paper labels. Rename to `TwsOrderSubmission` only if it stays mechanical and does not widen scope.

---

### Task 1: Live Policy Contract And Fail-Closed Service

**Files:**
- Create: `backend/services/tws_live_policy.py`
- Modify: `backend/models/tws_execution_assistant.py`
- Modify: `backend/deps.py`
- Modify: `backend/main.py`
- Test: `backend/tests/test_execution_assistant_live_policy.py`

**Interfaces:**
- Consumes: current `TwsBrokerAdapter.is_connected()`, `is_paper_port()`.
- Produces: `TwsLivePolicyService`, `TwsLivePolicyStatus`, `POST /execution-assistant/live/allow`, `POST /execution-assistant/live/arm`, `POST /execution-assistant/live/disarm`, `GET /execution-assistant/live/status`.

- [ ] **Step 1: Add the public-boundary test**

Create `backend/tests/test_execution_assistant_live_policy.py`:

```python
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
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
cd backend && uv run python -m pytest tests/test_execution_assistant_live_policy.py -q
```

Expected: FAIL on missing `get_tws_live_policy` / `TwsLivePolicyService` / endpoints.

- [ ] **Step 3: Add models**

In `backend/models/tws_execution_assistant.py`, after `TwsConnectRequest`, add:

```python
class TwsLiveAllowlistRequest(BaseModel):
    account_id: str
    host: str = "127.0.0.1"
    port: int


class TwsLiveArmRequest(BaseModel):
    account_id: str
    host: str = "127.0.0.1"
    port: int


class TwsLivePolicyStatus(BaseModel):
    connected_account_id: str | None = None
    connected_host: str = "127.0.0.1"
    connected_port: int | None = None
    is_paper_port: bool = False
    allowlisted: bool = False
    armed: bool = False
    arm_expires_on: list[str] = ["disconnect", "app_restart", "account_change"]
```

- [ ] **Step 4: Add policy service**

Create `backend/services/tws_live_policy.py`:

```python
from __future__ import annotations

from dataclasses import dataclass

from models.tws_execution_assistant import (
    TwsLiveAllowlistRequest,
    TwsLiveArmRequest,
    TwsLivePolicyStatus,
)
from services.tws_broker_adapter import TwsPlaceOrderGuardError


@dataclass(frozen=True)
class _LiveKey:
    account_id: str
    host: str
    port: int


class TwsLivePolicyService:
    """Process-local live trading allowlist and arm state."""

    def __init__(self) -> None:
        self._allowlist: set[_LiveKey] = set()
        self._armed: _LiveKey | None = None

    def _key(self, account_id: str, host: str, port: int) -> _LiveKey:
        return _LiveKey(account_id=account_id.strip(), host=host.strip() or "127.0.0.1", port=port)

    def _current_key(self, *, account_id: str | None, host: str, port: int | None) -> _LiveKey | None:
        if not account_id or port is None:
            return None
        return self._key(account_id, host, port)

    def status(
        self,
        *,
        account_id: str | None,
        host: str,
        port: int | None,
        is_connected: bool,
        is_paper_port: bool,
    ) -> TwsLivePolicyStatus:
        current = self._current_key(account_id=account_id, host=host, port=port)
        if not is_connected or current != self._armed:
            self._armed = None
        return TwsLivePolicyStatus(
            connected_account_id=account_id,
            connected_host=host,
            connected_port=port,
            is_paper_port=is_paper_port,
            allowlisted=current in self._allowlist if current else False,
            armed=current == self._armed if current else False,
        )

    def allow(self, req: TwsLiveAllowlistRequest) -> None:
        self._allowlist.add(self._key(req.account_id, req.host, req.port))

    def arm(
        self,
        req: TwsLiveArmRequest,
        *,
        account_id: str | None,
        host: str,
        port: int | None,
        is_connected: bool,
        is_paper_port: bool,
    ) -> None:
        if not is_connected:
            raise TwsPlaceOrderGuardError("not_connected")
        if is_paper_port:
            raise TwsPlaceOrderGuardError("paper_port_cannot_arm_live")
        current = self._current_key(account_id=account_id, host=host, port=port)
        requested = self._key(req.account_id, req.host, req.port)
        if current is None or requested != current:
            raise TwsPlaceOrderGuardError("live_session_mismatch")
        if current not in self._allowlist:
            raise TwsPlaceOrderGuardError("live_session_not_allowlisted")
        self._armed = current

    def disarm(self) -> None:
        self._armed = None

    def assert_live_allowed(
        self,
        *,
        account_id: str | None,
        host: str,
        port: int | None,
        is_connected: bool,
        is_paper_port: bool,
    ) -> None:
        status = self.status(
            account_id=account_id,
            host=host,
            port=port,
            is_connected=is_connected,
            is_paper_port=is_paper_port,
        )
        if not is_connected:
            raise TwsPlaceOrderGuardError("not_connected")
        if is_paper_port:
            raise TwsPlaceOrderGuardError("paper_port_cannot_live_trade")
        if not status.allowlisted:
            raise TwsPlaceOrderGuardError("live_session_not_allowlisted")
        if not status.armed:
            raise TwsPlaceOrderGuardError("live_session_not_armed")
```

- [ ] **Step 5: Wire dependency and lifespan**

In `backend/deps.py`, import and expose:

```python
from services.tws_live_policy import TwsLivePolicyService


def get_tws_live_policy(request: Request) -> TwsLivePolicyService:
    return request.app.state.tws_live_policy
```

In `backend/main.py`, after `app.state.tws_adapter = tws_adapter`, add:

```python
app.state.tws_live_policy = TwsLivePolicyService()
```

Also import `TwsLivePolicyService` near the other service imports.

- [ ] **Step 6: Add router endpoints and guard status mapping**

In `backend/routers/execution_assistant.py`, import `get_tws_live_policy`, `TwsLiveAllowlistRequest`, `TwsLiveArmRequest`, `TwsLivePolicyStatus`, and `TwsLivePolicyService`.

Extend `_GUARD_STATUS`:

```python
"paper_port_cannot_arm_live": status.HTTP_403_FORBIDDEN,
"paper_port_cannot_live_trade": status.HTTP_403_FORBIDDEN,
"live_session_mismatch": status.HTTP_409_CONFLICT,
"live_session_not_allowlisted": status.HTTP_403_FORBIDDEN,
"live_session_not_armed": status.HTTP_403_FORBIDDEN,
```

Add helper:

```python
def _live_status(adapter: TwsBrokerAdapter, policy: TwsLivePolicyService) -> TwsLivePolicyStatus:
    return policy.status(
        account_id=adapter.connected_account_id(),
        host=adapter.connected_host(),
        port=adapter.connected_port(),
        is_connected=adapter.is_connected(),
        is_paper_port=adapter.is_paper_port(),
    )
```

Add endpoints after `/reconciliation`:

```python
@router.get("/live/status", response_model=TwsLivePolicyStatus)
async def get_live_status(
    adapter: TwsBrokerAdapter = Depends(get_tws_adapter),
    policy: TwsLivePolicyService = Depends(get_tws_live_policy),
) -> TwsLivePolicyStatus:
    return _live_status(adapter, policy)


@router.post("/live/allow", response_model=TwsLivePolicyStatus)
async def allow_live_session(
    req: TwsLiveAllowlistRequest,
    adapter: TwsBrokerAdapter = Depends(get_tws_adapter),
    policy: TwsLivePolicyService = Depends(get_tws_live_policy),
) -> TwsLivePolicyStatus:
    policy.allow(req)
    return _live_status(adapter, policy)


@router.post("/live/arm", response_model=TwsLivePolicyStatus)
async def arm_live_session(
    req: TwsLiveArmRequest,
    adapter: TwsBrokerAdapter = Depends(get_tws_adapter),
    policy: TwsLivePolicyService = Depends(get_tws_live_policy),
) -> TwsLivePolicyStatus:
    try:
        policy.arm(
            req,
            account_id=adapter.connected_account_id(),
            host=adapter.connected_host(),
            port=adapter.connected_port(),
            is_connected=adapter.is_connected(),
            is_paper_port=adapter.is_paper_port(),
        )
    except TwsPlaceOrderGuardError as exc:
        raise _guard_http_error(exc)
    return _live_status(adapter, policy)


@router.post("/live/disarm", response_model=TwsLivePolicyStatus)
async def disarm_live_session(
    adapter: TwsBrokerAdapter = Depends(get_tws_adapter),
    policy: TwsLivePolicyService = Depends(get_tws_live_policy),
) -> TwsLivePolicyStatus:
    policy.disarm()
    return _live_status(adapter, policy)
```

- [ ] **Step 7: Add minimal adapter context methods**

In `backend/services/tws_broker_adapter.py`, add methods:

```python
def connected_host(self) -> str:
    return self._last_host

def connected_port(self) -> int | None:
    return self._connected_port

def connected_account_id(self) -> str | None:
    if not self.is_connected():
        return None
    accounts = self._ib.managedAccounts()
    return accounts[0] if accounts else None
```

- [ ] **Step 8: Run focused test**

Run:

```bash
cd backend && uv run python -m pytest tests/test_execution_assistant_live_policy.py -q
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/models/tws_execution_assistant.py backend/services/tws_live_policy.py backend/deps.py backend/main.py backend/routers/execution_assistant.py backend/services/tws_broker_adapter.py backend/tests/test_execution_assistant_live_policy.py
git commit -m "feat: add tws live policy gate"
```

---

### Task 2: Live Place Path

**Files:**
- Modify: `backend/routers/execution_assistant.py`
- Modify: `backend/services/tws_broker_adapter.py`
- Modify: `backend/models/tws_execution_assistant.py` if renaming submission model is chosen
- Test: `backend/tests/test_execution_assistant_live_policy.py`

**Interfaces:**
- Consumes: `TwsLivePolicyService.assert_live_allowed(...)`.
- Produces: `POST /execution-assistant/plans/{plan_id}/preview-live` and `POST /execution-assistant/plans/{plan_id}/place-live`.

- [ ] **Step 1: Add failing live-place test**

Append to `backend/tests/test_execution_assistant_live_policy.py`:

```python
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
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
cd backend && uv run python -m pytest tests/test_execution_assistant_live_policy.py -q
```

Expected: FAIL because `/place-live` does not exist.

- [ ] **Step 3: Add live preview endpoint**

In `backend/routers/execution_assistant.py`, add:

```python
@router.post("/plans/{plan_id}/preview-live", response_model=PaperOrderPreview)
async def preview_live_order(
    plan_id: str,
    svc: ExecutionPlanService = Depends(get_execution_plan_service),
    adapter: TwsBrokerAdapter = Depends(get_tws_adapter),
    policy: TwsLivePolicyService = Depends(get_tws_live_policy),
) -> PaperOrderPreview:
    try:
        policy.assert_live_allowed(
            account_id=adapter.connected_account_id(),
            host=adapter.connected_host(),
            port=adapter.connected_port(),
            is_connected=adapter.is_connected(),
            is_paper_port=adapter.is_paper_port(),
        )
    except TwsPlaceOrderGuardError as exc:
        raise _guard_http_error(exc)
    plan = svc.get(plan_id)
    if plan is None:
        raise HTTPException(status_code=404, detail={"error": "plan_not_found", "plan_id": plan_id})
    if plan.status != "valid":
        raise HTTPException(status_code=422, detail={"error": "plan_not_valid", "status": plan.status})
    preview = svc.preview_paper(plan)
    return preview.model_copy(update={"paper_only": False})
```

- [ ] **Step 4: Refactor adapter place method**

In `backend/services/tws_broker_adapter.py`, replace `place_paper_order` with `place_order` and keep a compatibility wrapper:

```python
async def place_order(
    self,
    plan: "ExecutionPlan",
    *,
    mode: str,
    live_policy: object | None = None,
    advanced_override: list[str] | None = None,
) -> PaperOrderSubmission:
    if self._kill_switch_active:
        raise TwsPlaceOrderGuardError("kill_switch_active")
    if not self.is_connected():
        raise TwsPlaceOrderGuardError("not_connected")
    if mode == "paper":
        if not self.is_paper_port():
            raise TwsPlaceOrderGuardError("not_paper_port")
    elif mode == "live":
        if live_policy is None:
            raise TwsPlaceOrderGuardError("live_session_not_armed")
        live_policy.assert_live_allowed(
            account_id=self.connected_account_id(),
            host=self.connected_host(),
            port=self.connected_port(),
            is_connected=self.is_connected(),
            is_paper_port=self.is_paper_port(),
        )
    else:
        raise TwsPlaceOrderGuardError("unsupported_execution_mode")
    if plan.status != "valid":
        raise TwsPlaceOrderGuardError("plan_not_valid")

    # keep existing contract/order construction and advanced reject handling body
```

At the end of the class, add:

```python
async def place_paper_order(self, plan: "ExecutionPlan", advanced_override: list[str] | None = None) -> PaperOrderSubmission:
    return await self.place_order(plan, mode="paper", advanced_override=advanced_override)
```

- [ ] **Step 5: Add live place endpoint**

In `backend/routers/execution_assistant.py`, add:

```python
@router.post("/plans/{plan_id}/place-live", response_model=PaperOrderSubmission)
async def place_live_order(
    plan_id: str,
    svc: ExecutionPlanService = Depends(get_execution_plan_service),
    adapter: TwsBrokerAdapter = Depends(get_tws_adapter),
    policy: TwsLivePolicyService = Depends(get_tws_live_policy),
) -> PaperOrderSubmission:
    try:
        policy.assert_live_allowed(
            account_id=adapter.connected_account_id(),
            host=adapter.connected_host(),
            port=adapter.connected_port(),
            is_connected=adapter.is_connected(),
            is_paper_port=adapter.is_paper_port(),
        )
    except TwsPlaceOrderGuardError as exc:
        raise _guard_http_error(exc)
    plan = svc.get(plan_id)
    if plan is None:
        raise HTTPException(status_code=404, detail={"error": "plan_not_found", "plan_id": plan_id})
    if plan.status != "valid":
        raise HTTPException(status_code=422, detail={"error": "plan_not_valid", "status": plan.status})
    try:
        return await adapter.place_order(plan, mode="live", live_policy=policy)
    except TwsPlaceOrderGuardError as exc:
        raise _guard_http_error(exc)
    except TwsAdvancedRejectError as exc:
        raise HTTPException(status_code=409, detail={"error": "advanced_reject", "reject": exc.reject.model_dump()})
    except (RuntimeError, OSError, ConnectionError, TimeoutError) as exc:
        log.error("Live order placement failed for plan %s: %s", plan_id, exc)
        raise HTTPException(
            status_code=409,
            detail={
                "error": "unknown_outcome",
                "message": "Live order placement failed unexpectedly. Check TWS Open Orders before retrying.",
            },
        )
```

- [ ] **Step 6: Run focused test**

Run:

```bash
cd backend && uv run python -m pytest tests/test_execution_assistant_live_policy.py -q
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/routers/execution_assistant.py backend/services/tws_broker_adapter.py backend/tests/test_execution_assistant_live_policy.py
git commit -m "feat: add tws live place route"
```

---

### Task 3: Live Cancel, Modify, And Override

**Files:**
- Modify: `backend/routers/execution_assistant.py`
- Modify: `backend/services/tws_broker_adapter.py`
- Test: `backend/tests/test_execution_assistant_live_policy.py`

**Interfaces:**
- Consumes: `mode: "paper" | "live"` on adapter cancel/modify.
- Produces: route behavior where paper ports keep existing paper cancel/modify and live ports require armed live policy.

- [ ] **Step 1: Add failing cancel/modify policy tests**

Append:

```python
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
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
cd backend && uv run python -m pytest tests/test_execution_assistant_live_policy.py -q
```

Expected: FAIL because router still calls paper-only adapter methods without live policy routing.

- [ ] **Step 3: Add adapter mode checks for cancel/modify**

Replace `_ensure_paper_order_mutation_allowed` with:

```python
def _ensure_order_mutation_allowed(self, *, mode: str, live_policy: object | None = None) -> None:
    if self._kill_switch_active:
        raise TwsPlaceOrderGuardError("kill_switch_active")
    if not self.is_connected():
        raise TwsPlaceOrderGuardError("not_connected")
    if mode == "paper":
        if not self.is_paper_port():
            raise TwsPlaceOrderGuardError("not_paper_port")
        return
    if mode == "live":
        if live_policy is None:
            raise TwsPlaceOrderGuardError("live_session_not_armed")
        live_policy.assert_live_allowed(
            account_id=self.connected_account_id(),
            host=self.connected_host(),
            port=self.connected_port(),
            is_connected=self.is_connected(),
            is_paper_port=self.is_paper_port(),
        )
        return
    raise TwsPlaceOrderGuardError("unsupported_execution_mode")
```

Update signatures:

```python
def cancel_order(self, order_id: int, *, mode: str = "paper", live_policy: object | None = None) -> TwsOrderActionResult:
    self._ensure_order_mutation_allowed(mode=mode, live_policy=live_policy)
    ...

async def modify_order(self, order_id: int, req: TwsModifyOrderRequest, *, mode: str = "paper", live_policy: object | None = None, advanced_override: list[str] | None = None) -> TwsOrderActionResult:
    self._ensure_order_mutation_allowed(mode=mode, live_policy=live_policy)
    ...
```

- [ ] **Step 4: Route cancel/modify by connected port**

In `backend/routers/execution_assistant.py`, inject policy into `cancel_order` and `modify_order`. Before adapter call:

```python
mode = "paper" if adapter.is_paper_port() else "live"
if mode == "live":
    try:
        policy.assert_live_allowed(
            account_id=adapter.connected_account_id(),
            host=adapter.connected_host(),
            port=adapter.connected_port(),
            is_connected=adapter.is_connected(),
            is_paper_port=adapter.is_paper_port(),
        )
    except TwsPlaceOrderGuardError as exc:
        raise _guard_http_error(exc)
```

Then call:

```python
return adapter.cancel_order(order_id, mode=mode, live_policy=policy if mode == "live" else None)
return await adapter.modify_order(order_id, req, mode=mode, live_policy=policy if mode == "live" else None)
```

- [ ] **Step 5: Update override live routing**

For `req.intent == "place"`, route to `adapter.place_order(plan, mode=mode, live_policy=...)`.

For modify override, route to:

```python
return await adapter.modify_order(
    req.order_id,
    req.modify,
    mode=mode,
    live_policy=policy if mode == "live" else None,
    advanced_override=codes,
)
```

Use the same `mode = "paper" if adapter.is_paper_port() else "live"` and policy precheck.

- [ ] **Step 6: Run focused test**

Run:

```bash
cd backend && uv run python -m pytest tests/test_execution_assistant_live_policy.py -q
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/routers/execution_assistant.py backend/services/tws_broker_adapter.py backend/tests/test_execution_assistant_live_policy.py
git commit -m "feat: gate tws live order actions"
```

---

### Task 4: Cockpit Live Policy UX

**Files:**
- Modify: `src/modules/tws-execution-assistant/api.ts`
- Modify: `src/modules/tws-execution-assistant/TwsExecutionAssistantModule.tsx`

**Interfaces:**
- Consumes: `/execution-assistant/live/status`, `/live/allow`, `/live/arm`, `/live/disarm`, `/preview-live`, `/place-live`.
- Produces: cockpit can show allowlist/arm state and route review/place to paper or live endpoint.

- [ ] **Step 1: Add TypeScript contract**

In `api.ts`, add:

```ts
export interface TwsLivePolicyStatus {
  connected_account_id: string | null;
  connected_host: string;
  connected_port: number | null;
  is_paper_port: boolean;
  allowlisted: boolean;
  armed: boolean;
  arm_expires_on: string[];
}

export interface TwsLiveAllowlistRequest {
  account_id: string;
  host: string;
  port: number;
}

export type TwsLiveArmRequest = TwsLiveAllowlistRequest;
```

Also change the existing `PaperOrderPreview` interface in `api.ts`:

```ts
export interface PaperOrderPreview {
  plan_id: string;
  conid: number;
  symbol: string;
  side: ExecutionPlanSide;
  quantity: number;
  order_type: ExecutionPlanOrderType;
  limit_price: number | null;
  stop_price: number | null;
  tif: string;
  transmit: boolean;
  paper_only: boolean;
}
```

Add API methods:

```ts
getLiveStatus: () =>
  sidecarRequest<TwsLivePolicyStatus>("GET", "/execution-assistant/live/status"),
allowLive: (req: TwsLiveAllowlistRequest) =>
  sidecarRequest<TwsLivePolicyStatus>("POST", "/execution-assistant/live/allow", req),
armLive: (req: TwsLiveArmRequest) =>
  sidecarRequest<TwsLivePolicyStatus>("POST", "/execution-assistant/live/arm", req),
disarmLive: () =>
  sidecarRequest<TwsLivePolicyStatus>("POST", "/execution-assistant/live/disarm"),
previewLiveOrder: (plan_id: string) =>
  sidecarRequest<PaperOrderPreview>("POST", `/execution-assistant/plans/${plan_id}/preview-live`),
placeLiveOrder: (plan_id: string) =>
  sidecarRequest<PaperOrderSubmission>("POST", `/execution-assistant/plans/${plan_id}/place-live`),
```

- [ ] **Step 2: Add live policy query and mutations**

In `TwsExecutionAssistantModule.tsx`, add:

```ts
const LIVE_STATUS_KEY = ["tws-live-status"];
```

Inside component:

```ts
const { data: livePolicy } = useQuery({
  queryKey: LIVE_STATUS_KEY,
  queryFn: twsApi.getLiveStatus,
  refetchInterval: 5000,
  enabled: status?.connected === true,
});

const isLiveSession = status?.connected === true && livePolicy?.is_paper_port === false;
const liveRequest = livePolicy?.connected_account_id && livePolicy.connected_port != null
  ? { account_id: livePolicy.connected_account_id, host: livePolicy.connected_host, port: livePolicy.connected_port }
  : null;

const allowLiveMutation = useMutation({
  mutationFn: twsApi.allowLive,
  onSuccess: (result) => queryClient.setQueryData(LIVE_STATUS_KEY, result),
});

const armLiveMutation = useMutation({
  mutationFn: twsApi.armLive,
  onSuccess: (result) => queryClient.setQueryData(LIVE_STATUS_KEY, result),
});

const disarmLiveMutation = useMutation({
  mutationFn: twsApi.disarmLive,
  onSuccess: (result) => queryClient.setQueryData(LIVE_STATUS_KEY, result),
});
```

- [ ] **Step 3: Route review/place by session type**

Change `reviewMutation`:

```ts
const preview = isLiveSession
  ? await twsApi.previewLiveOrder(plan.plan_id)
  : await twsApi.previewPaperOrder(plan.plan_id);
```

Rename `placePaperMutation` to `placeOrderMutation` and use:

```ts
mutationFn: (plan_id: string) =>
  isLiveSession ? twsApi.placeLiveOrder(plan_id) : twsApi.placePaperOrder(plan_id),
```

Then mechanically update references from `placePaperMutation` to `placeOrderMutation`.

- [ ] **Step 4: Add live policy panel**

In the connected status band after the `TWS only` pill, add compact controls:

```tsx
{isLiveSession && liveRequest && (
  <div className="flex items-center gap-2 border-l border-border px-4 py-2.5">
    <span className={cn(
      "rounded-full px-2 py-0.5 text-[10px] font-semibold",
      livePolicy?.armed
        ? "border border-[var(--clr-red)]/40 bg-[var(--clr-red)]/10 text-[var(--clr-red)]"
        : "border border-[var(--clr-orange)]/40 bg-[var(--glow-orange)] text-[var(--clr-orange)]",
    )}>
      {livePolicy?.armed ? "LIVE ARMED" : "LIVE LOCKED"}
    </span>
    {!livePolicy?.allowlisted ? (
      <button
        type="button"
        className="h-6 rounded border border-[var(--clr-orange)]/50 px-2 text-[10px] font-semibold text-[var(--clr-orange)] hover:bg-[var(--clr-orange)]/10 disabled:opacity-50"
        disabled={allowLiveMutation.isPending}
        onClick={() => allowLiveMutation.mutate(liveRequest)}
      >
        Allow account
      </button>
    ) : !livePolicy.armed ? (
      <button
        type="button"
        className="h-6 rounded border border-[var(--clr-red)]/50 px-2 text-[10px] font-semibold text-[var(--clr-red)] hover:bg-[var(--clr-red)]/10 disabled:opacity-50"
        disabled={armLiveMutation.isPending}
        onClick={() => armLiveMutation.mutate(liveRequest)}
      >
        Arm live
      </button>
    ) : (
      <button
        type="button"
        className="h-6 rounded border border-border px-2 text-[10px] text-[var(--text-2)] hover:bg-[var(--bg-0)]"
        disabled={disarmLiveMutation.isPending}
        onClick={() => disarmLiveMutation.mutate()}
      >
        Disarm
      </button>
    )}
  </div>
)}
```

- [ ] **Step 5: Update live/paper copy**

Change the review safety notice:

```tsx
<p className={cn("text-xs font-semibold", isLiveSession ? "text-[var(--clr-red)]" : "text-[var(--clr-green)]")}>
  {isLiveSession ? "This is a LIVE order." : "This is a PAPER order only."}
</p>
<p className="mt-0.5 text-xs text-[var(--text-2)]">
  {isLiveSession
    ? "It will be routed to the armed live TWS account."
    : "It will be routed to your TWS paper account and will not impact live trading."}
</p>
```

Change the submit button text:

```tsx
{placeOrderMutation.isPending ? "Placing order..." : isLiveSession ? "Place LIVE order" : "Place order"}
```

Change generic rejection copy to:

```ts
const msg = SUBMIT_ERROR_MESSAGES[code ?? ""] ??
  (isLiveSession
    ? "Live order rejected — check that TWS is connected and live trading is armed."
    : "Order rejected — check that TWS is connected and on a paper port.");
```

- [ ] **Step 6: Run frontend typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/modules/tws-execution-assistant/api.ts src/modules/tws-execution-assistant/TwsExecutionAssistantModule.tsx
git commit -m "feat: add tws live trading controls"
```

---

### Task 5: Manual Live Smoke Gate And Roadmap Update

**Files:**
- Modify: `PROJECT_PLAN.md`

**Interfaces:**
- Consumes: implemented live place/cancel/modify.
- Produces: documented verification boundary; no automatic merge approval.

- [ ] **Step 1: Run backend focused tests**

Run:

```bash
cd backend && uv run python -m pytest tests/test_execution_assistant_live_policy.py -q
```

Expected: PASS.

- [ ] **Step 2: Run frontend typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run manual live smoke only with human present**

Manual script:

```text
1. Connect to a real live TWS / IB Gateway session using the approved live account and port.
2. Confirm the cockpit shows LIVE LOCKED.
3. Click Allow account.
4. Click Arm live.
5. Draft the smallest safe live LMT order the human approves.
6. Place the live order.
7. Confirm the order appears in TWS Open Orders.
8. Modify the limit price by a human-approved small amount.
9. Confirm TWS reflects the modification.
10. Cancel the order.
11. Confirm TWS no longer shows the order as working.
12. Disconnect and confirm live arm clears.
```

Expected: live place/cancel/modify work only while armed; disconnect clears arm.

- [ ] **Step 4: Update `PROJECT_PLAN.md`**

Replace the active TWS follow-up line with:

```markdown
- **TWS follow-up missions (design branch `feature/tws-live-advanced-market-data-design`):** parent decision-locking spec approved in `docs/superpowers/specs/2026-06-29-tws-live-advanced-market-data-design.md`. Live trading execution plan is implemented/under review in `docs/superpowers/plans/2026-06-29-tws-live-trading.md`: live place/cancel/modify require explicit allowlisted session arming, backend policy rechecks, and visible ambiguous-outcome handling. Remaining missions: advanced order types, then market-data extras.
```

If live smoke is blocked, write:

```markdown
Live trading execution plan is code-complete but manual live smoke is blocked: <exact blocker>.
```

- [ ] **Step 5: Commit**

```bash
git add PROJECT_PLAN.md
git commit -m "docs: update tws live trading status"
```

## Self-Review

- Spec coverage: Mission 1 live place/cancel/modify, allowlist, session arm, expiration triggers, backend rechecks, advanced rejects, and ambiguous outcomes are covered by Tasks 1-5.
- Placeholder scan: no placeholder tokens are intentional in this plan.
- Type consistency: backend uses `TwsLivePolicyStatus`, `TwsLiveAllowlistRequest`, `TwsLiveArmRequest`; frontend mirrors those names.
- Scope check: advanced order types and market-data websocket work are intentionally excluded; they get separate mission plans after live trading.
