"""MoonMarket router — portfolio data for the MoonMarket module."""

from fastapi import APIRouter, Depends, HTTPException, Query, status

from deps import require_ibkr_auth
from models import (
    MoonMarketAccountsResponse,
    MoonMarketPerformanceResponse,
    MoonMarketPortfolioResponse,
)
from services.ibkr import IBKRService
from services.moonmarket import MoonMarketAccountNotFoundError, MoonMarketService

router = APIRouter(prefix="/moonmarket", tags=["moonmarket"])


@router.get("/health")
async def moonmarket_health() -> dict[str, str]:
    return {"module": "moonmarket", "status": "ok"}


@router.get("/accounts", response_model=MoonMarketAccountsResponse)
async def moonmarket_accounts(
    ibkr: IBKRService = Depends(require_ibkr_auth),
) -> MoonMarketAccountsResponse:
    return await MoonMarketService(ibkr).accounts()


@router.get("/portfolio", response_model=MoonMarketPortfolioResponse)
async def moonmarket_portfolio(
    account_id: str | None = Query(default=None),
    ibkr: IBKRService = Depends(require_ibkr_auth),
) -> MoonMarketPortfolioResponse:
    try:
        return await MoonMarketService(ibkr).portfolio(account_id=account_id)
    except MoonMarketAccountNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "moonmarket_account_not_found", "message": str(exc)},
        ) from exc


@router.get("/performance", response_model=MoonMarketPerformanceResponse)
async def moonmarket_performance(
    account_id: str | None = Query(default=None),
    period: str = Query(default="1Y", min_length=1, max_length=8),
    ibkr: IBKRService = Depends(require_ibkr_auth),
) -> MoonMarketPerformanceResponse:
    try:
        return await MoonMarketService(ibkr).performance(account_id=account_id, period=period)
    except MoonMarketAccountNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "moonmarket_account_not_found", "message": str(exc)},
        ) from exc
