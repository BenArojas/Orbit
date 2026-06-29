from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from models.tws_order_capabilities import TwsOrderType

ExecutionPlanStatus = Literal["draft", "valid", "invalid"]


class ExecutionPlanDraftRequest(BaseModel):
    conid: int
    symbol: str  # display only — secType verified against IBKR via TWS adapter
    side: Literal["BUY", "SELL"]
    quantity: float
    order_type: TwsOrderType
    limit_price: float | None = None
    stop_price: float | None = None


class ExecutionPlan(BaseModel):
    plan_id: str
    conid: int
    symbol: str
    side: Literal["BUY", "SELL"]
    quantity: float
    order_type: TwsOrderType
    limit_price: float | None
    stop_price: float | None
    status: ExecutionPlanStatus
    validation_errors: list[str]
    created_at: datetime
