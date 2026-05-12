"""
Fibonacci routes — locked-drawing persistence + user-editable config.

Locked fibs show on ALL timeframes (per Ofek's spec) and survive
page reloads. Unlocked fibs are ephemeral — recomputed on chart load.

Endpoints:
  POST   /fibonacci/lock           — Lock a fib drawing
  DELETE /fibonacci/lock/{id}      — Unlock (remove) a locked fib
  GET    /fibonacci/locks/{conid}  — List all locked fibs for an instrument
  GET    /fibonacci/config         — Canonical ratios + current scoring weights
  PUT    /fibonacci/config         — Update scoring weights (validated)
"""

import logging

from fastapi import APIRouter, Depends, HTTPException

from deps import get_db
from exceptions import InvalidFibWeightsError
from models import (
    FibConfig,
    LockFibonacciRequest,
    LockedFibonacciResponse,
    UpdateFibConfigRequest,
)
from services.db import DatabaseService
from services.indicators import (
    DEFAULT_FIB_WEIGHTS,
    FIB_EXTENSION_LEVELS,
    FIB_RETRACEMENT_LEVELS,
    invalidate_fib_weights_cache,
)

log = logging.getLogger("parallax.routers.fibonacci")

router = APIRouter(prefix="/fibonacci", tags=["fibonacci"])


# ── Weight validation ────────────────────────────────────────

_WEIGHT_SUM_TOLERANCE = 0.05  # Accept sums in [0.95, 1.05] then normalize.


def _validate_and_normalize_weights(
    weights: dict[str, float],
) -> dict[str, float]:
    """
    Validate a user-submitted weight payload and return a normalized
    copy (sum == 1.0). Raises InvalidFibWeightsError on any rule break.

    Rules (decision 3A in docs/fibonacci-improvements-plan.md):
      - Each factor name must be in DEFAULT_FIB_WEIGHTS (canonical set).
      - Every factor must be present.
      - Each weight must satisfy 0 ≤ w ≤ 1.
      - Sum must be within [1 - tol, 1 + tol]; we then normalize so the
        scorer never has to handle drift.
    """
    canonical = set(DEFAULT_FIB_WEIGHTS.keys())
    received = set(weights.keys())

    unknown = received - canonical
    if unknown:
        raise InvalidFibWeightsError(
            f"Unknown factor name(s): {sorted(unknown)}. "
            f"Allowed: {sorted(canonical)}."
        )

    missing = canonical - received
    if missing:
        raise InvalidFibWeightsError(
            f"Missing factor name(s): {sorted(missing)}."
        )

    coerced: dict[str, float] = {}
    for k, v in weights.items():
        try:
            f = float(v)
        except (TypeError, ValueError) as exc:
            raise InvalidFibWeightsError(
                f"Weight for '{k}' is not a number: {v!r}"
            ) from exc
        if not (0.0 <= f <= 1.0):
            raise InvalidFibWeightsError(
                f"Weight for '{k}' must be between 0 and 1, got {f}."
            )
        coerced[k] = f

    total = sum(coerced.values())
    if not (1.0 - _WEIGHT_SUM_TOLERANCE <= total <= 1.0 + _WEIGHT_SUM_TOLERANCE):
        raise InvalidFibWeightsError(
            f"Sum of weights must be ~1.0 (got {total:.3f}). "
            f"Adjust individual values so the total is within "
            f"{1 - _WEIGHT_SUM_TOLERANCE:.2f}–"
            f"{1 + _WEIGHT_SUM_TOLERANCE:.2f}."
        )
    if total <= 0:
        raise InvalidFibWeightsError("Sum of weights must be positive.")

    # Normalize to exact 1.0 so the scorer's composite math doesn't
    # accumulate drift across many candidates.
    return {k: round(v / total, 6) for k, v in coerced.items()}


# ── GET /fibonacci/config ────────────────────────────────────


@router.get("/config", response_model=FibConfig)
async def get_fib_config(
    db: DatabaseService = Depends(get_db),
) -> FibConfig:
    """
    Return canonical fib ratios + current scoring weights.

    Frontend caches this once per session (staleTime: Infinity) — it
    feeds the glossary panel, the score breakdown explainer, and the
    client-side `buildLevelsFromCandidate` helper.
    """
    weights = await db.get_fib_weights(DEFAULT_FIB_WEIGHTS)
    return FibConfig(
        ratios=list(FIB_RETRACEMENT_LEVELS),
        extension_ratios=list(FIB_EXTENSION_LEVELS),
        weights=weights,
    )


# ── PUT /fibonacci/config ────────────────────────────────────


@router.put("/config", response_model=FibConfig)
async def update_fib_config(
    request: UpdateFibConfigRequest,
    db: DatabaseService = Depends(get_db),
) -> FibConfig:
    """
    Persist user-edited Fibonacci scoring weights.

    Returns the updated FibConfig so the caller can refresh its cache.
    Invalidates the in-memory weight cache in IndicatorService so the
    next fib computation picks up the new values immediately.
    """
    try:
        normalized = _validate_and_normalize_weights(request.weights)
    except InvalidFibWeightsError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    await db.set_fib_weights(normalized)
    invalidate_fib_weights_cache()
    log.info("Fibonacci weights updated by user: %s", normalized)
    return FibConfig(
        ratios=list(FIB_RETRACEMENT_LEVELS),
        extension_ratios=list(FIB_EXTENSION_LEVELS),
        weights=normalized,
    )


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
