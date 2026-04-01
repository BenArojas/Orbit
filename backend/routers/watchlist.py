"""
Watchlist routes — IBKR watchlist sync.

Watchlists are managed entirely in IBKR (not stored locally).
We fetch them fresh each time — IBKR is the source of truth.

Endpoints:
  GET  /watchlist/lists                — List all IBKR watchlists
  GET  /watchlist/{watchlist_id}       — Get instruments in a watchlist with live quotes
"""

import asyncio
import logging

from fastapi import APIRouter, Depends, Query

from constants import DEFAULT_QUOTE_FIELDS_STR
from deps import get_db, get_ibkr
from services.db import DatabaseService
from services.ibkr import IBKRService, _safe_float

log = logging.getLogger("parallax.routers.watchlist")

router = APIRouter(prefix="/watchlist", tags=["watchlist"])


@router.get("/lists")
async def get_watchlists(
    ibkr: IBKRService = Depends(get_ibkr),
):
    """
    List all IBKR watchlists for the authenticated user.
    Returns [{id, name}, ...].
    """
    raw = await ibkr.get_watchlists()
    return [
        {"id": str(wl.get("id", "")), "name": wl.get("name", "Unnamed")}
        for wl in raw
        if wl.get("id")
    ]


@router.get("/{watchlist_id}")
async def get_watchlist_items(
    watchlist_id: str,
    ibkr: IBKRService = Depends(get_ibkr),
    db: DatabaseService = Depends(get_db),
):
    """
    Fetch instruments in a specific IBKR watchlist, enriched with live quotes.

    Steps:
      1. Get the instrument list from IBKR watchlist API
      2. Extract conids
      3. Fetch market data snapshots for all conids
      4. Return combined data
    """
    instruments = await ibkr.get_watchlist_items(watchlist_id)
    if not instruments:
        return {"id": watchlist_id, "name": "", "items": []}

    # Extract conids from instruments
    conids = []
    instrument_map: dict[int, dict] = {}
    for inst in instruments:
        # IBKR watchlist instruments can have different structures
        conid = inst.get("conid") or inst.get("C")
        if conid:
            conid = int(conid)
            conids.append(conid)
            instrument_map[conid] = inst

    if not conids:
        return {"id": watchlist_id, "name": "", "items": []}

    # Fetch live quotes for all conids in one snapshot call
    # IBKR can handle up to ~50 conids per snapshot
    items = []
    batch_size = 50
    for i in range(0, len(conids), batch_size):
        batch = conids[i:i + batch_size]
        try:
            snapshots = await ibkr.snapshot(
                conids=batch,
                fields=DEFAULT_QUOTE_FIELDS_STR,
                timeout=8.0,
            )
            snapshot_map = {s.get("conid"): s for s in snapshots if s.get("conid")}
        except Exception as exc:
            log.warning("Failed to fetch snapshots for watchlist batch: %s", exc)
            snapshot_map = {}

        for conid in batch:
            snap = snapshot_map.get(conid, {})
            inst = instrument_map.get(conid, {})

            symbol = snap.get("55", "") or inst.get("symbol", "") or inst.get("SYM", "")
            company_name = snap.get("7051", "") or inst.get("name", "") or inst.get("N", "")

            # Cache in instruments table for Hub sharing
            if symbol:
                await db.upsert_instrument(
                    conid=conid, symbol=symbol, company_name=company_name,
                )

            items.append({
                "conid": conid,
                "symbol": symbol,
                "companyName": company_name,
                "lastPrice": _safe_float(snap.get("31")),
                "changePercent": _safe_float(snap.get("83")),
                "changeAmount": _safe_float(snap.get("82")),
            })

    return {
        "id": watchlist_id,
        "name": "",  # IBKR doesn't return the name from the items endpoint
        "items": items,
    }
