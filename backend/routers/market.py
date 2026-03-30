"""
Market data routes — quotes, candles, and symbol search.
All data comes from IBKR Client Portal via the IBKRService.

Endpoints:
  GET  /market/quote/{conid}     — Full quote snapshot for a single instrument
  GET  /market/candles/{conid}   — Historical OHLCV bars for charting
  GET  /market/search            — Search securities by symbol/name
  GET  /market/conid/{symbol}    — Resolve a ticker to an IBKR conid
"""

import datetime
import logging

from fastapi import APIRouter, Depends, Query

from constants import DEFAULT_QUOTE_FIELDS_STR, PERIOD_BAR
from deps import get_ibkr
from exceptions import SymbolNotFoundError
from services.ibkr import IBKRService, _safe_float

log = logging.getLogger("parallax.routers.market")

router = APIRouter(prefix="/market", tags=["market"])


# ── GET /market/quote/{conid} ────────────────────────────────


@router.get("/quote/{conid}")
async def get_quote(conid: int, ibkr: IBKRService = Depends(get_ibkr)):
    """
    Fetch a full market data snapshot for a single instrument.
    Returns last price, bid/ask, change, high/low, volume, etc.
    """
    raw = await ibkr.snapshot(conids=[conid], fields=DEFAULT_QUOTE_FIELDS_STR)
    if not raw:
        return {"error": "No market data available", "conid": conid}

    data = raw[0]
    return {
        "conid": conid,
        "symbol": data.get("55", ""),
        "companyName": data.get("7051", ""),
        "lastPrice": _safe_float(data.get("31")),
        "bid": _safe_float(data.get("84")),
        "ask": _safe_float(data.get("86")),
        "open": _safe_float(data.get("7295")),
        "high": _safe_float(data.get("70")),
        "low": _safe_float(data.get("71")),
        "previousClose": _safe_float(data.get("7741")),
        "changePercent": _safe_float(data.get("83")),
        "changeAmount": _safe_float(data.get("82")),
        "volume": _safe_float(data.get("7762")),
    }


# ── GET /market/candles/{conid} ──────────────────────────────


@router.get("/candles/{conid}")
async def get_candles(
    conid: int,
    period: str = Query("1M", description="Time period: 1D, 5D, 1M, 3M, 6M, 1Y, 5Y, YTD"),
    ibkr: IBKRService = Depends(get_ibkr),
):
    """
    Fetch historical OHLCV candle data for charting.
    Period determines both the timespan and bar size.
    Returns data formatted for TradingView Lightweight Charts.
    """
    # Handle YTD as a dynamic period
    if period == "YTD":
        today = datetime.date.today()
        start_of_year = datetime.date(today.year, 1, 1)
        days = (today - start_of_year).days + 1
        ibkr_period = f"{days}d"
        ibkr_bar = "1d"
    elif period in PERIOD_BAR:
        ibkr_period, ibkr_bar = PERIOD_BAR[period]
    else:
        return {"error": f"Invalid period: {period}. Use one of: {', '.join(PERIOD_BAR.keys())}, YTD"}

    raw = await ibkr.history(conid, period=ibkr_period, bar=ibkr_bar)
    bars = raw.get("data", [])

    # Transform to TradingView Lightweight Charts format
    return [
        {
            "time": bar["t"] // 1000,  # IBKR sends ms, charts want seconds
            "open": bar["o"],
            "high": bar["h"],
            "low": bar["l"],
            "close": bar["c"],
            "volume": bar.get("v", 0),
        }
        for bar in bars
        if "t" in bar
    ]


# ── GET /market/search ───────────────────────────────────────


@router.get("/search")
async def search_securities(
    q: str = Query(..., description="Symbol or company name to search"),
    ibkr: IBKRService = Depends(get_ibkr),
):
    """
    Search for securities by symbol or name.
    Returns a list of matches with conid, symbol, company name, and type.
    """
    results = await ibkr.search(symbol=q)
    if not results:
        return []

    return [
        {
            "conid": item.get("conid"),
            "symbol": item.get("symbol"),
            "companyName": item.get("companyHeader", ""),
            "secType": item.get("secType", ""),
        }
        for item in results
        if item.get("conid")
    ]


# ── GET /market/conid/{symbol} ───────────────────────────────


@router.get("/conid/{symbol}")
async def resolve_conid(
    symbol: str,
    ibkr: IBKRService = Depends(get_ibkr),
):
    """
    Resolve a ticker symbol to an IBKR conid.
    Used when the frontend needs to translate a symbol into an ID.
    """
    try:
        conid = await ibkr.get_conid(symbol)
        return {"conid": conid, "symbol": symbol.upper()}
    except SymbolNotFoundError:
        return {"error": f"Symbol not found: {symbol}", "symbol": symbol}
