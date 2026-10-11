from fastapi import APIRouter, Body, Depends

from deps import get_broker_session
from models.broker_session import BrokerSessionModeResponse, BrokerSessionSwitchTarget
from services.broker_session import BrokerSessionService

router = APIRouter(prefix="/orbit/session", tags=["orbit-session"])


def _response(session: BrokerSessionService) -> BrokerSessionModeResponse:
    return BrokerSessionModeResponse(
        mode=session.current_mode(),
        available_modules=session.available_modules(),
    )


@router.get("/mode", response_model=BrokerSessionModeResponse)
async def get_mode(
    session: BrokerSessionService = Depends(get_broker_session),
) -> BrokerSessionModeResponse:
    return _response(session)


@router.post("/mode", response_model=BrokerSessionModeResponse)
async def set_mode(
    target: BrokerSessionSwitchTarget = Body(..., embed=True),
    session: BrokerSessionService = Depends(get_broker_session),
) -> BrokerSessionModeResponse:
    session.set_mode(target)
    return _response(session)
