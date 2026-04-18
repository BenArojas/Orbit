"""
Screener routes — scan instruments by IBKR scanner presets + indicator filters.

Endpoints:
  POST /screener/scan      — Run a screener scan
  GET  /screener/presets    — List available scanner presets
  GET  /screener/params     — Fetch raw IBKR scanner parameters
"""

import asyncio
import datetime
import logging
from typing import Any

from fastapi import APIRouter, Depends

from deps import get_screener
from models import (
    AiFilterRequest,
    AiFilterResponse,
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
    """
    Fetch contract details for the screener quick-peek slide-over.

    Runs contract_info + 1y daily history in parallel.
    History is used to compute:
      - Relative performance: 5D, 1M, 3M, YTD
      - 52W positioning: % from high, % from low, days since 52W high
    """
    raw, hist = await asyncio.gather(
        screener.ibkr.contract_info(conid),
        screener.ibkr.history(conid, period="1y", bar="1d"),
        return_exceptions=True,
    )

    # contract_info is mandatory; history is best-effort
    if isinstance(raw, Exception):
        raise raw

    if isinstance(hist, Exception):
        log.warning("History fetch failed for conid %d: %s", conid, hist)
        hist = {}

    # ── Parse history bars ────────────────────────────────────
    bars: list[dict] = []
    if isinstance(hist, dict):
        bars = hist.get("data", [])

    # Compute enrichment from bars (each bar: {t: epoch_ms, o, h, l, c, v})
    perf_5d = perf_1m = perf_3m = perf_ytd = None
    w52_pct_from_high = w52_pct_from_low = None
    w52_days_since_high: int | None = None

    if bars:
        closes = [b.get("c") for b in bars if b.get("c") is not None]
        timestamps = [b.get("t") for b in bars if b.get("t") is not None]

        if closes and len(closes) >= 2:
            last_close = closes[-1]
            now_ts = datetime.datetime.now(tz=datetime.timezone.utc)

            # ── Relative performance ───────────────────────────
            def _perf(n_bars: int) -> float | None:
                if len(closes) > n_bars:
                    base = closes[-(n_bars + 1)]
                    if base and base != 0:
                        return round((last_close - base) / base * 100, 2)
                return None

            perf_5d = _perf(5)
            perf_1m = _perf(21)   # ~21 trading days
            perf_3m = _perf(63)   # ~63 trading days

            # YTD: find first bar in current calendar year
            year_start = datetime.datetime(now_ts.year, 1, 1, tzinfo=datetime.timezone.utc)
            ytd_bars = [
                (t, c) for t, c in zip(timestamps, closes)
                if t is not None and datetime.datetime.fromtimestamp(
                    t / 1000, tz=datetime.timezone.utc
                ) >= year_start
            ]
            if ytd_bars:
                ytd_base = ytd_bars[0][1]
                if ytd_base and ytd_base != 0:
                    perf_ytd = round((last_close - ytd_base) / ytd_base * 100, 2)

            # ── 52W positioning ────────────────────────────────
            # Use the last 252 bars as a proxy for ~1 trading year
            year_bars = bars[-252:]
            year_highs = [b.get("h") for b in year_bars if b.get("h") is not None]
            year_lows = [b.get("l") for b in year_bars if b.get("l") is not None]

            if year_highs:
                w52_high = max(year_highs)
                if w52_high and w52_high != 0:
                    w52_pct_from_high = round((last_close - w52_high) / w52_high * 100, 2)

                # Days since 52W high close (use close, not intraday high)
                year_closes = [(b.get("t"), b.get("c")) for b in year_bars if b.get("c") is not None]
                if year_closes:
                    max_close = max(c for _, c in year_closes)
                    # Last bar where close equals (or is closest to) the max close
                    high_bar_ts = next(
                        (t for t, c in reversed(year_closes) if c == max_close),
                        None,
                    )
                    if high_bar_ts is not None:
                        high_dt = datetime.datetime.fromtimestamp(
                            high_bar_ts / 1000, tz=datetime.timezone.utc
                        )
                        w52_days_since_high = (now_ts - high_dt).days

            if year_lows:
                w52_low = min(year_lows)
                if w52_low and w52_low != 0:
                    w52_pct_from_low = round((last_close - w52_low) / w52_low * 100, 2)

    # ── Build response ────────────────────────────────────────
    category = raw.get("category", "")
    return ContractInfoResponse(
        conid=conid,
        symbol=raw.get("symbol", ""),
        company_name=raw.get("companyName", raw.get("company_name", "")),
        sec_type=raw.get("instrument_type", raw.get("secType", "")),
        exchange=raw.get("exchange", ""),
        currency=raw.get("currency", ""),
        industry=raw.get("industry", ""),
        category=category,
        sector=category,   # IBKR `category` is the broader sector grouping
        avg_volume=_safe_float(raw.get("avgVolume")),
        market_cap=_safe_float(raw.get("marketCap")),
        high_52w=_safe_float(raw.get("week52hi")),
        low_52w=_safe_float(raw.get("week52lo")),
        pe_ratio=_safe_float(raw.get("peRatio")),
        dividend_yield=_safe_float(raw.get("dividendYield")),
        w52_pct_from_high=w52_pct_from_high,
        w52_pct_from_low=w52_pct_from_low,
        w52_days_since_high=w52_days_since_high,
        perf_5d=perf_5d,
        perf_1m=perf_1m,
        perf_3m=perf_3m,
        perf_ytd=perf_ytd,
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


# ── POST /screener/ai-filters ───────────────────────────────


@router.post("/ai-filters", response_model=AiFilterResponse)
async def ai_generate_filters(request: AiFilterRequest):
    """
    Translate a natural language query into IBKR scanner filter codes using Ollama.

    The AI reads the filter catalogue and returns structured filter codes
    that can be applied directly to the filter bar.
    """
    from services.screener_ai import ScreenerAiService

    # ScreenerAiService is stateless — create per-request (cheap, no state)
    svc = ScreenerAiService()
    try:
        result = await svc.generate_filters(
            query=request.query,
            model=request.model,
            preset_context=request.preset_context or "",
        )
        return AiFilterResponse(**result)
    finally:
        await svc.shutdown()
