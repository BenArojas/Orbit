"""
Instruments cache routes — read the local SQLite instrument cache.

Endpoints:
  GET  /instruments/{conid}  — Fetch a cached instrument record by conid

The instruments table is populated automatically whenever any market
endpoint resolves or searches for a symbol (search, conid resolution,
quote fetch). This endpoint lets the frontend retrieve symbol + company
name without needing to hit IBKR again.

Hub integration: All Hub modules (Parallax, MoonMarket, Inflect) write
to and read from this same cache, keyed by conid.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException

from deps import get_db
from services.db import DatabaseService

log = logging.getLogger("parallax.routers.instruments")

router = APIRouter(prefix="/instruments", tags=["instruments"])


@router.get("/{conid}")
async def get_instrument(
    conid: int,
    db: DatabaseService = Depends(get_db),
):
    """
    Fetch a cached instrument record by conid.

    Returns the symbol, company name, and sec type from the local SQLite
    cache. Returns 404 if the instrument has not been cached yet (i.e. the
    user has never resolved or searched for this conid in this session).

    This is a read-only, local-only endpoint — it never hits IBKR.
    """
    instrument = await db.get_instrument(conid)
    if instrument is None:
        raise HTTPException(
            status_code=404,
            detail=f"Instrument conid={conid} not found in local cache",
        )
    return instrument
