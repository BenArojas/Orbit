"""
Fibonacci lock routes — persist fib drawings across app restarts.

Locked fibs show on ALL timeframes (per Ofek's spec) and survive
page reloads. Unlocked fibs are ephemeral — recomputed on chart load.

Endpoints:
  POST   /fibonacci/lock         — Lock a fib drawing
  DELETE /fibonacci/lock/{id}    — Unlock (remove) a locked fib
  GET    /fibonacci/locks/{conid} — List all locked fibs for an instrument
"""

import logging

from fastapi import APIRouter, Depends, HTTPException

from deps import get_db
from models import LockFibonacciRequest, LockedFibonacciResponse
from services.db import DatabaseService

log = logging.getLogger("parallax.routers.fibonacci")

router = APIRouter(prefix="/fibonacci", tags=["fibonacci"])


# ── POST /fibonacci/lock ─────────────────────────────────────

@router.post("/lock", response_model=LockedFibonacciResponse)
async def lock_fibonacci(
    request: LockFibonacciRequest,
    db: DatabaseService = Depends(get_db),
) -> LockedFibonacciResponse:
    """
    Lock a fib drawing so it persists across restarts.

    If the exact same swing is already locked (same conid + timeframe +
    tool_type + timestamps), returns the existing lock without error.
    """
    lock_id = await db.save_locked_fib(
        conid=request.conid,
        timeframe=request.timeframe,
        tool_type=request.tool_type,
        swing_high_price=request.swing_high_price,
        swing_high_time=request.swing_high_time,
        swing_low_price=request.swing_low_price,
        swing_low_time=request.swing_low_time,
        direction=request.direction,
        user_note=request.user_note,
    )
    row = await db.get_locked_fib(lock_id)
    if row is None:
        raise HTTPException(status_code=500, detail="Failed to retrieve locked fib after save")
    return LockedFibonacciResponse(**row)


# ── DELETE /fibonacci/lock/{id} ──────────────────────────────

@router.delete("/lock/{lock_id}")
async def unlock_fibonacci(
    lock_id: int,
    db: DatabaseService = Depends(get_db),
) -> dict:
    """Unlock (remove) a locked fib drawing."""
    deleted = await db.delete_locked_fib(lock_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Locked fib {lock_id} not found")
    return {"deleted": True, "id": lock_id}


# ── GET /fibonacci/locks/{conid} ─────────────────────────────

@router.get("/locks/{conid}", response_model=list[LockedFibonacciResponse])
async def list_locked_fibs(
    conid: int,
    db: DatabaseService = Depends(get_db),
) -> list[LockedFibonacciResponse]:
    """
    List all locked fibs for an instrument.

    Locked fibs show on ALL timeframes, so the frontend needs to
    fetch them once per instrument, not per timeframe.
    """
    rows = await db.list_locked_fibs(conid)
    return [LockedFibonacciResponse(**row) for row in rows]
