"""
Screener routes — scan instruments by IBKR scanner presets + indicator filters.

Endpoints:
  POST /screener/scan      — Run a screener scan
  GET  /screener/presets    — List available scanner presets
  GET  /screener/params     — Fetch raw IBKR scanner parameters
"""

import logging
from typing import Any

from fastapi import APIRouter, Depends

from deps import get_screener
from models import (
    ContractInfoResponse,
    ScannerParamsResponse,
    ScannerPreset,
    ScanRequest,
    ScanResponse,
)
from services.screener import DEFAULT_PRESETS, ScreenerService

log = logging.getLogger("parallax.routers.screener")

router = APIRouter(prefix="/screener", tags=["screener"])


def _safe_float(value: Any) -> float | None:
    """Convert a value to float, or None if invalid/NaN."""
    if value is None:
        return None
    try:
        result = float(value)
        return None if result != result else result  # NaN check
    except (ValueError, TypeError):
        return None


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
      - filters: Native IBKR filter codes (e.g. marketCapAbove1e6, minPeRatio)
      - max_results: Cap on how many instruments to process
      - sort_field: Optional IBKR sort code (e.g., "changePercAbove")
      - sort_direction: "asc" or "desc"
      - page: Page number (1-indexed)
      - page_size: Results per page

    The backend:
      1. Runs the IBKR scanner with native filters (server-side filtering)
      2. Batch-fetches snapshot quotes (price, chg%, volume, market cap)
      3. Paginates results
      4. Returns enriched rows
    """
    return await screener.scan(
        instrument=request.instrument,
        scan_type=request.scan_type,
        location=request.location,
        filters=request.filters,
        max_results=request.max_results,
        sort_field=request.sort_field,
        sort_direction=request.sort_direction,
        page=request.page,
        page_size=request.page_size,
    )


# ── GET /screener/contract/{conid} ──────────────────────────


@router.get("/contract/{conid}", response_model=ContractInfoResponse)
async def contract_info(
    conid: int,
    screener: ScreenerService = Depends(get_screener),
):
    """Fetch contract details for the screener quick-peek slide-over."""
    raw = await screener.ibkr.contract_info(conid)
    return ContractInfoResponse(
        conid=conid,
        symbol=raw.get("symbol", ""),
        company_name=raw.get("companyName", raw.get("company_name", "")),
        sec_type=raw.get("instrument_type", raw.get("secType", "")),
        exchange=raw.get("exchange", ""),
        currency=raw.get("currency", ""),
        industry=raw.get("industry", ""),
        category=raw.get("category", ""),
        avg_volume=_safe_float(raw.get("avgVolume")),
        market_cap=_safe_float(raw.get("marketCap")),
        high_52w=_safe_float(raw.get("week52hi")),
        low_52w=_safe_float(raw.get("week52lo")),
        pe_ratio=_safe_float(raw.get("peRatio")),
        dividend_yield=_safe_float(raw.get("dividendYield")),
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
