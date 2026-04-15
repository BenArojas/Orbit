"""
Trigger Rules & Hits Router — Phase 3 (tasks 3.6, 3.7) + Phase 6 (scanner status)

CRUD endpoints for trigger rules, read access to trigger hits, and scanner status.
The frontend dashboard sidebar uses these to display and manage trigger rules.

Endpoints:
  GET    /triggers/rules              — list all trigger rules
  POST   /triggers/rules              — create a new trigger rule
  PATCH  /triggers/rules/{id}         — update a trigger rule
  DELETE /triggers/rules/{id}         — delete a trigger rule
  GET    /triggers/hits               — list recent trigger hits
  POST   /triggers/hits/{id}/ack      — acknowledge a trigger hit
  POST   /triggers/hits/ack-all       — acknowledge all unread hits
  GET    /triggers/scanner/status     — background scanner status
"""

import logging
from fastapi import APIRouter, Depends, HTTPException

from deps import get_db, get_scanner
from models import (
    TriggerRuleCreate,
    TriggerRuleUpdate,
    TriggerRuleResponse,
    TriggerHitResponse,
)
from services.db import DatabaseService
from services.scanner import ScannerService

log = logging.getLogger("parallax.triggers")
router = APIRouter(prefix="/triggers", tags=["triggers"])


# ── Trigger Rules ───────────────────────────────────────────


@router.get("/rules", response_model=list[TriggerRuleResponse])
async def list_trigger_rules(db: DatabaseService = Depends(get_db)):
    """
    Get all trigger rules, newest first.
    Used by the sidebar to show the compact rule list + LED indicators.
    """
    rows = await db.get_trigger_rules(enabled_only=False)
    return rows


@router.post("/rules", response_model=TriggerRuleResponse, status_code=201)
async def create_trigger_rule(
    rule: TriggerRuleCreate,
    db: DatabaseService = Depends(get_db),
):
    """
    Create a new trigger rule.

    The frontend sends: name, symbol, conid, indicator, condition, threshold,
    source_watchlist, target_watchlist, timeframe, auto_expire_days.

    Returns the full rule object including its new ID.
    """
    rule_id = await db.create_trigger_rule(
        name=rule.name,
        conid=rule.conid,
        symbol=rule.symbol,
        indicator=rule.indicator,
        condition=rule.condition,
        threshold=rule.threshold,
        target_watchlist=rule.target_watchlist,
        source_watchlist=rule.source_watchlist,
        timeframe=rule.timeframe,
        auto_expire_days=rule.auto_expire_days,
        scan_interval_seconds=rule.scan_interval_seconds,
        news_candle_method=rule.news_candle_method,
    )

    # Fetch the newly created rule to return it
    created = await db.get_trigger_rule(rule_id)
    if not created:
        raise HTTPException(status_code=500, detail="Failed to create trigger rule")

    log.info("Created trigger rule %d: %s (%s %s %s)", rule_id, rule.name, rule.indicator, rule.condition, rule.threshold)
    return created


@router.patch("/rules/{rule_id}", response_model=TriggerRuleResponse)
async def update_trigger_rule(
    rule_id: int,
    updates: TriggerRuleUpdate,
    db: DatabaseService = Depends(get_db),
):
    """
    Update one or more fields on a trigger rule.
    Only the fields you send are changed — everything else stays the same.

    Most common use: toggling enabled/disabled from the LED dot.
    """
    # Build the update dict from only the fields that were actually sent
    update_fields = updates.model_dump(exclude_unset=True)
    if not update_fields:
        raise HTTPException(status_code=400, detail="No fields to update")

    success = await db.update_trigger_rule(rule_id, **update_fields)
    if not success:
        raise HTTPException(status_code=404, detail=f"Trigger rule {rule_id} not found")

    updated = await db.get_trigger_rule(rule_id)
    if not updated:
        raise HTTPException(status_code=404, detail=f"Trigger rule {rule_id} not found")

    log.info("Updated trigger rule %d: %s", rule_id, update_fields)
    return updated


@router.delete("/rules/{rule_id}", status_code=204)
async def delete_trigger_rule(
    rule_id: int,
    db: DatabaseService = Depends(get_db),
):
    """
    Delete a trigger rule and all its associated hit history.
    (CASCADE delete handles the hits automatically in SQLite.)
    """
    success = await db.delete_trigger_rule(rule_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"Trigger rule {rule_id} not found")

    log.info("Deleted trigger rule %d", rule_id)
    return None


# ── Trigger Hits ────────────────────────────────────────────


@router.get("/hits", response_model=list[TriggerHitResponse])
async def list_trigger_hits(
    limit: int = 50,
    db: DatabaseService = Depends(get_db),
):
    """
    Get recent trigger hits (newest first).
    Used by the TriggerWatchlist component to show stocks that have been flagged.
    """
    rows = await db.get_trigger_hits(limit=limit)
    return rows


@router.post("/hits/{hit_id}/ack", status_code=204)
async def acknowledge_hit(
    hit_id: int,
    db: DatabaseService = Depends(get_db),
):
    """
    Mark a single trigger hit as acknowledged (user has seen it).
    The hit remains visible in the log but is no longer highlighted as new.
    """
    success = await db.acknowledge_trigger_hit(hit_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"Trigger hit {hit_id} not found")
    return None


@router.post("/hits/ack-all", status_code=200)
async def acknowledge_all_hits(db: DatabaseService = Depends(get_db)):
    """Mark all unacknowledged trigger hits as read."""
    count = await db.acknowledge_all_hits()
    return {"acknowledged": count}


# ── Scanner Status ───────────────────────────────────────────


@router.get("/scanner/status")
async def scanner_status(scanner: ScannerService = Depends(get_scanner)):
    """
    Background scanner health — is it running, what's the interval,
    when did it last complete a cycle?
    Used by the frontend to show scanner state in the dashboard.
    """
    return scanner.status()
