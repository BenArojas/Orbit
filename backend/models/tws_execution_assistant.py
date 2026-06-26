from typing import Literal

from pydantic import BaseModel

from models.broker_session import BrokerSessionMode

TwsAdapterState = Literal["not_initialized", "connecting", "connected", "disconnected", "error"]


class ReconciliationSummary(BaseModel):
    position_count: int = 0
    open_order_count: int = 0
    unmanaged_order_count: int = 0


class TwsStatusResponse(BaseModel):
    mode: BrokerSessionMode
    connected: bool
    adapter_state: TwsAdapterState
    kill_switch_active: bool
    reconciliation_summary: ReconciliationSummary
