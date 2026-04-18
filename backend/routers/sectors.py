"""
Sector data routes — sector performance + Relative Rotation Graph.

Endpoints:
  GET  /sectors/performance   — YTD performance for 11 SPDR sector ETFs
  GET  /sectors/rrg           — Relative Rotation Graph data points
  GET  /sectors/overview      — Combined performance + RRG in one call
"""

import asyncio
import logging

from fastapi import APIRouter, Depends

from deps import get_sectors
from services.sectors import SectorService

log = logging.getLogger("parallax.routers.sectors")

router = APIRouter(prefix="/sectors", tags=["sectors"])


@router.get("/performance")
async def get_sector_performance(
    service: SectorService = Depends(get_sectors),
):
    """
    Fetch YTD performance for all 11 SPDR sector ETFs.
    Returns sorted by YTD % descending.
    """
    return await service.get_sector_performance()


@router.get("/rrg")
async def get_rrg(
    service: SectorService = Depends(get_sectors),
):
    """
    Compute Relative Rotation Graph data for all sector ETFs.
    Returns RS-Ratio, RS-Momentum, quadrant, and trail for each sector.
    """
    return await service.get_rrg_data()


@router.get("/overview")
async def get_sector_overview(
    service: SectorService = Depends(get_sectors),
):
    """
    Combined endpoint — returns both sector performance and RRG data.
    More efficient than calling /performance and /rrg separately
    because IBKR conid resolution is cached across both calls.
    """
    performance, rrg = await asyncio.gather(
        service.get_sector_performance(),
        service.get_rrg_data(),
    )
    return {
        "performance": performance,
        "rrg": rrg,
    }


@router.get("/breadth")
async def get_market_breadth(
    service: SectorService = Depends(get_sectors),
):
    """
    Market-breadth proxy — % of 11 SPDR sector ETFs above their 50-day EMA.

    Feeds the "Market Strength" arc gauge on the dashboard.
    """
    return await service.get_market_breadth()


@router.get("/rotation")
async def get_sector_rotation(
    service: SectorService = Depends(get_sectors),
):
    """
    Sector rotation — 1-month performance of offensive (XLK/XLY/XLC/XLF)
    vs defensive (XLP/XLU/XLV) sector ETFs.

    Feeds the "Sector Rotation" arc gauge on the dashboard.
    """
    return await service.get_sector_rotation()
