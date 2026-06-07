"""
Market data routes — quotes, candles, and symbol search.
All data comes from IBKR Client Portal via the IBKRService.

Endpoints:
  GET  /market/quote/{conid}     — Full quote snapshot for a single instrument
  GET  /market/quotes            — Bundled snapshot for many conids in one call
  GET  /market/candles/{conid}   — Historical OHLCV bars for charting (single)
  GET  /market/candles           — Bundled historical candles for many conids
  GET  /market/search            — Search securities by symbol/name
  GET  /market/conid/{symbol}    — Resolve a ticker to an IBKR conid

See also:
  GET  /instruments/{conid}      — Read cached instrument metadata (see routers/instruments.py)

Orbit integration:
  Both /search and /conid/{symbol} auto-populate the `instruments` cache table.
  This means every instrument Parallax touches gets cached locally.
  MoonMarket and Inflect will read from this cache (by conid) without
  needing their own IBKR search calls.
"""

import datetime
import logging

from fastapi import APIRouter, Depends, Query

from constants import DEFAULT_QUOTE_FIELDS_STR, PERIOD_BAR
from deps import get_db, get_ibkr, get_instrument_identity
from exceptions import SymbolNotFoundError
from services.db import DatabaseService
from services.ibkr import IBKRService, _safe_float
from services.instrument_identity import InstrumentIdentityService

log = logging.getLogger("parallax.routers.market")

router = APIRouter(prefix="/market", tags=["market"])


# ── GET /market/quote/{conid} ────────────────────────────────


