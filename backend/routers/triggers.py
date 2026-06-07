"""Trigger Rules + Hits + Templates Router — multi-condition edition."""
import logging
from fastapi import APIRouter, Depends, HTTPException, Query

from deps import get_db, get_scanner
from models import (
    TriggerRuleCreate, TriggerRuleUpdate, TriggerRuleResponse,
    TriggerHitResponse, RuleTemplateResponse, RuleTemplateCreate,
    SnoozeHitRequest,
)
from services.db import DatabaseService
from services.scanner import ScannerService

log = logging.getLogger("parallax.triggers")
router = APIRouter(prefix="/triggers", tags=["triggers"])


@router.get("/rules", response_model=list[TriggerRuleResponse])
async def list_rules(db: DatabaseService = Depends(get_db)):
    return await db.get_trigger_rules(enabled_only=False)


@router.post("/rules", response_model=TriggerRuleResponse, status_code=201)
async def create_rule(rule: TriggerRuleCreate, db: DatabaseService = Depends(get_db)):
    rule_id = await db.create_trigger_rule(
        name=rule.name,
        watchlist_name=rule.watchlist_name,
        conid=rule.conid,
        symbol=rule.symbol,
        template_id=rule.template_id,
        ibkr_mirror_target=rule.ibkr_mirror_target,
        timeframe=rule.timeframe,
        scan_interval_seconds=rule.scan_interval_seconds,
        enabled=rule.enabled,
        conditions=[c.model_dump() for c in rule.conditions],
    )
    created = await db.get_trigger_rule(rule_id)
    if not created:
        raise HTTPException(500, "Failed to create rule")
    return created


@router.patch("/rules/{rule_id}", response_model=TriggerRuleResponse)
async def update_rule(rule_id: int, updates: TriggerRuleUpdate,
                     db: DatabaseService = Depends(get_db)):
    fields = updates.model_dump(exclude_unset=True)
    if fields.get("conditions"):
        fields["conditions"] = [
            c if isinstance(c, dict) else c.model_dump()
            for c in fields["conditions"]
        ]
    if not fields:
        raise HTTPException(400, "No fields to update")
    if not await db.update_trigger_rule(rule_id, **fields):
        raise HTTPException(404, f"Rule {rule_id} not found")
    return await db.get_trigger_rule(rule_id)


@router.delete("/rules/{rule_id}", status_code=204)
async def delete_rule(rule_id: int, db: DatabaseService = Depends(get_db)):
    if not await db.delete_trigger_rule(rule_id):
        raise HTTPException(404, f"Rule {rule_id} not found")


@router.get("/hits", response_model=list[TriggerHitResponse])
async def list_hits(
    limit: int = 200,
    status: str = Query("active", pattern="^(active|dismissed|snoozed|all)$"),
    watchlist: str | None = None,
    db: DatabaseService = Depends(get_db),
):
    return await db.get_trigger_hits(limit=limit, status=status, watchlist=watchlist)


@router.post("/hits/{hit_id}/dismiss", status_code=204)
async def dismiss_hit(hit_id: int, db: DatabaseService = Depends(get_db)):
    if not await db.dismiss_trigger_hit(hit_id):
        raise HTTPException(404, f"Hit {hit_id} not found")


@router.post("/hits/{hit_id}/snooze", status_code=204)
async def snooze_hit(hit_id: int, body: SnoozeHitRequest,
                     db: DatabaseService = Depends(get_db)):
    if body.duration_minutes <= 0:
        raise HTTPException(400, "duration_minutes must be > 0")
    if not await db.snooze_trigger_hit(hit_id, body.duration_minutes):
        raise HTTPException(404, f"Hit {hit_id} not found")


@router.get("/tags")
async def get_tags(conids: str = Query(...),
                   db: DatabaseService = Depends(get_db)):
    try:
        parsed = [int(c) for c in conids.split(",") if c.strip()]
    except ValueError:
        raise HTTPException(400, "conids must be comma-separated integers")
    return await db.get_active_tags(parsed)


@router.get("/templates", response_model=list[RuleTemplateResponse])
async def list_templates(db: DatabaseService = Depends(get_db)):
    return await db.list_rule_templates()


@router.post("/templates", response_model=RuleTemplateResponse, status_code=201)
async def create_template(tpl: RuleTemplateCreate, db: DatabaseService = Depends(get_db)):
    tpl_id = await db.create_rule_template(
        name=tpl.name, description=tpl.description, category=tpl.category,
        default_timeframe=tpl.default_timeframe,
        conditions=[c.model_dump() for c in tpl.conditions],
    )
    found = next((t for t in await db.list_rule_templates() if t["id"] == tpl_id), None)
    if not found:
        raise HTTPException(500, "Failed to create template")
    return found


@router.delete("/templates/{template_id}", status_code=204)
async def delete_template(template_id: int, db: DatabaseService = Depends(get_db)):
    if not await db.delete_rule_template(template_id):
        raise HTTPException(404, f"Template {template_id} not found or is builtin")


@router.get("/scanner/status")
async def scanner_status(scanner: ScannerService = Depends(get_scanner)):
    return scanner.status()
