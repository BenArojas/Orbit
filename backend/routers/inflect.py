"""Inflect router — thin handlers over `InflectService` for the journal module.

Endpoints (spec §6): calendar, trades list/detail, journal upsert, force-sync,
and the fixed setup vocabulary. Business logic lives in the service; handlers
only wire dependencies, parse query params, and map typed service errors to
HTTP. Typed exceptions only — no bare `except Exception`.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status

from deps import get_db, get_ibkr, require_ibkr_auth
from models.inflect import (
    InflectCalendarResponse,
    InflectSetupsResponse,
    InflectSyncResponse,
    InflectTrade,
    InflectTradesResponse,
    JournalEntry,
    JournalUpsertRequest,
)
from services.db import DatabaseService
from services.ibkr import IBKRService
from services.inflect.service import InflectService, InflectTradeNotFoundError
from services.moonmarket import MoonMarketAccountNotFoundError, MoonMarketService

router = APIRouter(prefix="/inflect", tags=["inflect"])


def _build_service(ibkr: IBKRService, db: DatabaseService) -> InflectService:
    return InflectService(ibkr=ibkr, db=db, moonmarket=MoonMarketService(ibkr))


def get_inflect_service(
    ibkr: IBKRService = Depends(get_ibkr),
    db: DatabaseService = Depends(get_db),
) -> InflectService:
    """Ungated service (for static data like the setup vocabulary)."""
    return _build_service(ibkr, db)


def require_inflect_service(
    ibkr: IBKRService = Depends(require_ibkr_auth),
    db: DatabaseService = Depends(get_db),
) -> InflectService:
    """Auth-gated service for IBKR-backed reads/writes."""
    return _build_service(ibkr, db)


def _account_not_found(exc: MoonMarketAccountNotFoundError) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail={"error": "inflect_account_not_found", "message": str(exc)},
    )


@router.get("/health")
async def inflect_health() -> dict[str, str]:
    return {"module": "inflect", "status": "ok"}


@router.get("/setups", response_model=InflectSetupsResponse)
async def inflect_setups(
    service: InflectService = Depends(get_inflect_service),
) -> InflectSetupsResponse:
    return service.setups()


@router.get("/calendar", response_model=InflectCalendarResponse)
async def inflect_calendar(
    year: int = Query(..., ge=1970, le=2999),
    month: int = Query(..., ge=1, le=12),
    account_id: str | None = Query(default=None),
    service: InflectService = Depends(require_inflect_service),
) -> InflectCalendarResponse:
    try:
        return await service.calendar(account_id=account_id, year=year, month=month)
    except MoonMarketAccountNotFoundError as exc:
        raise _account_not_found(exc) from exc


@router.get("/trades", response_model=InflectTradesResponse)
async def inflect_trades(
    account_id: str | None = Query(default=None),
    from_ms: int | None = Query(default=None, alias="from"),
    to_ms: int | None = Query(default=None, alias="to"),
    status_filter: str | None = Query(default=None, alias="status"),
    service: InflectService = Depends(require_inflect_service),
) -> InflectTradesResponse:
    try:
        return await service.trades(
            account_id=account_id,
            from_ms=from_ms,
            to_ms=to_ms,
            status=status_filter,
        )
    except MoonMarketAccountNotFoundError as exc:
        raise _account_not_found(exc) from exc


@router.get("/trades/{trade_id}", response_model=InflectTrade)
async def inflect_trade(
    trade_id: str,
    account_id: str | None = Query(default=None),
    service: InflectService = Depends(require_inflect_service),
) -> InflectTrade:
    try:
        trade = await service.trade(trade_id=trade_id, account_id=account_id)
    except MoonMarketAccountNotFoundError as exc:
        raise _account_not_found(exc) from exc
    if trade is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "inflect_trade_not_found", "message": trade_id},
        )
    return trade


@router.put("/trades/{trade_id}/journal", response_model=JournalEntry)
async def inflect_save_journal(
    trade_id: str,
    payload: JournalUpsertRequest,
    account_id: str | None = Query(default=None),
    service: InflectService = Depends(require_inflect_service),
) -> JournalEntry:
    try:
        return await service.save_journal(
            trade_id=trade_id, account_id=account_id, payload=payload
        )
    except MoonMarketAccountNotFoundError as exc:
        raise _account_not_found(exc) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "inflect_invalid_trade_id", "message": str(exc)},
        ) from exc
    except InflectTradeNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "inflect_trade_not_found", "message": str(exc)},
        ) from exc


@router.post("/sync", response_model=InflectSyncResponse)
async def inflect_sync(
    account_id: str | None = Query(default=None),
    service: InflectService = Depends(require_inflect_service),
) -> InflectSyncResponse:
    try:
        return await service.sync(account_id=account_id)
    except MoonMarketAccountNotFoundError as exc:
        raise _account_not_found(exc) from exc
