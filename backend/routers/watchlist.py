"""
Watchlist routes — IBKR watchlist sync.

Watchlists are managed entirely in IBKR (not stored locally).
We fetch them fresh each time — IBKR is the source of truth.

Endpoints:
  GET  /watchlist/lists                         — List all IBKR watchlists
  GET  /watchlist/{watchlist_id}/instruments    — Instruments only (fast, no snapshot)
  GET  /watchlist/{watchlist_id}/quotes         — Live quotes for a set of conids

Phase 8.9 / Commit C split:
  The old single endpoint `GET /watchlist/{id}` bundled instruments AND
  market data snapshots in the same call. On watchlist switch this meant
  the sidebar skeleton blocked for ~1-8s while IBKR polled for quotes.
  We now split the work so names/company render immediately and quotes
  stream in as a second query.
"""

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Query

from constants import DEFAULT_QUOTE_FIELDS_STR
from deps import get_db, get_ibkr
from exceptions import IBKRAuthError, IBKRConnectionError, IBKRRateLimitError, IBKRRequestError
from models import WatchlistAddRequest
from services.db import DatabaseService
from services.ibkr import IBKRService, _safe_float

log = logging.getLogger("parallax.routers.watchlist")

router = APIRouter(prefix="/watchlist", tags=["watchlist"])


# Keep the per-request snapshot batch aligned with IBKR's practical limit.
# IBKR's /iserver/marketdata/snapshot handles ~50 conids comfortably before
# latency climbs.
_SNAPSHOT_BATCH_SIZE = 50


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
        if isinstance(wl, dict) and wl.get("id")
    ]


@router.get("/membership")
async def get_watchlist_membership(
    conid: int = Query(..., description="IBKR contract ID to look up"),
    ibkr: IBKRService = Depends(get_ibkr),
):
    """
    Return all watchlist IDs that contain the given conid.
    Checks every watchlist concurrently via asyncio.gather.
    """
    all_watchlists = await ibkr.get_watchlists()

    async def _check(wl: dict) -> str | None:
        wl_id = str(wl.get("id", ""))
        if not wl_id:
            return None
        try:
            items = await ibkr.get_watchlist_items(wl_id)
        except Exception as exc:
            log.warning("membership check failed for watchlist=%s: %s", wl_id, exc)
            return None
        for item in items:
            if isinstance(item, dict):
                raw = item.get("C") or item.get("conid")
                try:
                    if raw and int(raw) == conid:
                        return wl_id
                except (TypeError, ValueError):
                    pass
        return None

    results = await asyncio.gather(
        *[_check(wl) for wl in all_watchlists if isinstance(wl, dict)],
    )
    return {
        "conid": conid,
        "watchlist_ids": [r for r in results if r is not None],
    }


@router.post("/{watchlist_id}/instruments")
async def add_watchlist_instrument(
    watchlist_id: str,
    body: WatchlistAddRequest,
    ibkr: IBKRService = Depends(get_ibkr),
):
    """
    Add a conid to an IBKR watchlist.
    Returns {added: bool, conid: int} — added=False means it was already present.
    """
    all_watchlists = await ibkr.get_watchlists()
    watchlist_name = next(
        (wl.get("name", "") for wl in all_watchlists
         if isinstance(wl, dict) and str(wl.get("id", "")) == watchlist_id),
        None,
    )
    if watchlist_name is None:
        raise HTTPException(status_code=404, detail=f"Watchlist {watchlist_id!r} not found")

    added = await ibkr.add_to_watchlist(watchlist_id, watchlist_name, body.conid)
    return {"added": added, "conid": body.conid}


@router.delete("/{watchlist_id}/instruments/{conid}")
async def remove_watchlist_instrument(
    watchlist_id: str,
    conid: int,
    ibkr: IBKRService = Depends(get_ibkr),
):
    """
    Remove a conid from an IBKR watchlist.
    Returns {removed: bool, conid: int} — removed=False means it wasn't present.
    """
    all_watchlists = await ibkr.get_watchlists()
    watchlist_name = next(
        (wl.get("name", "") for wl in all_watchlists
         if isinstance(wl, dict) and str(wl.get("id", "")) == watchlist_id),
        None,
    )
    if watchlist_name is None:
        raise HTTPException(status_code=404, detail=f"Watchlist {watchlist_id!r} not found")

    removed = await ibkr.remove_from_watchlist(watchlist_id, watchlist_name, conid)
    return {"removed": removed, "conid": conid}


