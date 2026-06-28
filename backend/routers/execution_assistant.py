import logging

from fastapi import APIRouter, Depends, HTTPException, status

log = logging.getLogger(__name__)

from deps import get_broker_session, get_execution_plan_service, get_tws_adapter
from models.execution_plan import ExecutionPlan, ExecutionPlanDraftRequest
from models.tws_execution_assistant import (
    InstrumentResult,
    PaperOrderPreview,
    PaperOrderSubmission,
    QuoteSnapshot,
    ReconciliationSnapshot,
    TwsConnectRequest,
    TwsStatusResponse,
)
from services.broker_session import BrokerSessionService
from services.execution_plan import ExecutionPlanService
from services.tws_broker_adapter import TwsBrokerAdapter, TwsPlaceOrderGuardError

router = APIRouter(prefix="/execution-assistant", tags=["execution-assistant"])


@router.get("/status", response_model=TwsStatusResponse)
async def get_status(
    adapter: TwsBrokerAdapter = Depends(get_tws_adapter),
    session: BrokerSessionService = Depends(get_broker_session),
) -> TwsStatusResponse:
    available = await adapter.check_api_server()
    return adapter.get_status(session.current_mode(), available)


@router.post("/connect", response_model=TwsStatusResponse)
async def connect(
    request: TwsConnectRequest,
    adapter: TwsBrokerAdapter = Depends(get_tws_adapter),
    session: BrokerSessionService = Depends(get_broker_session),
) -> TwsStatusResponse:
    await adapter.connect(request.host, request.port, request.client_id)
    available = await adapter.check_api_server()
    return adapter.get_status(session.current_mode(), available)


@router.post("/disconnect", response_model=TwsStatusResponse)
async def disconnect(
    adapter: TwsBrokerAdapter = Depends(get_tws_adapter),
    session: BrokerSessionService = Depends(get_broker_session),
) -> TwsStatusResponse:
    await adapter.disconnect()
    available = await adapter.check_api_server()
    return adapter.get_status(session.current_mode(), available)


@router.get("/reconciliation", response_model=ReconciliationSnapshot)
async def get_reconciliation(
    adapter: TwsBrokerAdapter = Depends(get_tws_adapter),
) -> ReconciliationSnapshot:
    return adapter.get_reconciliation()


# ── Instrument search + quote ────────────────────────────────────────────────

@router.get("/instruments/search", response_model=list[InstrumentResult])
async def search_instruments(
    symbol: str,
    adapter: TwsBrokerAdapter = Depends(get_tws_adapter),
) -> list[InstrumentResult]:
    return await adapter.search_instruments(symbol.upper().strip())


@router.get("/instruments/{conid}/quote", response_model=QuoteSnapshot)
async def get_quote(
    conid: int,
    adapter: TwsBrokerAdapter = Depends(get_tws_adapter),
) -> QuoteSnapshot:
    return await adapter.get_quote(conid)


# ── Execution plan draft + validation ────────────────────────────────────────

@router.post("/plans/draft", response_model=ExecutionPlan, status_code=201)
async def create_plan_draft(
    request: ExecutionPlanDraftRequest,
    svc: ExecutionPlanService = Depends(get_execution_plan_service),
) -> ExecutionPlan:
    return svc.create_draft(request)


@router.get("/plans/{plan_id}", response_model=ExecutionPlan)
async def get_plan(
    plan_id: str,
    svc: ExecutionPlanService = Depends(get_execution_plan_service),
) -> ExecutionPlan:
    plan = svc.get(plan_id)
    if plan is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "plan_not_found", "plan_id": plan_id},
        )
    return plan


@router.post("/plans/{plan_id}/validate", response_model=ExecutionPlan)
async def validate_plan(
    plan_id: str,
    svc: ExecutionPlanService = Depends(get_execution_plan_service),
    adapter: TwsBrokerAdapter = Depends(get_tws_adapter),
) -> ExecutionPlan:
    plan = svc.get(plan_id)
    if plan is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "plan_not_found", "plan_id": plan_id},
        )
    return await svc.validate(plan, adapter)


@router.post("/plans/{plan_id}/preview-paper", response_model=PaperOrderPreview)
async def preview_paper_order(
    plan_id: str,
    svc: ExecutionPlanService = Depends(get_execution_plan_service),
    adapter: TwsBrokerAdapter = Depends(get_tws_adapter),
) -> PaperOrderPreview:
    if not adapter.is_connected():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"error": "not_connected"},
        )
    if not adapter.is_paper_port():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "error": "not_paper_port",
                "message": "Connected port is not a known paper port (4002 or 7497). Order actions are read-only on live and unknown ports.",
            },
        )
    plan = svc.get(plan_id)
    if plan is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "plan_not_found", "plan_id": plan_id},
        )
    if plan.status != "valid":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"error": "plan_not_valid", "status": plan.status},
        )
    return svc.preview_paper(plan)


@router.post("/plans/{plan_id}/place-paper", response_model=PaperOrderSubmission)
async def place_paper_order(
    plan_id: str,
    svc: ExecutionPlanService = Depends(get_execution_plan_service),
    adapter: TwsBrokerAdapter = Depends(get_tws_adapter),
) -> PaperOrderSubmission:
    if adapter.is_kill_switch_active():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"error": "kill_switch_active"},
        )
    if not adapter.is_connected():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"error": "not_connected"},
        )
    if not adapter.is_paper_port():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "error": "not_paper_port",
                "message": "Connected port is not a known paper port (4002 or 7497). Order placement is blocked on live and unknown ports.",
            },
        )
    plan = svc.get(plan_id)
    if plan is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "plan_not_found", "plan_id": plan_id},
        )
    if plan.status != "valid":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"error": "plan_not_valid", "status": plan.status},
        )
    try:
        return adapter.place_paper_order(plan)
    except TwsPlaceOrderGuardError as exc:
        # Guard fired after the router's own pre-call check (state changed between
        # check and call). Order was never sent — outcome is deterministic.
        _guard_status = {
            "kill_switch_active": status.HTTP_409_CONFLICT,
            "not_connected": status.HTTP_409_CONFLICT,
            "not_paper_port": status.HTTP_403_FORBIDDEN,
            "plan_not_valid": status.HTTP_422_UNPROCESSABLE_ENTITY,
        }
        raise HTTPException(
            status_code=_guard_status.get(exc.error_code, status.HTTP_409_CONFLICT),
            detail={"error": exc.error_code},
        )
    except Exception as exc:
        # Failure at or after the placeOrder() call — outcome is ambiguous.
        # The order may have reached TWS; warn the user before retrying.
        log.error("Paper order placement failed for plan %s: %s", plan_id, exc)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "unknown_outcome",
                "message": (
                    "Order placement failed unexpectedly. Check TWS Open Orders "
                    "before retrying — the order may have reached TWS."
                ),
            },
        )
