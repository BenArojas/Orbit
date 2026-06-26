from fastapi import APIRouter, Depends

from deps import get_tws_status
from models.tws_execution_assistant import TwsStatusResponse
from services.tws_status import TwsStatusService

router = APIRouter(prefix="/execution-assistant", tags=["execution-assistant"])


@router.get("/status", response_model=TwsStatusResponse)
async def get_status(
    svc: TwsStatusService = Depends(get_tws_status),
) -> TwsStatusResponse:
    return svc.get_status()
