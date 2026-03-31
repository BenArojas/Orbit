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

from constants import PERIOD_BAR
from deps import get_ibkr
from models import (
    CandleData,
    IndicatorComputeResponse,
    IndicatorRequest,
)
from services.ibkr import IBKRService
from services.indicators import IndicatorService

log = logging.getLogger("parallax.routers.indicators")

router = APIRouter(prefix="/indicators", tags=["indicators"])

# The indicator service is stateless — one instance is fine for the whole app
_indicator_service = IndicatorService()


# ── POST /indicators/compute ─────────────────────────────────


@router.post("/compute", response_model=IndicatorComputeResponse)
async def compute_indicators(
    request: IndicatorRequest,
    ibkr: IBKRService = Depends(get_ibkr),
):
    """
    Compute technical indicators for a given stock.

    The frontend sends:
      - conid: which stock (IBKR's unique ID)
      - period: how much history to use ("1D", "5D", "1M", "3M", etc.)
      - indicators: which indicators to compute (["rsi", "macd", "ema_50", ...])

    The backend:
      1. Fetches historical candle data from IBKR
      2. Runs the requested indicators through pandas-ta
      3. Returns everything in one response (candles + indicator values + fibonacci)

    This way the frontend gets all the data it needs in a single API call
    instead of making separate requests for each indicator.
    """
    # Step 1: Figure out which IBKR period/bar to use
    if request.period in PERIOD_BAR:
        ibkr_period, ibkr_bar = PERIOD_BAR[request.period]
    else:
        ibkr_period, ibkr_bar = "3m", "1d"  # Sensible fallback

    # Step 2: Fetch historical candle data from IBKR
    raw = await ibkr.history(request.conid, period=ibkr_period, bar=ibkr_bar)
    bars = raw.get("data", [])

    # Step 3: Convert IBKR bars to our CandleData format
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
        log.warning("No candle data for conid %d (period=%s)", request.conid, request.period)
        return IndicatorComputeResponse(
            conid=request.conid,
            period=request.period,
            candles=[],
            indicators=[],
            fibonacci=None,
        )

    # Step 4: Compute the requested indicators
    indicator_results, fibonacci = _indicator_service.compute(
        candles=candles,
        indicators=request.indicators,
    )

    # Step 5: Return everything
    return IndicatorComputeResponse(
        conid=request.conid,
        period=request.period,
        candles=candles,
        indicators=indicator_results,
        fibonacci=fibonacci,
    )