@router.get("/quote/{conid}")
async def get_quote(
    conid: int,
    ibkr: IBKRService = Depends(get_ibkr),
    identity: InstrumentIdentityService = Depends(get_instrument_identity),
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

    await identity.cache_snapshot_identity(conid, data)

    return {
        "conid": conid,
        "symbol": symbol,
        "companyName": company_name,
        "lastPrice": _safe_float(data.get("31")),
        "bid": _safe_float(data.get("84")),
        "ask": _safe_float(data.get("86")),
        "bidSize": _safe_float(data.get("88")),
        "askSize": _safe_float(data.get("85")),
        "open": _safe_float(data.get("7295")),
        "high": _safe_float(data.get("70")),
        "low": _safe_float(data.get("71")),
        "previousClose": _safe_float(data.get("7741")),
        "changePercent": _safe_float(data.get("83")),
        "changeAmount": _safe_float(data.get("82")),
        "volume": _safe_float(data.get("7762")),
    }


# ── GET /market/quotes ───────────────────────────────────────


def _format_quote_row(conid: int, data: dict) -> dict:
    """Shape one snapshot row into the same fields as /market/quote/{conid}."""
    return {
        "conid": conid,
        "symbol": data.get("55", ""),
        "companyName": data.get("7051", ""),
        "lastPrice": _safe_float(data.get("31")),
        "bid": _safe_float(data.get("84")),
        "ask": _safe_float(data.get("86")),
        "bidSize": _safe_float(data.get("88")),
        "askSize": _safe_float(data.get("85")),
        "open": _safe_float(data.get("7295")),
        "high": _safe_float(data.get("70")),
        "low": _safe_float(data.get("71")),
        "previousClose": _safe_float(data.get("7741")),
        "changePercent": _safe_float(data.get("83")),
        "changeAmount": _safe_float(data.get("82")),
        "volume": _safe_float(data.get("7762")),
    }


@router.get("/quotes")
async def get_quotes(
    conids: str = Query(..., description="Comma-separated IBKR conids, e.g. 1,2,3"),
    ibkr: IBKRService = Depends(get_ibkr),
):
    """
    Bundled market-data snapshot for many conids in a single request.

    The dashboard mounts MarketPulse + Watchlist + Trigger panels which
    historically each fired their own /market/quote/:id calls. This
    endpoint collapses that fan-out: the frontend builds one conid list
    and gets all quotes back via one HTTP round-trip.

    Internally `IBKRService.snapshot()` chunks at 50 conids per IBKR
    call (Phase 8 / Task 2.1), pre-flights cold conids, and coalesces
    concurrent identical batches.

    Response shape: {"items": [<quote>, ...]} — each quote is the same
    shape as GET /market/quote/{conid}.
    """
    raw_list = [c.strip() for c in conids.split(",") if c.strip()]
    parsed: list[int] = []
    for raw in raw_list:
        try:
            parsed.append(int(raw))
        except ValueError:
            return {
                "error": f"Invalid conid: {raw!r} — must be integer",
                "items": [],
            }
    if not parsed:
        return {"items": []}

    rows = await ibkr.snapshot(conids=parsed, fields=DEFAULT_QUOTE_FIELDS_STR)

    # Index IBKR rows by conid so the response order matches the
    # request order (gather() preserves chunk order, but within IBKR's
    # response a chunk row could theoretically come back out of order).
    by_conid: dict[int, dict] = {}
    for row in rows:
        rc = row.get("conid")
        try:
            if rc is not None:
                by_conid[int(rc)] = row
        except (TypeError, ValueError):
            continue

    items = [
        _format_quote_row(c, by_conid.get(c, {})) for c in parsed
    ]
    return {"items": items}


# ── GET /market/candles/{conid} and /market/candles ──────────


def _resolve_period(period: str) -> tuple[str, str] | dict:
    """Map a frontend period label to (ibkr_period, ibkr_bar).

    Returns a dict with an 'error' key on invalid input so callers can
    short-circuit with a sensible HTTP response.
    """
    if period == "YTD":
        today = datetime.date.today()
        days = (today - datetime.date(today.year, 1, 1)).days + 1
        return (f"{days}d", "1d")
    if period in PERIOD_BAR:
        return PERIOD_BAR[period]
    return {
        "error": (
            f"Invalid period: {period}. "
            f"Use one of: {', '.join(PERIOD_BAR.keys())}, YTD"
        )
    }


@router.get("/candles")
async def get_candles_bundled(
    conids: str = Query(..., description="Comma-separated IBKR conids, e.g. 1,2,3"),
    period: str = Query("1M", description="Time period: 1D, 5D, 1M, 3M, 6M, 1Y, 5Y, YTD"),
    ibkr: IBKRService = Depends(get_ibkr),
):
    """
    Bundled historical candles for many conids in one request.

    The backend fans out to one /iserver/marketdata/history call per conid,
    bounded by IBKR's 5-concurrent cap (IBKRService._history_semaphore).
    On 429, per-conid retries honor Retry-After (up to 3 attempts). One
    conid failure never cancels the others.

    Response shape:
        {
            "items": [{"conid": int, "candles": [TradingView bar, ...]}, ...],
            "errors": {conid: error_message, ...}
        }
    """
    raw_list = [c.strip() for c in conids.split(",") if c.strip()]
    parsed: list[int] = []
    for raw in raw_list:
        try:
            parsed.append(int(raw))
        except ValueError:
            return {
                "error": f"Invalid conid: {raw!r} — must be integer",
                "items": [],
                "errors": {},
            }
    if not parsed:
        return {"items": [], "errors": {}}

    resolved = _resolve_period(period)
    if isinstance(resolved, dict):
        return {**resolved, "items": [], "errors": {}}
    ibkr_period, ibkr_bar = resolved

    return await ibkr.history_bundled(parsed, period=ibkr_period, bar=ibkr_bar)


@router.get("/candles/{conid}")
async def get_candles(
    conid: int,
    period: str = Query("1M", description="Time period: 1D, 5D, 1M, 3M, 6M, 1Y, 5Y, YTD"),
    ibkr: IBKRService = Depends(get_ibkr),
):
    """
    Fetch historical OHLCV candle data for charting (single conid).
    Period determines both the timespan and bar size.
    Returns data formatted for TradingView Lightweight Charts.
    """
    resolved = _resolve_period(period)
    if isinstance(resolved, dict):
        return resolved
    ibkr_period, ibkr_bar = resolved

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

    Orbit integration: Every result is cached in the instruments table
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

    Orbit integration: Result is cached in the instruments table.
    """
    hint = sec_type.upper()
    if hint not in _ALLOWED_CONID_SEC_TYPES:
        return {
            "error": f"Invalid sec_type: {sec_type!r}",
            "symbol": symbol,
        }
    try:
        conid = await ibkr.get_conid(symbol, sec_type=hint)

        # Try to get company_name from IBKR search results so the instrument
        # cache is fully populated for useInstrument() to display after search.
        company_name = ""
        try:
            search_results = await ibkr.search(symbol=symbol)
            for item in search_results:
                item_conid = item.get("conid")
                if item_conid and int(item_conid) == conid:
                    company_name = item.get("companyHeader", "")
                    break
        except Exception:
            pass  # company_name enrichment is best-effort

        await db.upsert_instrument(
            conid=conid,
            symbol=symbol.upper(),
            company_name=company_name,
        )
        return {
            "conid": conid,
            "symbol": symbol.upper(),
            "companyName": company_name,
        }
    except SymbolNotFoundError:
        return {"error": f"Symbol not found: {symbol}", "symbol": symbol}
