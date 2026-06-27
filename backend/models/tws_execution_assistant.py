from typing import Literal

from pydantic import BaseModel

from models.broker_session import BrokerSessionMode


class TwsConnectRequest(BaseModel):
    host: str = "127.0.0.1"
    port: int = 4002  # IB Gateway paper default; TWS paper is 7497
    client_id: int = 1

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
    api_server_available: bool = False  # TCP-reachable; True even before Orbit's adapter connects


class PositionSnapshot(BaseModel):
    conid: int
    symbol: str
    position: float
    avg_cost: float


class OrderSnapshot(BaseModel):
    order_id: int
    conid: int
    symbol: str
    side: str
    quantity: float
    order_type: str
    lmt_price: float | None = None
    status: str
    is_unmanaged: bool


class ReconciliationSnapshot(BaseModel):
    position_count: int = 0
    open_order_count: int = 0
    unmanaged_order_count: int = 0
    positions: list[PositionSnapshot] = []
    open_orders: list[OrderSnapshot] = []


class InstrumentResult(BaseModel):
    conid: int
    symbol: str
    sec_type: str
    exchange: str
    primary_exchange: str
    currency: str
    local_symbol: str


MarketDataType = Literal[
    "unknown",
    "live",
    "frozen",
    "delayed",
    "delayed_frozen",
    "unavailable",
]


class QuoteSnapshot(BaseModel):
    last: float | None = None
    close: float | None = None
    open: float | None = None
    high: float | None = None
    low: float | None = None
    bid: float | None = None
    ask: float | None = None
    market_data_type: MarketDataType = "unknown"
    is_delayed: bool = False
    unavailable_reason: str | None = None
    error_code: int | None = None
