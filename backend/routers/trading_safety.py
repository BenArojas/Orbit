"""Trading Safety router for order action policy decisions."""

from fastapi import APIRouter, Depends, HTTPException, Query, status

from deps import require_ibkr_auth
from models import TradingSafetyAction, TradingSafetyDecision
from services.ibkr import IBKRService
from services.moonmarket import MoonMarketAccountNotFoundError
from services.trading_safety import TradingSafetyPolicy

router = APIRouter(prefix="/moonmarket/trading-safety", tags=["moonmarket-trading-safety"])


def _policy(ibkr: IBKRService) -> TradingSafetyPolicy:
    return TradingSafetyPolicy(ibkr)


def _account_not_found(exc: MoonMarketAccountNotFoundError) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail={"error": "moonmarket_account_not_found", "message": str(exc)},
    )


@router.get("/order-action", response_model=TradingSafetyDecision)
async def order_action_decision(
    account_id: str,
    action: TradingSafetyAction = Query(...),
    ibkr: IBKRService = Depends(require_ibkr_auth),
) -> TradingSafetyDecision:
    try:
        return await _policy(ibkr).evaluate_order_action(account_id, action)
    except MoonMarketAccountNotFoundError as exc:
        raise _account_not_found(exc) from exc
