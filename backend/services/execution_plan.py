from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from models.execution_plan import ExecutionPlan, ExecutionPlanDraftRequest
from models.tws_execution_assistant import PaperOrderPreview
from models.tws_order_capabilities import required_price_fields

if TYPE_CHECKING:
    from services.tws_broker_adapter import TwsBrokerAdapter


def _positive(value: float | None) -> bool:
    return value is not None and value > 0


class ExecutionPlanService:
    """Process-local store for execution plan drafts. Lost on backend restart by design."""

    def __init__(self) -> None:
        self._plans: dict[str, ExecutionPlan] = {}

    def create_draft(self, req: ExecutionPlanDraftRequest) -> ExecutionPlan:
        plan = ExecutionPlan(
            plan_id=str(uuid.uuid4()),
            conid=req.conid,
            symbol=req.symbol,
            side=req.side,
            quantity=req.quantity,
            order_type=req.order_type,
            limit_price=req.limit_price,
            stop_price=req.stop_price,
            status="draft",
            validation_errors=[],
            created_at=datetime.now(timezone.utc),
        )
        self._plans[plan.plan_id] = plan
        return plan

    def get(self, plan_id: str) -> ExecutionPlan | None:
        return self._plans.get(plan_id)

    async def validate(self, plan: ExecutionPlan, adapter: TwsBrokerAdapter) -> ExecutionPlan:
        errors: list[str] = []

        if plan.quantity <= 0:
            errors.append("Quantity must be positive.")

        required = required_price_fields(plan.order_type)
        if "limit_price" in required and not _positive(plan.limit_price):
            errors.append(f"{plan.order_type} orders require a positive limit price.")
        if "stop_price" in required and not _positive(plan.stop_price):
            errors.append(f"{plan.order_type} orders require a positive stop price.")

        if not errors:
            sec_type = await adapter.get_sec_type(plan.conid)
            if sec_type is None:
                errors.append(
                    f"Instrument {plan.conid} could not be verified — "
                    "check that TWS is connected and the conid is valid."
                )
            elif sec_type != "STK":
                errors.append(
                    f"Only equities are supported in v1 "
                    f"(conid {plan.conid} is {sec_type})."
                )

        updated = plan.model_copy(update={
            "status": "invalid" if errors else "valid",
            "validation_errors": errors,
        })
        self._plans[plan.plan_id] = updated
        return updated

    def preview_paper(self, plan: ExecutionPlan) -> PaperOrderPreview:
        if plan.status != "valid":
            raise ValueError(f"Plan {plan.plan_id} must be valid before preview (status={plan.status}).")
        return PaperOrderPreview(
            plan_id=plan.plan_id,
            conid=plan.conid,
            symbol=plan.symbol,
            side=plan.side,
            quantity=plan.quantity,
            order_type=plan.order_type,
            limit_price=plan.limit_price,
            stop_price=plan.stop_price,
            tif="DAY",
            transmit=False,
            paper_only=True,
        )
