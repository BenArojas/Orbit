"""
Pulse Config Router — Phase 8.9+

Exposes the user-configurable Market Pulse ticker list.

The pulse bar at the top of the dashboard shows up to ~15 instruments.
This router lets the frontend read / replace / reset that list.

conid resolution is deliberately NOT done here — we store ticker
strings (`resolve`) and let /market/conid handle the lookup at
query time. This keeps the config portable across paper/live accounts
and avoids stale conids when the user edits the bar.

Endpoints:
  GET   /pulse-config        → list (in display order)
  PUT   /pulse-config        → replace full list
  POST  /pulse-config/reset  → restore DEFAULT_PULSE_ITEMS
"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from deps import get_db
from services.db import DatabaseService

log = logging.getLogger("parallax.pulse_config")
router = APIRouter(prefix="/pulse-config", tags=["pulse-config"])


# Keep these modest so a user can't shove 200 tickers into the bar
# (each ticker triggers 3 IBKR queries — breaks the stagger budget).
MAX_ITEMS = 20
MAX_LABEL_LEN = 16
MAX_RESOLVE_LEN = 16


class PulseItem(BaseModel):
    """One ticker row on the pulse bar."""
    label: str = Field(..., min_length=1, max_length=MAX_LABEL_LEN)
    resolve: str = Field(..., min_length=1, max_length=MAX_RESOLVE_LEN)


class PulseConfigResponse(BaseModel):
    items: list[PulseItem]


class PulseConfigUpdate(BaseModel):
    """Body for PUT /pulse-config — replaces the full list."""
    items: list[PulseItem] = Field(..., max_length=MAX_ITEMS)


def _rows_to_items(rows: list[dict]) -> list[PulseItem]:
    """Strip `position` — the list's index is already the order."""
    return [PulseItem(label=r["label"], resolve=r["resolve"]) for r in rows]


@router.get("", response_model=PulseConfigResponse)
async def get_pulse_config(db: DatabaseService = Depends(get_db)) -> PulseConfigResponse:
    """Return the pulse bar in display order."""
    rows = await db.get_pulse_config()
    return PulseConfigResponse(items=_rows_to_items(rows))


@router.put("", response_model=PulseConfigResponse)
async def put_pulse_config(
    body: PulseConfigUpdate,
    db: DatabaseService = Depends(get_db),
) -> PulseConfigResponse:
    """Replace the pulse-bar list atomically. Empty list is allowed (hides the bar)."""
    # Reject obvious duplicates up front — SQLite position-pkey wouldn't catch
    # this since we re-index on every write, and two "SPY" rows on the bar
    # would just issue the same 3 IBKR queries twice.
    labels = [item.label for item in body.items]
    if len(set(labels)) != len(labels):
        raise HTTPException(
            status_code=400,
            detail="Duplicate labels in pulse config",
        )

    pairs = [(item.label, item.resolve) for item in body.items]
    await db.replace_pulse_config(pairs)
    log.info("Pulse config replaced (%d items)", len(pairs))
    rows = await db.get_pulse_config()
    return PulseConfigResponse(items=_rows_to_items(rows))


@router.post("/reset", response_model=PulseConfigResponse)
async def reset_pulse_config(
    db: DatabaseService = Depends(get_db),
) -> PulseConfigResponse:
    """Restore the built-in default ticker list."""
    rows = await db.reset_pulse_config()
    log.info("Pulse config reset to defaults (%d items)", len(rows))
    return PulseConfigResponse(items=_rows_to_items(rows))
