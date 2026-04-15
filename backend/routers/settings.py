"""
Settings Router — Phase 6.5

Exposes the `settings` key/value table over HTTP so the frontend can
toggle global preferences without poking SQLite directly.

Endpoints:
  GET    /settings                 — list all settings (key → value)
  GET    /settings/{key}           — single setting (404 if missing)
  PUT    /settings/{key}           — upsert a setting
"""

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from deps import get_db
from services.db import DatabaseService

log = logging.getLogger("parallax.settings")
router = APIRouter(prefix="/settings", tags=["settings"])


_ALLOWED_SETTINGS: frozenset[str] = frozenset({
    "scan_interval_seconds",
    "default_timeframe",
    "default_period",
    "notifications_enabled",
})


class SettingUpdate(BaseModel):
    """Body for PUT /settings/{key} — a single value string."""
    value: str


@router.get("")
async def get_all_settings(db: DatabaseService = Depends(get_db)) -> dict[str, Any]:
    """Return every row in the settings table as {key: value}."""
    return await db.get_all_settings()


@router.get("/{key}")
async def get_setting(key: str, db: DatabaseService = Depends(get_db)) -> dict[str, Any]:
    """Return a single setting. 404 if the key is not present."""
    value = await db.get_setting(key)
    if value is None:
        raise HTTPException(status_code=404, detail=f"Setting '{key}' not found")
    return {"key": key, "value": value}


@router.put("/{key}")
async def put_setting(
    key: str,
    body: SettingUpdate,
    db: DatabaseService = Depends(get_db),
) -> dict[str, Any]:
    """Upsert a single setting. Only known setting keys are accepted."""
    if key not in _ALLOWED_SETTINGS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown setting '{key}'. Allowed: {sorted(_ALLOWED_SETTINGS)}",
        )
    await db.set_setting(key, body.value)
    log.info("Setting '%s' updated to '%s'", key, body.value)
    return {"key": key, "value": body.value}
