"""
Chart Drawings routes — per-instrument drawing persistence.

Drawings are conid-scoped (project rule 6) and timeframe-agnostic:
anchors are stored as { time: unix_seconds, price } so the vendored
lightweight-charts-drawing library can map them onto any timeframe's
x-axis without adjustment.

Endpoints:
  POST   /drawings              — Create a drawing
  PUT    /drawings/{id}         — Partial update (anchors and/or style)
  DELETE /drawings/{id}         — Delete a drawing
  GET    /drawings/{conid}      — List all drawings for an instrument

Refs: Branch 1 of docs/drawing-tools-plan.md
"""

import json
import logging
import re

from fastapi import APIRouter, Depends, HTTPException

from deps import get_db
from exceptions import InvalidDrawingError
from models import (
    CreateDrawingRequest,
    DrawingResponse,
    UpdateDrawingRequest,
)
from services.db import DatabaseService

log = logging.getLogger("parallax.routers.drawings")

router = APIRouter(prefix="/drawings", tags=["drawings"])

# Valid kind strings — mirrors DrawingToolId in the frontend store.
_VALID_KINDS = frozenset({
    "horizontal_line",
    "trend_line",
    "ray",
    "rectangle",
    "vertical_line",
    "text",
    "long_position",
    "short_position",
    "forecast",
    "bars_pattern",
})

_HEX_COLOR_RE = re.compile(r"^#[0-9A-Fa-f]{3}([0-9A-Fa-f]{3})?$")


# ── Validation helpers ───────────────────────────────────────


def _validate_create(req: CreateDrawingRequest) -> None:
    """Raise InvalidDrawingError if the create payload is invalid."""
    if req.kind not in _VALID_KINDS:
        raise InvalidDrawingError(
            f"Unknown drawing kind {req.kind!r}. "
            f"Allowed: {sorted(_VALID_KINDS)}."
        )
    if not req.anchors:
        raise InvalidDrawingError("anchors must be non-empty.")
    for i, anchor in enumerate(req.anchors):
        if anchor.time <= 0:
            raise InvalidDrawingError(
                f"Anchor {i}: time must be a positive Unix timestamp."
            )
        if not (anchor.price > 0 and anchor.price < 1e9):
            raise InvalidDrawingError(
                f"Anchor {i}: price {anchor.price} is out of range."
            )
    if req.style:
        _validate_style(req.style)


def _validate_style(style) -> None:
    """Validate optional style fields."""
    if style.line_width is not None and not (1 <= style.line_width <= 4):
        raise InvalidDrawingError(
            f"line_width must be 1..4, got {style.line_width}."
        )
    for color_field in ("line_color", "fill_color"):
        color = getattr(style, color_field, None)
        if color is not None and not _HEX_COLOR_RE.match(color):
            raise InvalidDrawingError(
                f"{color_field} must be a hex color (e.g. '#2962FF'), got {color!r}."
            )


def _row_to_response(row: dict) -> DrawingResponse:
    """Convert a raw DB row dict to a DrawingResponse."""
    anchors_data = json.loads(row["anchors_json"])
    style_data = json.loads(row["style_json"]) if row.get("style_json") else None
    return DrawingResponse(
        id=row["id"],
        conid=row["conid"],
        kind=row["kind"],
        anchors=anchors_data,
        style=style_data,
        created_at=row["created_at"],
        updated_at=row.get("updated_at"),
    )


# ── POST /drawings ───────────────────────────────────────────


@router.post("", response_model=DrawingResponse, status_code=201)
async def create_drawing(
    req: CreateDrawingRequest,
    db: DatabaseService = Depends(get_db),
) -> DrawingResponse:
    """
    Persist a new drawing for an instrument.

    The frontend calls this immediately after the user commits a drawing
    on the chart. On success, the returned id is stored alongside the
    drawing in the frontend state (used for updates and deletes).
    """
    try:
        _validate_create(req)
    except InvalidDrawingError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    anchors_json = json.dumps([a.model_dump() for a in req.anchors])
    style_json = req.style.model_dump(exclude_none=True) if req.style else None
    style_json_str = json.dumps(style_json) if style_json is not None else None

    drawing_id = await db.save_drawing(
        conid=req.conid,
        kind=req.kind,
        anchors_json=anchors_json,
        style_json=style_json_str,
    )

    row = await db.get_drawing(drawing_id)
    if row is None:
        raise HTTPException(status_code=500, detail="Drawing was not saved.")

    log.info("Drawing created: id=%d conid=%d kind=%s", drawing_id, req.conid, req.kind)
    return _row_to_response(row)


# ── PUT /drawings/{id} ───────────────────────────────────────


@router.put("/{drawing_id}", response_model=DrawingResponse)
async def update_drawing(
    drawing_id: int,
    req: UpdateDrawingRequest,
    db: DatabaseService = Depends(get_db),
) -> DrawingResponse:
    """
    Partial update — anchors and/or style.

    Either field may be absent; at least one must be present to be
    meaningful (a no-op update is allowed but logged as a warning).
    """
    if req.anchors is None and req.style is None:
        log.warning("update_drawing called with no fields to update (id=%d)", drawing_id)

    existing = await db.get_drawing(drawing_id)
    if existing is None:
        raise HTTPException(status_code=404, detail=f"Drawing {drawing_id} not found.")

    if req.style:
        try:
            _validate_style(req.style)
        except InvalidDrawingError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    anchors_json: str | None = None
    if req.anchors is not None:
        anchors_json = json.dumps([a.model_dump() for a in req.anchors])

    style_json_str: str | None = None
    if req.style is not None:
        existing_style: dict = json.loads(existing["style_json"]) if existing.get("style_json") else {}
        updates = req.style.model_dump(exclude_none=True)
        style_json_str = json.dumps({**existing_style, **updates})

    await db.update_drawing(
        drawing_id=drawing_id,
        anchors_json=anchors_json,
        style_json=style_json_str,
    )

    row = await db.get_drawing(drawing_id)
    assert row is not None
    return _row_to_response(row)


# ── DELETE /drawings/{id} ────────────────────────────────────


@router.delete("/{drawing_id}")
async def delete_drawing(
    drawing_id: int,
    db: DatabaseService = Depends(get_db),
) -> dict:
    """
    Delete a drawing by id.
    Returns 404 if the id does not exist.
    """
    deleted = await db.delete_drawing(drawing_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Drawing {drawing_id} not found.")

    log.info("Drawing deleted: id=%d", drawing_id)
    return {"deleted": True, "id": drawing_id}


# ── GET /drawings/{conid} ────────────────────────────────────


@router.get("/{conid}", response_model=list[DrawingResponse])
async def list_drawings(
    conid: int,
    db: DatabaseService = Depends(get_db),
) -> list[DrawingResponse]:
    """
    Return all drawings for an instrument (by conid), oldest-first.

    The frontend fetches this once on chart load and again whenever a
    drawing is created or deleted (TanStack Query invalidation).
    """
    rows = await db.list_drawings(conid)
    return [_row_to_response(row) for row in rows]
