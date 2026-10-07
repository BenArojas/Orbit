"""Trigger Rules + Hits + Templates Router — multi-condition edition."""
import logging
from fastapi import APIRouter, Depends, HTTPException, Query

from deps import get_db, get_scanner, require_ibkr_auth
from models import (
    TriggerRuleCreate, TriggerRuleUpdate, TriggerRuleResponse,
    TriggerHitResponse, RuleTemplateResponse, RuleTemplateCreate,
    SnoozeHitRequest, SetupPlanCreate, SetupPlanUpdate, SetupPlanSummary,
    SetupPlanDetail, SetupPlanReviewRequest,
)
from services.db import DatabaseService
from services.ibkr import IBKRService
from services.instrument_identity import InstrumentIdentityService
from services.moonmarket import MoonMarketService
from services.scanner import ScannerService
from exceptions import InstrumentCacheMissError

log = logging.getLogger("parallax.triggers")
router = APIRouter(prefix="/triggers", tags=["triggers"])


async def _setup_plan_scope(ibkr: IBKRService) -> tuple[str, str]:
    """Resolve ownership from IBKR's provider-selected account, never request data."""
    scope = await MoonMarketService(ibkr).selected_account_scope()
    if scope is None:
        raise HTTPException(
            503,
            detail={
                "error": "setup_plan_scope_unavailable",
                "message": "IBKR has not established a selected brokerage account.",
            },
        )
    return scope["account_id"], scope["account_mode"]


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
    try:
        updated = await db.update_trigger_rule(rule_id, **fields)
    except PermissionError as exc:
        raise HTTPException(409, str(exc)) from exc
    if not updated:
        raise HTTPException(404, f"Rule {rule_id} not found")
    return await db.get_trigger_rule(rule_id)


@router.delete("/rules/{rule_id}", status_code=204)
async def delete_rule(rule_id: int, db: DatabaseService = Depends(get_db)):
    try:
        deleted = await db.delete_trigger_rule(rule_id)
    except PermissionError as exc:
        raise HTTPException(409, str(exc)) from exc
    if not deleted:
        raise HTTPException(404, f"Rule {rule_id} not found")


@router.get("/setup-plans", response_model=list[SetupPlanSummary])
async def list_setup_plans(
    db: DatabaseService = Depends(get_db),
    ibkr: IBKRService = Depends(require_ibkr_auth),
):
    owner_account_id, account_mode = await _setup_plan_scope(ibkr)
    return await db.list_setup_plans(owner_account_id, account_mode)


@router.get("/setup-plans/{plan_id}", response_model=SetupPlanDetail)
async def get_setup_plan(
    plan_id: int,
    db: DatabaseService = Depends(get_db),
    ibkr: IBKRService = Depends(require_ibkr_auth),
):
    owner_account_id, account_mode = await _setup_plan_scope(ibkr)
    plan = await db.get_setup_plan(plan_id, owner_account_id, account_mode)
    if plan is None:
        raise HTTPException(404, f"Setup plan {plan_id} not found")
    return plan


@router.post("/setup-plans", response_model=SetupPlanDetail, status_code=201)
async def create_setup_plan(
    body: SetupPlanCreate,
    db: DatabaseService = Depends(get_db),
    ibkr: IBKRService = Depends(require_ibkr_auth),
):
    owner_account_id, account_mode = await _setup_plan_scope(ibkr)
    try:
        instrument = await InstrumentIdentityService(db).get(body.conid)
    except InstrumentCacheMissError as exc:
        raise HTTPException(404, f"Instrument {body.conid} is not verified") from exc
    if str(instrument.get("sec_type", "")).upper() != "STK" or not instrument.get("symbol"):
        raise HTTPException(422, "Setup plans require a verified stock instrument")
    plan_id = await db.create_setup_plan(
        owner_account_id=owner_account_id,
        account_mode=account_mode,
        conid=body.conid,
        symbol=instrument["symbol"],
        setup_type=body.setup_type,
        waiting_intention=body.waiting_intention,
        monitoring_mode=body.monitoring_mode,
        invalidation_reference=body.invalidation_reference,
        invalidation_condition=(
            body.invalidation_condition.model_dump()
            if body.invalidation_condition else None
        ),
        timeframe=body.timeframe,
        scan_interval_seconds=body.scan_interval_seconds,
        conditions=[condition.model_dump() for condition in body.conditions],
    )
    created = await db.get_setup_plan(plan_id, owner_account_id, account_mode)
    if created is None:
        raise HTTPException(500, "Failed to create setup plan")
    return created


@router.patch("/setup-plans/{plan_id}", response_model=SetupPlanDetail)
async def update_setup_plan(
    plan_id: int,
    updates: SetupPlanUpdate,
    db: DatabaseService = Depends(get_db),
    ibkr: IBKRService = Depends(require_ibkr_auth),
):
    owner_account_id, account_mode = await _setup_plan_scope(ibkr)
    fields = updates.model_dump(exclude_unset=True)
    if "conditions" in fields and fields["conditions"] is None:
        raise HTTPException(422, "conditions must be a list; use [] to clear them")
    try:
        updated = await db.update_setup_plan(
            plan_id, owner_account_id, account_mode, fields
        )
    except ValueError as exc:
        status_code = 409 if "archived" in str(exc) else 422
        raise HTTPException(status_code, str(exc)) from exc
    if not updated:
        raise HTTPException(404, f"Setup plan {plan_id} not found")
    return await db.get_setup_plan(plan_id, owner_account_id, account_mode)


@router.post("/setup-plans/{plan_id}/review", response_model=SetupPlanDetail)
async def review_setup_plan(
    plan_id: int,
    body: SetupPlanReviewRequest,
    db: DatabaseService = Depends(get_db),
    ibkr: IBKRService = Depends(require_ibkr_auth),
):
    owner_account_id, account_mode = await _setup_plan_scope(ibkr)
    try:
        reviewed = await db.review_setup_plan_events(
            plan_id, owner_account_id, account_mode, body.evaluation_ids
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    if not reviewed:
        raise HTTPException(404, f"Setup plan {plan_id} not found")
    return await db.get_setup_plan(plan_id, owner_account_id, account_mode)


@router.post("/setup-plans/{plan_id}/archive", response_model=SetupPlanDetail)
async def archive_setup_plan(
    plan_id: int,
    db: DatabaseService = Depends(get_db),
    ibkr: IBKRService = Depends(require_ibkr_auth),
):
    owner_account_id, account_mode = await _setup_plan_scope(ibkr)
    if not await db.archive_setup_plan(plan_id, owner_account_id, account_mode):
        raise HTTPException(404, f"Setup plan {plan_id} not found")
    return await db.get_setup_plan(plan_id, owner_account_id, account_mode)


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
