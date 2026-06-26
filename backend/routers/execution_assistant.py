from fastapi import APIRouter, Depends

from deps import get_broker_session, get_tws_adapter
from models.tws_execution_assistant import TwsConnectRequest, TwsStatusResponse
from services.broker_session import BrokerSessionService
from services.tws_broker_adapter import TwsBrokerAdapter

router = APIRouter(prefix="/execution-assistant", tags=["execution-assistant"])


@router.get("/status", response_model=TwsStatusResponse)
async def get_status(
    adapter: TwsBrokerAdapter = Depends(get_tws_adapter),
    session: BrokerSessionService = Depends(get_broker_session),
) -> TwsStatusResponse:
    return adapter.get_status(session.current_mode())


@router.post("/connect", response_model=TwsStatusResponse)
async def connect(
    request: TwsConnectRequest,
    adapter: TwsBrokerAdapter = Depends(get_tws_adapter),
    session: BrokerSessionService = Depends(get_broker_session),
) -> TwsStatusResponse:
    await adapter.connect(request.host, request.port, request.client_id)
    return adapter.get_status(session.current_mode())


@router.post("/disconnect", response_model=TwsStatusResponse)
async def disconnect(
    adapter: TwsBrokerAdapter = Depends(get_tws_adapter),
    session: BrokerSessionService = Depends(get_broker_session),
) -> TwsStatusResponse:
    await adapter.disconnect()
    return adapter.get_status(session.current_mode())
