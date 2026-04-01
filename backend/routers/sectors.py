"""
Sector data routes — sector performance + Relative Rotation Graph.

Endpoints:
  GET  /sectors/performance   — YTD performance for 11 SPDR sector ETFs
  GET  /sectors/rrg           — Relative Rotation Graph data points
  GET  /sectors/overview      — Combined performance + RRG in one call
"""

import logging

from fastapi import APIRouter, Depends

from deps import get_ibkr
from services.ibkr import IBKRService
from services.sectors import SectorService

log = logging.getLogger("parallax.routers.sectors")

router = APIRouter(prefix="/sectors", tags=["sectors"])


def _get_sector_service(ibkr: IBKRService = Depends(get_ibkr)) -> SectorService:
    """Create a SectorService with the IBKR singleton."""
    return SectorService(ibkr)


@router.get("/performance")
async def get_sector_performance(
    service: SectorService = Depends(_get_sector_service),
):
    """
    Fetch YTD performance for all 11 SPDR sector ETFs.
    Returns sorted by YTD % descending.
    """
    return await service.get_sector_performance()


@router.get("/rrg")
async def get_rrg(
    service: SectorService = Depends(_get_sector_service),
):
    """
    Compute Relative Rotation Graph data for all sector ETFs.
    Returns RS-Ratio, RS-Momentum, quadrant, and trail for each sector.
    """
    return await service.get_rrg_data()


@router.get("/overview")
async def get_sector_overview(
    service: SectorService = Depends(_get_sector_service),
):
    """
    Combined endpoint — returns both sector performance and RRG data.
    More efficient than calling /performance and /rrg separately
    because IBKR conid resolution is cached across both calls.
    """
    import asyncio

    performance, rrg = await asyncio.gather(
        service.get_sector_performance(),
        service.get_rrg_data(),
    )
    return {
        "performance": performance,
        "rrg": rrg,
    }
