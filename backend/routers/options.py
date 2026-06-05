"""MoonMarket options-chain router."""

from fastapi import APIRouter, Depends, HTTPException, Query, status

from deps import require_ibkr_auth
from models import (
    MoonMarketOptionChainResponse,
    MoonMarketOptionExpirationsResponse,
    MoonMarketOptionWindowResponse,
    MoonMarketSingleOptionStrikeResponse,
)
from services.ibkr import IBKRService
from services.options import OptionLookupError, OptionService

router = APIRouter(prefix="/moonmarket/options", tags=["moonmarket-options"])


def _service(ibkr: IBKRService) -> OptionService:
    return OptionService(ibkr)


def _lookup_error(exc: OptionLookupError) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail={"error": "option_lookup_failed", "message": str(exc)},
    )


@router.get("/expirations/{underlying_conid}", response_model=MoonMarketOptionExpirationsResponse)
async def option_expirations(
    underlying_conid: int,
    symbol: str = Query(..., min_length=1),
    ibkr: IBKRService = Depends(require_ibkr_auth),
) -> MoonMarketOptionExpirationsResponse:
    try:
        expirations = await _service(ibkr).expirations(underlying_conid, symbol)
    except OptionLookupError as exc:
        raise _lookup_error(exc) from exc
    return MoonMarketOptionExpirationsResponse(
        underlying_conid=underlying_conid,
        symbol=symbol.upper(),
        expirations=expirations,
    )


@router.get("/chain/{underlying_conid}", response_model=MoonMarketOptionChainResponse)
async def option_chain(
    underlying_conid: int,
    expiration: str = Query(..., min_length=1),
    ibkr: IBKRService = Depends(require_ibkr_auth),
) -> MoonMarketOptionChainResponse:
    strikes = await _service(ibkr).strikes(underlying_conid, expiration)
    return MoonMarketOptionChainResponse(
        underlying_conid=underlying_conid,
        expiration=expiration,
        all_strikes=strikes,
        chain={},
    )


@router.get("/contract/{underlying_conid}", response_model=MoonMarketSingleOptionStrikeResponse)
async def option_contract(
    underlying_conid: int,
    expiration: str = Query(..., min_length=1),
    strike: float = Query(..., gt=0),
    ibkr: IBKRService = Depends(require_ibkr_auth),
) -> MoonMarketSingleOptionStrikeResponse:
    pair = await _service(ibkr).contract_pair(underlying_conid, expiration, strike)
    return MoonMarketSingleOptionStrikeResponse(strike=strike, data=pair)


@router.get("/window/{underlying_conid}", response_model=MoonMarketOptionWindowResponse)
async def option_window(
    underlying_conid: int,
    expiration: str = Query(..., min_length=1),
    strikes: list[float] = Query(..., min_length=1, max_length=12),
    ibkr: IBKRService = Depends(require_ibkr_auth),
) -> MoonMarketOptionWindowResponse:
    data = await _service(ibkr).contract_window(underlying_conid, expiration, strikes)
    return MoonMarketOptionWindowResponse(
        underlying_conid=underlying_conid,
        expiration=expiration,
        strikes=data,
    )