@router.get("/{watchlist_id}/instruments")
async def get_watchlist_instruments(
    watchlist_id: str,
    ibkr: IBKRService = Depends(get_ibkr),
    db: DatabaseService = Depends(get_db),
):
    """
    Fetch instruments in a specific IBKR watchlist WITHOUT market data.
    Returns symbol, companyName, and conid only — fast (no snapshot poll).

    The frontend uses this to paint watchlist rows immediately on switch,
    then calls GET /watchlist/{id}/quotes to backfill prices.
    """
    all_watchlists = await ibkr.get_watchlists()
    watchlist_name = ""
    for wl in all_watchlists:
        if isinstance(wl, dict) and str(wl.get("id", "")) == watchlist_id:
            watchlist_name = wl.get("name", "")
            break

    raw_instruments = await ibkr.get_watchlist_items(watchlist_id)
    if not raw_instruments:
        return {"id": watchlist_id, "name": watchlist_name, "items": []}

    log.debug(
        "[watchlist] %s: %d raw instruments", watchlist_id, len(raw_instruments)
    )

    items: list[dict] = []
    for inst in raw_instruments:
        if not isinstance(inst, dict):
            # IBKR occasionally injects bare strings (section headers)
            # into instrument lists — skip them rather than crash.
            continue

        raw_conid = inst.get("conid") or inst.get("C")
        if not raw_conid:
            continue
        try:
            conid = int(raw_conid)
        except (TypeError, ValueError):
            continue

        symbol = inst.get("symbol", "") or inst.get("SYM", "") or inst.get("ticker", "")
        company_name = inst.get("name", "") or inst.get("N", "") or inst.get("companyHeader", "")

        items.append({
            "conid": conid,
            "symbol": symbol,
            "companyName": company_name,
        })

        # Cache in instruments table (Hub sharing). Doesn't block — upsert
        # is fire-and-go; a failed row doesn't prevent us returning the list.
        if symbol:
            try:
                await db.upsert_instrument(
                    conid=conid, symbol=symbol, company_name=company_name,
                )
            except Exception as exc:  # pragma: no cover - defensive, shouldn't happen
                log.warning("instrument cache failed for conid=%s: %s", conid, exc)

    return {"id": watchlist_id, "name": watchlist_name, "items": items}


@router.get("/{watchlist_id}/quotes")
async def get_watchlist_quotes(
    watchlist_id: str,  # noqa: ARG001 — reserved for future per-watchlist auth
    conids: str = Query(..., description="Comma-separated list of conids"),
    ibkr: IBKRService = Depends(get_ibkr),
):
    """
    Fetch live quote snapshots for a pre-known list of conids.
    Called by the frontend after /instruments to backfill prices.

    The `watchlist_id` is part of the path purely for locality with
    /instruments — snapshots themselves are watchlist-agnostic.
    """
    # Parse + validate conids once up front.
    parsed: list[int] = []
    for raw in conids.split(","):
        raw = raw.strip()
        if not raw:
            continue
        try:
            parsed.append(int(raw))
        except ValueError:
            continue

    if not parsed:
        return {"items": []}

    items: list[dict] = []
    for i in range(0, len(parsed), _SNAPSHOT_BATCH_SIZE):
        batch = parsed[i:i + _SNAPSHOT_BATCH_SIZE]
        snapshot_map: dict[int, dict] = {}

        try:
            snapshots = await ibkr.snapshot(
                conids=batch,
                fields=DEFAULT_QUOTE_FIELDS_STR,
            )
            for snap in snapshots:
                c = snap.get("conid")
                if c is None:
                    continue
                try:
                    snapshot_map[int(c)] = snap
                except (TypeError, ValueError):
                    continue
        except IBKRAuthError:
            log.warning("Auth error fetching watchlist quotes — session may have expired")
            raise
        except IBKRRateLimitError:
            log.warning("Rate-limited fetching watchlist quotes")
            raise
        except (IBKRConnectionError, IBKRRequestError) as exc:
            log.warning("Failed to fetch watchlist quotes batch: %s", exc)
            # Fall through with empty snapshot_map — the UI shows `--` for
            # this batch rather than failing the whole request.

        for conid in batch:
            snap = snapshot_map.get(conid, {})
            items.append({
                "conid": conid,
                "lastPrice": _safe_float(snap.get("31")),
                "changePercent": _safe_float(snap.get("83")),
                "changeAmount": _safe_float(snap.get("82")),
            })

    return {"items": items}
