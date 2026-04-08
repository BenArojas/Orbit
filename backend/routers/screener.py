"""
Screener routes — scan instruments by IBKR scanner presets + indicator filters.

Endpoints:
  POST /screener/scan      — Run a screener scan
  GET  /screener/presets    — List available scanner presets
  GET  /screener/params     — Fetch raw IBKR scanner parameters
"""

import logging

from fastapi import APIRouter, Depends

from deps import get_screener
from models import (
    ScannerParamsResponse,
    ScannerPreset,
    ScanRequest,
    ScanResponse,
)
from services.screener import DEFAULT_PRESETS, ScreenerService

log = logging.getLogger("parallax.routers.screener")

router = APIRouter(prefix="/screener", tags=["screener"])


# ── POST /screener/scan ─────────────────────────────────────


@router.post("/scan", response_model=ScanResponse)
async def run_scan(
    request: ScanRequest,
    screener: ScreenerService = Depends(get_screener),
):
    """
    Run a screener scan.

    The frontend sends:
      - instrument/scan_type/location: Which IBKR scanner preset to use
      - filters: Indicator filter criteria (RSI > 30, EMA trend, etc.)
      - indicators: Which indicators to compute for each result
      - max_results: Cap on how many instruments to process

    The backend:
      1. Runs the IBKR scanner to get a universe of instruments
      2. Fetches quotes + computes indicators for each
      3. Applies the user's filters
      4. Returns matching rows with indicator snapshot values
    """
    return await screener.scan(
        instrument=request.instrument,
        scan_type=request.scan_type,
        location=request.location,
        filters=request.filters,
        indicators=request.indicators,
        max_results=request.max_results,
    )


# ── GET /screener/presets ───────────────────────────────────


@router.get("/presets", response_model=list[ScannerPreset])
async def list_presets():
    """
    Return the list of curated scanner presets.
    These are pre-configured IBKR scanner combos (most active, top gainers, etc.)
    that the frontend shows in the preset picker dropdown.
    """
    return [ScannerPreset(**p) for p in DEFAULT_PRESETS]


# ── GET /screener/params ────────────────────────────────────


@router.get("/params", response_model=ScannerParamsResponse)
async def scanner_params(
    screener: ScreenerService = Depends(get_screener),
):
    """
    Fetch the full list of available scanner parameters from IBKR.
    Returns instruments, locations, scan types, and filter codes.
    Use this to build a custom preset or explore what IBKR supports.
    """
    raw = await screener.ibkr.scanner_params()

    return ScannerParamsResponse(
        instruments=raw.get("instrument_list", []),
        locations=raw.get("location_tree", []),
        scan_types=raw.get("scan_type_list", []),
        filters=raw.get("filter_list", []),
    )
