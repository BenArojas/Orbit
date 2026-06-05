"""
Sector data routes — sector performance + Relative Rotation Graph.

Endpoints:
  GET  /sectors/performance   — YTD performance for 11 SPDR sector ETFs
  GET  /sectors/rrg           — Relative Rotation Graph data points
  GET  /sectors/overview      — Combined performance + RRG in one call
  GET  /sectors/breadth       — Market-breadth proxy (Market Strength gauge)
  GET  /sectors/rotation      — Offensive vs defensive rotation gauge

Every handler fans out many IBKR history calls that share the global
4-slot history semaphore with the Analysis chart. They run through
`run_cancelling_on_disconnect` so that when the user navigates away
mid-load (Market -> Analysis), the in-flight history fetches are
cancelled and the semaphore is freed for the chart instead of being
queued behind ~40 sector requests.
"""

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Request

from deps import get_sectors
from request_cancellation import ClientDisconnected, run_cancelling_on_disconnect
from services.sectors import SectorService

log = logging.getLogger("parallax.routers.sectors")

router = APIRouter(prefix="/sectors", tags=["sectors"])

# 499 = nginx's "client closed request" convention; the response is discarded
# anyway since the client is gone — the status only shows in our own logs.
_CLIENT_CLOSED = 499


async def _guarded(request: Request, coro, label: str):
    """Run a sector computation, cancelling it if the client disconnects."""
    try:
        return await run_cancelling_on_disconnect(request, coro, label=label)
    except ClientDisconnected:
        raise HTTPException(status_code=_CLIENT_CLOSED, detail="client disconnected")


@router.get("/performance")
async def get_sector_performance(
    request: Request,
    service: SectorService = Depends(get_sectors),
):
    """YTD performance for all 11 SPDR sector ETFs, sorted descending."""
    return await _guarded(
        request, service.get_sector_performance(), "sectors/performance"
    )


@router.get("/rrg")
async def get_rrg(
    request: Request,
    service: SectorService = Depends(get_sectors),
):
    """Relative Rotation Graph data — RS-Ratio, RS-Momentum, quadrant, trail."""
    return await _guarded(request, service.get_rrg_data(), "sectors/rrg")


@router.get("/overview")
async def get_sector_overview(
    request: Request,
    service: SectorService = Depends(get_sectors),
):
    """Combined performance + RRG (shared conid resolution is cheaper)."""
    async def _both():
        performance, rrg = await asyncio.gather(
            service.get_sector_performance(),
            service.get_rrg_data(),
        )
        return {"performance": performance, "rrg": rrg}

    return await _guarded(request, _both(), "sectors/overview")


@router.get("/breadth")
async def get_market_breadth(
    request: Request,
    service: SectorService = Depends(get_sectors),
):
    """% of 11 SPDR sector ETFs above their 50-day EMA (Market Strength gauge)."""
    return await _guarded(request, service.get_market_breadth(), "sectors/breadth")


@router.get("/rotation")
async def get_sector_rotation(
    request: Request,
    service: SectorService = Depends(get_sectors),
):
    """1-month offensive vs defensive sector performance (Rotation gauge)."""
    return await _guarded(request, service.get_sector_rotation(), "sectors/rotation")
