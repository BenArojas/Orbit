from fastapi import APIRouter, Depends, HTTPException, status

from deps import get_broker_session, get_execution_plan_service, get_tws_adapter
from models.execution_plan import ExecutionPlan, ExecutionPlanDraftRequest
from models.tws_execution_assistant import ReconciliationSnapshot, TwsConnectRequest, TwsStatusResponse
from services.broker_session import BrokerSessionService
from services.execution_plan import ExecutionPlanService
from services.tws_broker_adapter import TwsBrokerAdapter

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
