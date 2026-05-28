"""MoonMarket order router."""

from fastapi import APIRouter, Depends, HTTPException, status

from deps import require_ibkr_auth
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
    LiveTradingBlockedError,
    OptionBracketNotSupportedError,
    OrderResult,
    OrderService,
)

router = APIRouter(prefix="/moonmarket/orders", tags=["moonmarket-orders"])


def _service(ibkr: IBKRService) -> OrderService:
    return OrderService(ibkr)


def _result(account_id: str, result: OrderResult) -> MoonMarketOrderActionResponse:
    return MoonMarketOrderActionResponse(account_id=account_id, result=result)


def _account_not_found(exc: MoonMarketAccountNotFoundError) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail={"error": "moonmarket_account_not_found", "message": str(exc)},
    )


def _live_blocked(exc: LiveTradingBlockedError) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail={
            "error": "live_trading_blocked",
            "message": "Live account order mutations are blocked in Orbit v1. Select an IBKR paper account.",
            "account_id": exc.account_id,
        },
    )


def _option_bracket_not_supported(exc: OptionBracketNotSupportedError) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail={"error": "option_bracket_not_supported", "message": str(exc)},
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
) -> MoonMarketOrderActionResponse:
    try:
        result = await _service(ibkr).place(request.account_id, request.orders)
        return _result(request.account_id, result)
    except MoonMarketAccountNotFoundError as exc:
        raise _account_not_found(exc) from exc
    except LiveTradingBlockedError as exc:
        raise _live_blocked(exc) from exc
    except OptionBracketNotSupportedError as exc:
        raise _option_bracket_not_supported(exc) from exc


@router.post("/{account_id}/reply/{reply_id}", response_model=MoonMarketOrderActionResponse)
async def reply_to_order(
    account_id: str,
    reply_id: str,
    request: MoonMarketOrderReplyRequest,
    ibkr: IBKRService = Depends(require_ibkr_auth),
) -> MoonMarketOrderActionResponse:
    try:
        result = await _service(ibkr).reply(account_id, reply_id, request.confirmed)
        return _result(account_id, result)
    except MoonMarketAccountNotFoundError as exc:
        raise _account_not_found(exc) from exc
    except LiveTradingBlockedError as exc:
        raise _live_blocked(exc) from exc


@router.delete("/{account_id}/{order_id}", response_model=MoonMarketOrderActionResponse)
async def cancel_order(
    account_id: str,
    order_id: str,
    ibkr: IBKRService = Depends(require_ibkr_auth),
) -> MoonMarketOrderActionResponse:
    try:
        result = await _service(ibkr).cancel(account_id, order_id)
        return _result(account_id, result)
    except MoonMarketAccountNotFoundError as exc:
        raise _account_not_found(exc) from exc
    except LiveTradingBlockedError as exc:
        raise _live_blocked(exc) from exc


@router.patch("/{account_id}/{order_id}", response_model=MoonMarketOrderActionResponse)
async def modify_order(
    account_id: str,
    order_id: str,
    order: MoonMarketOrderDraft,
    ibkr: IBKRService = Depends(require_ibkr_auth),
) -> MoonMarketOrderActionResponse:
    try:
        result = await _service(ibkr).modify(account_id, order_id, order)
        return _result(account_id, result)
    except MoonMarketAccountNotFoundError as exc:
        raise _account_not_found(exc) from exc
    except LiveTradingBlockedError as exc:
        raise _live_blocked(exc) from exc
