"""
Market data routes — quotes, candles, and symbol search.
All data comes from IBKR Client Portal via the IBKRService.

Endpoints:
  GET  /market/quote/{conid}     — Full quote snapshot for a single instrument
  GET  /market/candles/{conid}   — Historical OHLCV bars for charting
  GET  /market/search            — Search securities by symbol/name
  GET  /market/conid/{symbol}    — Resolve a ticker to an IBKR conid

Hub integration:
  Both /search and /conid/{symbol} auto-populate the `instruments` cache table.
  This means every instrument Parallax touches gets cached locally.
  MoonMarket and Inflect will read from this cache (by conid) without
  needing their own IBKR search calls.
"""

import datetime
import logging

from fastapi import APIRouter, Depends, Query

from constants import DEFAULT_QUOTE_FIELDS_STR, PERIOD_BAR
from deps import get_db, get_ibkr
from exceptions import SymbolNotFoundError
from services.db import DatabaseService
from services.ibkr import IBKRService, _safe_float

log = logging.getLogger("parallax.routers.market")

router = APIRouter(prefix="/market", tags=["market"])


# ── GET /market/quote/{conid} ────────────────────────────────


@router.get("/quote/{conid}")
async def get_quote(
    conid: int,
    ibkr: IBKRService = Depends(get_ibkr),
    db: DatabaseService = Depends(get_db),
):
    """
    Fetch a full market data snapshot for a single instrument.
    Returns last price, bid/ask, change, high/low, volume, etc.
    """
    raw = await ibkr.snapshot(conids=[conid], fields=DEFAULT_QUOTE_FIELDS_STR)
    if not raw:
        return {"error": "No market data available", "conid": conid}

    data = raw[0]
    symbol = data.get("55", "")
    company_name = data.get("7051", "")

    # Cache instrument metadata if we got symbol info from the snapshot
    if symbol:
        await db.upsert_instrument(
            conid=conid, symbol=symbol, company_name=company_name,
        )

    return {
        "conid": conid,
        "symbol": symbol,
        "companyName": company_name,
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
    db: DatabaseService = Depends(get_db),
):
    """
    Search for securities by symbol or name.
    Returns a list of matches with conid, symbol, company name, and type.

    Hub integration: Every result is cached in the instruments table
    so MoonMarket and Inflect can resolve conid → symbol locally.
    """
    results = await ibkr.search(symbol=q)
    if not results:
        return []

    items = []
    for item in results:
        conid = item.get("conid")
        if not conid:
            continue
        symbol = item.get("symbol", "")
        company_name = item.get("companyHeader", "")
        sec_type = item.get("secType", "")
        items.append({
            "conid": conid,
            "symbol": symbol,
            "companyName": company_name,
            "secType": sec_type,
        })
        # Cache in instruments table (fire-and-forget, don't block response)
        await db.upsert_instrument(
            conid=int(conid), symbol=symbol,
            company_name=company_name, sec_type=sec_type,
        )

    return items


# ── GET /market/conid/{symbol} ───────────────────────────────


_ALLOWED_CONID_SEC_TYPES = {"", "STK", "IND", "BOND"}


@router.get("/conid/{symbol}")
async def resolve_conid(
    symbol: str,
    sec_type: str = Query(
        "",
        description=(
            "Optional IBKR secType hint — one of STK, IND, BOND. "
            "Disambiguates symbols that collide across asset classes "
            "(e.g. GLD as the ARCA ETF vs. HKFE Gold Futures)."
        ),
    ),
    ibkr: IBKRService = Depends(get_ibkr),
    db: DatabaseService = Depends(get_db),
):
    """
    Resolve a ticker symbol to an IBKR conid.
    Used when the frontend needs to translate a symbol into an ID.

    Hub integration: Result is cached in the instruments table.
    """
    hint = sec_type.upper()
    if hint not in _ALLOWED_CONID_SEC_TYPES:
        return {
            "error": f"Invalid sec_type: {sec_type!r}",
            "symbol": symbol,
        }
    try:
        conid = await ibkr.get_conid(symbol, sec_type=hint)
        # Cache the resolution so other Hub modules can look up by conid
        await db.upsert_instrument(conid=conid, symbol=symbol.upper())
        return {"conid": conid, "symbol": symbol.upper()}
    except SymbolNotFoundError:
        return {"error": f"Symbol not found: {symbol}", "symbol": symbol}
