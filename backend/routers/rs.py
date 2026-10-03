"""Published Relative Strength snapshot and rating lookup routes."""

from fastapi import APIRouter, Depends, HTTPException, Request

from deps import get_instrument_identity, get_rs_leaders, require_ibkr_auth
from models.rs import RSLeadersResponse, RSRatingRequest, RSRatingsResponse
from request_cancellation import ClientDisconnected, run_cancelling_on_disconnect
from services.ibkr import IBKRService
from services.instrument_identity import InstrumentIdentityService
from services.rs_leaders import RSLeadersService

router = APIRouter(prefix="/rs", tags=["relative-strength"])


@router.get("/leaders", response_model=RSLeadersResponse)
async def get_leaders(
    _ibkr: IBKRService = Depends(require_ibkr_auth),
    service: RSLeadersService = Depends(get_rs_leaders),
) -> RSLeadersResponse:
    """Return the last valid local snapshot immediately."""
    return service.get_snapshot()


@router.post("/leaders/refresh", response_model=RSLeadersResponse)
async def refresh_leaders(
    request: Request,
    _ibkr: IBKRService = Depends(require_ibkr_auth),
    service: RSLeadersService = Depends(get_rs_leaders),
) -> RSLeadersResponse:
    """Recheck Fred's latest file revision, pin its CSV fetch, and resolve leaders."""
    try:
        return await run_cancelling_on_disconnect(
            request, service.refresh(), label="rs/leaders/refresh"
        )
    except ClientDisconnected:
        raise HTTPException(status_code=499, detail="client disconnected")


@router.post("/ratings", response_model=RSRatingsResponse)
async def get_ratings(
    body: RSRatingRequest,
    request: Request,
    _ibkr: IBKRService = Depends(require_ibkr_auth),
    service: RSLeadersService = Depends(get_rs_leaders),
    identity: InstrumentIdentityService = Depends(get_instrument_identity),
) -> RSRatingsResponse:
    """Look up Fred's published values for known stock conids without changing membership."""
    async def lookup() -> RSRatingsResponse:
        identities = await identity.get_many(body.conids)
        return await service.ratings(identities, body.conids)

    try:
        return await run_cancelling_on_disconnect(request, lookup(), label="rs/ratings")
    except ClientDisconnected:
        raise HTTPException(status_code=499, detail="client disconnected")
