"""MoonMarket order router."""

from fastapi import APIRouter, Depends, HTTPException, status

from deps import require_cp_mode, require_ibkr_auth
from models import (
    MoonMarketOrderActionResponse,
    MoonMarketOrderDraft,
    MoonMarketOrderPreviewRequest,
    MoonMarketOrderReplyRequest,
    MoonMarketOrdersRequest,
)
from services.ibkr import IBKRService
from services.moonmarket import MoonMarketAccountNotFoundError
from services.orders import (
    OptionBracketNotSupportedError,
    OrderResult,
    OrderService,
)
from services.trading_safety import TradingSafetyPolicy

router = APIRouter(prefix="/moonmarket/orders", tags=["moonmarket-orders"])


def _service(ibkr: IBKRService) -> OrderService:
    return OrderService(ibkr)


def _safety_policy(ibkr: IBKRService) -> TradingSafetyPolicy:
    return TradingSafetyPolicy(ibkr)


def _result(account_id: str, result: OrderResult) -> MoonMarketOrderActionResponse:
    return MoonMarketOrderActionResponse(account_id=account_id, result=result)


def _account_not_found(exc: MoonMarketAccountNotFoundError) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail={"error": "moonmarket_account_not_found", "message": str(exc)},
    )


def _option_bracket_not_supported(exc: OptionBracketNotSupportedError) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail={"error": "option_bracket_not_supported", "message": str(exc)},
    )


def _trading_safety_rejected(message: str | None) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail={
            "error": "trading_safety_rejected",
            "message": message or "Trading Safety rejected this order action.",
        },
    )


@router.post("/preview", response_model=MoonMarketOrderActionResponse)
async def preview_order(
    request: MoonMarketOrderPreviewRequest,
    ibkr: IBKRService = Depends(require_ibkr_auth),
) -> MoonMarketOrderActionResponse:
    try:
        result = await _service(ibkr).preview(request.account_id, request.order)
        return _result(request.account_id, result)
    except MoonMarketAccountNotFoundError as exc:
        raise _account_not_found(exc) from exc


@router.post("", response_model=MoonMarketOrderActionResponse)
async def place_orders(
    request: MoonMarketOrdersRequest,
    ibkr: IBKRService = Depends(require_ibkr_auth),
    _: None = Depends(require_cp_mode),
) -> MoonMarketOrderActionResponse:
    try:
        decision = await _safety_policy(ibkr).evaluate_order_action(request.account_id, "place")
        if not decision.allowed:
            raise _trading_safety_rejected(decision.confirmation.message)
        result = await _service(ibkr).place(request.account_id, request.orders)
        return _result(request.account_id, result)
    except HTTPException:
        raise
    except MoonMarketAccountNotFoundError as exc:
        raise _account_not_found(exc) from exc
    except OptionBracketNotSupportedError as exc:
        raise _option_bracket_not_supported(exc) from exc


@router.post("/{account_id}/reply/{reply_id}", response_model=MoonMarketOrderActionResponse)
async def reply_to_order(
    account_id: str,
    reply_id: str,
    request: MoonMarketOrderReplyRequest,
    ibkr: IBKRService = Depends(require_ibkr_auth),
    _: None = Depends(require_cp_mode),
) -> MoonMarketOrderActionResponse:
    try:
        decision = await _safety_policy(ibkr).evaluate_order_action(account_id, "reply")
        if not decision.allowed:
            raise _trading_safety_rejected(decision.confirmation.message)
        result = await _service(ibkr).reply(account_id, reply_id, request.confirmed)
        return _result(account_id, result)
    except HTTPException:
        raise
    except MoonMarketAccountNotFoundError as exc:
        raise _account_not_found(exc) from exc


@router.delete("/{account_id}/{order_id}", response_model=MoonMarketOrderActionResponse)
async def cancel_order(
    account_id: str,
    order_id: str,
    ibkr: IBKRService = Depends(require_ibkr_auth),
    _: None = Depends(require_cp_mode),
) -> MoonMarketOrderActionResponse:
    try:
        decision = await _safety_policy(ibkr).evaluate_order_action(account_id, "cancel")
        if not decision.allowed:
            raise _trading_safety_rejected(decision.confirmation.message)
        result = await _service(ibkr).cancel(account_id, order_id)
        return _result(account_id, result)
    except HTTPException:
        raise
    except MoonMarketAccountNotFoundError as exc:
        raise _account_not_found(exc) from exc


@router.patch("/{account_id}/{order_id}", response_model=MoonMarketOrderActionResponse)
async def modify_order(
    account_id: str,
    order_id: str,
    order: MoonMarketOrderDraft,
    ibkr: IBKRService = Depends(require_ibkr_auth),
    _: None = Depends(require_cp_mode),
) -> MoonMarketOrderActionResponse:
    try:
        decision = await _safety_policy(ibkr).evaluate_order_action(account_id, "modify")
        if not decision.allowed:
            raise _trading_safety_rejected(decision.confirmation.message)
        result = await _service(ibkr).modify(account_id, order_id, order)
        return _result(account_id, result)
    except HTTPException:
        raise
    except MoonMarketAccountNotFoundError as exc:
        raise _account_not_found(exc) from exc
