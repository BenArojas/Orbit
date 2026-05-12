"""
Indicator routes — compute technical indicators for a given stock.

This is how the frontend gets indicator data for charts and the screener.
The router is thin — it just receives the request, fetches candle data
from IBKR, and passes it to the IndicatorService for computation.

Endpoints:
  POST /indicators/compute  — Compute indicators for a stock
"""

import logging

from fastapi import APIRouter, Depends

from constants.ibkr_history import TIMEFRAME_SPEC, IBKR_BAR_LIMIT
from deps import get_db, get_ibkr
from exceptions import IBKRBarLimitExceededError
from models import (
    CandleData,
    IndicatorComputeResponse,
    IndicatorRequest,
)
from services.db import DatabaseService
from services.ibkr import IBKRService
from services.indicators import IndicatorService, get_active_fib_weights

log = logging.getLogger("parallax.routers.indicators")

router = APIRouter(prefix="/indicators", tags=["indicators"])

# The indicator service is stateless — one instance is fine for the whole app
_indicator_service = IndicatorService()


# ── POST /indicators/compute ─────────────────────────────────


@router.post("/compute", response_model=IndicatorComputeResponse)
async def compute_indicators(
    request: IndicatorRequest,
    ibkr: IBKRService = Depends(get_ibkr),
    db: DatabaseService = Depends(get_db),
):
    """
    Compute technical indicators for a given stock.

    The frontend sends:
      - conid:     which stock (IBKR's unique ID)
      - timeframe: frontend timeframe string — "1m", "5m", "15m", "1h",
                   "4h", "1D", "1W", "1M". The router maps this to the
                   canonical (period, bar) IBKR pair via TIMEFRAME_SPEC.
      - indicators: which indicators to compute

    The backend:
      1. Resolves (period, bar) from TIMEFRAME_SPEC
      2. Fetches historical candle data from IBKR
      3. Validates bar count against est_max_bars ceiling
      4. Runs the requested indicators through pandas-ta
      5. Returns everything in one response (candles + indicator values + fibonacci)
    """
    # Step 1: Resolve IBKR (period, bar) from timeframe
    spec = TIMEFRAME_SPEC.get(request.timeframe)
    if spec is None:
        # Defensive fallback — model validator should have caught invalid values
        log.warning(
            "Unknown timeframe %r, falling back to 1D spec", request.timeframe
        )
        spec = TIMEFRAME_SPEC["1D"]

    ibkr_period = spec.period
    ibkr_bar = spec.bar
    est_max_bars = spec.est_max_bars

    log.debug(
        "compute_indicators conid=%d timeframe=%r → period=%r bar=%r",
        request.conid,
        request.timeframe,
        ibkr_period,
        ibkr_bar,
    )

    # Step 2: Fetch historical candle data from IBKR
    raw = await ibkr.history(request.conid, period=ibkr_period, bar=ibkr_bar)
    bars = raw.get("data", [])

    # Step 3: Sanity-check bar count against IBKR hard cap
    if len(bars) > IBKR_BAR_LIMIT:
        raise IBKRBarLimitExceededError(
            timeframe=request.timeframe,
            received=len(bars),
            limit=IBKR_BAR_LIMIT,
        )
    if len(bars) > est_max_bars:
        log.warning(
            "Bar count %d for timeframe %r exceeds est_max_bars %d — "
            "IBKR may have changed the step-size table",
            len(bars),
            request.timeframe,
            est_max_bars,
        )

    # Step 4: Convert IBKR bars to our CandleData format
    candles: list[CandleData] = []
    for bar in bars:
        if "t" not in bar:
            continue
        candles.append(CandleData(
            time=bar["t"] // 1000,  # IBKR sends milliseconds, we use seconds
            open=bar["o"],
            high=bar["h"],
            low=bar["l"],
            close=bar["c"],
            volume=bar.get("v", 0),
        ))

    if not candles:
        log.warning(
            "No candle data for conid=%d timeframe=%r (period=%s bar=%s)",
            request.conid,
            request.timeframe,
            ibkr_period,
            ibkr_bar,
        )
        return IndicatorComputeResponse(
            conid=request.conid,
            timeframe=request.timeframe,
            period=ibkr_period,  # deprecated field — echo the IBKR period for compat
            candles=[],
            indicators=[],
            fibonacci=None,
        )

    # Step 5: Compute the requested indicators.
    # Branch 3: preload user-edited fib scoring weights from DB so the
    # composite score reflects whatever the user last saved. Cached for
    # 60s so repeated chart loads don't hammer the settings table.
    fib_weights = await get_active_fib_weights(db)
    indicator_results, fibonacci = _indicator_service.compute(
        candles=candles,
        indicators=request.indicators,
        weights=fib_weights,
    )

    # Step 6: Return everything
    return IndicatorComputeResponse(
        conid=request.conid,
        timeframe=request.timeframe,
        period=ibkr_period,  # deprecated field — echo the IBKR period for compat
        candles=candles,
        indicators=indicator_results,
        fibonacci=fibonacci,
    )
