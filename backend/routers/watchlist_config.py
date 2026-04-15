"""
Watchlist Config Router — Phase 6.8

Per-target-watchlist override for auto-expire. When a trigger rule fires and
its target watchlist has a row here, the override's `auto_expire_days` beats
the rule's own value. This lets a trader say "anything that lands in 'Fast
Setups' expires after 2 days regardless of which rule put it there."

Endpoints:
  GET    /watchlist-config              — list every configured watchlist
  GET    /watchlist-config/{name}       — single row (404 if not configured)
  PUT    /watchlist-config/{name}       — upsert override (auto_expire_days may be null)
  DELETE /watchlist-config/{name}       — remove override (rules fall back to per-rule value)
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from deps import get_db, get_ibkr
from services.db import DatabaseService
from services.ibkr import IBKRService

log = logging.getLogger("parallax.watchlist_config")
router = APIRouter(prefix="/watchlist-config", tags=["watchlist-config"])


class WatchlistConfigUpdate(BaseModel):
    """Body for PUT /watchlist-config/{name}."""
    # None is meaningful: it stores an explicit "no expiry" override. Callers
    # that want to *remove* the override entirely should DELETE instead.
    auto_expire_days: Optional[int] = Field(
        default=None,
        ge=0,
        le=3650,
        description="Days until the stock auto-returns to source. None = no auto-expire.",
    )


class WatchlistConfigResponse(BaseModel):
    name: str
    auto_expire_days: Optional[int] = None
    updated_at: Optional[str] = None


@router.get("", response_model=list[WatchlistConfigResponse])
async def list_watchlist_configs(
    db: DatabaseService = Depends(get_db),
) -> list[dict[str, Any]]:
    """Every configured target watchlist override, alphabetical."""
    return await db.get_all_watchlist_configs()


@router.get("/{name}", response_model=WatchlistConfigResponse)
async def get_single_watchlist_config(
    name: str,
    db: DatabaseService = Depends(get_db),
) -> dict[str, Any]:
    row = await db.get_watchlist_config(name)
    if row is None:
        raise HTTPException(
            status_code=404,
            detail=f"No config row for watchlist '{name}'",
        )
    return row


@router.put("/{name}", response_model=WatchlistConfigResponse)
async def put_watchlist_config(
    name: str,
    body: WatchlistConfigUpdate,
    db: DatabaseService = Depends(get_db),
    ibkr: IBKRService = Depends(get_ibkr),
) -> dict[str, Any]:
    if not name.strip():
        raise HTTPException(status_code=400, detail="Watchlist name cannot be empty")

    # Validate the name actually exists in IBKR so we don't silently store
    # dead overrides that will never apply.
    try:
        wl_id = await ibkr.resolve_watchlist_id(name)
    except Exception:
        wl_id = None  # IBKR unreachable — allow the write but warn
        log.warning(
            "Could not verify watchlist '%s' in IBKR (IBKR may be offline) — saving anyway",
            name,
        )
    else:
        if wl_id is None:
            raise HTTPException(
                status_code=404,
                detail=f"Watchlist '{name}' not found in IBKR. Check the name and try again.",
            )

    await db.upsert_watchlist_config(name, body.auto_expire_days)
    log.info("Watchlist config upserted: name=%s auto_expire_days=%s", name, body.auto_expire_days)
    row = await db.get_watchlist_config(name)
    assert row is not None  # we just wrote it
    return row


@router.delete("/{name}", status_code=204)
async def delete_watchlist_config(
    name: str,
    db: DatabaseService = Depends(get_db),
) -> Response:
    existed = await db.delete_watchlist_config(name)
    if not existed:
        raise HTTPException(
            status_code=404,
            detail=f"No config row for watchlist '{name}'",
        )
    return Response(status_code=204)
