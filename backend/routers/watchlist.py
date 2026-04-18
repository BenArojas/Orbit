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

import logging

from fastapi import APIRouter, Depends, Query

from constants import DEFAULT_QUOTE_FIELDS_STR
from deps import get_db, get_ibkr
from exceptions import IBKRAuthError, IBKRConnectionError, IBKRRateLimitError, IBKRRequestError
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

    # TEMP diagnostic log — remove once watchlist field names are confirmed.
    log.info(
        "[watchlist] raw instruments count=%d first=%s",
        len(raw_instruments),
        raw_instruments[0] if raw_instruments else None,
    )

    items: list[dict] = []
    for inst in raw_instruments:
        if not isinstance(inst, dict):
            # IBKR occasionally injects bare strings (section headers)
            # into instrument lists — skip them rather than crash.
            continue
        # TEMP diagnostic log — one line per instrument so we can see
        # the exact key names IBKR is using. Remove with the first log.
        log.info("[watchlist] raw inst=%s", inst)

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
                timeout=8.0,
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
