"""
Pydantic models for the Inflect trading-journal module (`/inflect/*`).

Inflect turns raw IBKR executions (the shared `fills` projection) into
round-trip trades via a FIFO matcher, attributes realized P&L to calendar
days, and lets the user annotate each trade with a setup, notes, and tags.

Round-trip trades are derived on demand — never persisted in v1. The only
durable Inflect-owned row is the `JournalEntry` (table `journal_entries`),
keyed by a stable `trade_id` so annotations survive re-derivation.

conid is the Orbit-wide instrument key throughout, per parallax-hub.
"""

from __future__ import annotations

from datetime import date

from constants.inflect import SETUP_OPTIONS
from pydantic import BaseModel, Field
from pydantic import field_validator
from typing import Literal, Optional


# ═══════════════════════════════════════════════════════════════
#  Journal entries (the one persisted Inflect table)
# ═══════════════════════════════════════════════════════════════


class JournalEntry(BaseModel):
    """A user's annotation for one round-trip trade.

    Mirrors the `journal_entries` row. `tags` is a freeform list of
    strings; `setup` is one of the fixed setup-dropdown values (or None).
    """
    trade_id: str
    account_id: str
    conid: int
    setup: Optional[str] = None
    notes: Optional[str] = None
    tags: list[str] = Field(default_factory=list)
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class JournalUpsertRequest(BaseModel):
    """Body for PUT /inflect/trades/{trade_id}/journal."""
    setup: Optional[str] = None
    notes: Optional[str] = None
    tags: list[str] = Field(default_factory=list)

    @field_validator("setup")
    @classmethod
    def _validate_setup(cls, value: str | None) -> str | None:
        if value is None or value in SETUP_OPTIONS:
            return value
        raise ValueError(f"setup must be one of {SETUP_OPTIONS!r} or null")


class InflectSetupsResponse(BaseModel):
    """Response from GET /inflect/setups — the fixed setup vocabulary."""
    setups: list[str]


# ═══════════════════════════════════════════════════════════════
#  Round-trip trades (derived on demand from `fills`)
# ═══════════════════════════════════════════════════════════════


class InflectFill(BaseModel):
    """One constituent execution of a round-trip trade.

    A thin projection of the `fills` row, surfaced in the trade-detail
    view so the user can see exactly which executions made up the trade.
    """
    execution_id: str
    conid: int
    symbol: Optional[str] = None
    side: str                       # "BUY" or "SELL"
    quantity: float
    price: Optional[float] = None
    commission: Optional[float] = None
    net_amount: Optional[float] = None
    multiplier: Optional[float] = None
    sec_type: Optional[str] = None
    trade_time: str
    trade_time_ms: Optional[int] = None


class InflectTrade(BaseModel):
    """A FIFO-derived round-trip trade.

    A trade spans from the first opening lot to the fill that flattens the
    position (qty returns to 0). Partial scale-in/scale-out stays in one
    trade until flat. Still-open positions are reported with status=OPEN,
    no close fields, and no realized P&L (excluded from calendar totals).
    """
    trade_id: str
    account_id: str
    conid: int
    symbol: str = ""
    sec_type: Optional[str] = None
    direction: Literal["LONG", "SHORT", "UNKNOWN"]
    status: Literal["OPEN", "CLOSED", "INCOMPLETE_BASIS"]
    open_time: str
    open_time_ms: int
    close_time: Optional[str] = None
    close_time_ms: Optional[int] = None
    qty: float                              # max absolute size reached
    avg_entry: float
    avg_exit: Optional[float] = None
    gross_pnl: Optional[float] = None       # before commissions
    commissions: float = 0.0
    net_pnl: Optional[float] = None         # gross minus commissions
    return_pct: Optional[float] = None
    multiplier: float = 1.0
    hold_duration_sec: Optional[int] = None
    # R-multiple is deferred to v2 — needs a planned risk/stop we don't
    # capture in v1. Always None; the detail view leaves a slot for it.
    r_multiple: Optional[float] = None
    fills: list[InflectFill] = Field(default_factory=list)
    journal_entry: Optional[JournalEntry] = None


class InflectTradesResponse(BaseModel):
    """Response from GET /inflect/trades."""
    account_id: str
    trades: list[InflectTrade]


class InflectSymbol(BaseModel):
    """One conid/symbol option traded in an Inflect period."""
    conid: int
    symbol: str


class InflectSymbolsResponse(BaseModel):
    """Response from GET /inflect/symbols."""
    account_id: str
    symbols: list[InflectSymbol]


# ═══════════════════════════════════════════════════════════════
#  Calendar aggregation
# ═══════════════════════════════════════════════════════════════


class InflectCalendarDay(BaseModel):
    """Net realized P&L + closed-trade count for one trading day.

    `date` is an ISO YYYY-MM-DD string in US/Eastern (the trading-day
    timezone). Only days with at least one closed trade appear.
    """
    date: str
    net_pnl: float
    trade_count: int


class InflectWeekRollup(BaseModel):
    """One week's rollup for the right rail of the calendar grid."""
    week_index: int                 # 1-based, matches the mock's "Week 1..6"
    net_pnl: float
    trading_days: int               # number of days with closed trades


class InflectCalendarResponse(BaseModel):
    """Response from GET /inflect/calendar."""
    account_id: str
    year: int
    month: int
    days: list[InflectCalendarDay]
    weeks: list[InflectWeekRollup]
    total_net_pnl: float
    days_traded: int


class InflectSyncResponse(BaseModel):
    """Response from POST /inflect/sync — how many fills were upserted."""
    account_id: str
    synced: int


# ═══════════════════════════════════════════════════════════════
#  Basis backfill queue status
# ═══════════════════════════════════════════════════════════════


class InflectBackfillStatusItem(BaseModel):
    """One queued automatic basis-recovery item."""
    account_id: str
    conid: int
    status: Literal[
        "pending",
        "running",
        "resolved",
        "still_needs_basis",
        "failed",
        "rate_limited",
        "max_days_rejected",
    ]
    attempts: int
    days_used: Optional[int] = None
    last_checked_ms: Optional[int] = None
    last_error: Optional[str] = None
    created_at: str
    updated_at: str


class InflectBackfillStatusResponse(BaseModel):
    """Response from GET /inflect/backfill-status."""
    account_id: str
    items: list[InflectBackfillStatusItem]


# ═══════════════════════════════════════════════════════════════
#  Basis audit
# ═══════════════════════════════════════════════════════════════


class BasisAuditEntry(BaseModel):
    """One automatic or manual basis-recovery audit event."""
    id: int
    account_id: str
    conid: int
    action: str
    source: Optional[str] = None
    before_json: Optional[str] = None
    after_json: Optional[str] = None
    created_at: str


class BasisAuditResponse(BaseModel):
    """Response from GET /inflect/basis-audit."""
    account_id: str
    conid: int
    items: list[BasisAuditEntry]


class InflectStorageStatsResponse(BaseModel):
    """Local storage usage for Inflect-owned/relevant tables."""
    file_size_bytes: int
    table_counts: dict[str, int]
    raw_json_bytes: int


class InflectStorageCleanupRequest(BaseModel):
    """Request to clear old raw IBKR payload blobs."""
    before_date: str
    confirm: bool = False

    @field_validator("before_date")
    @classmethod
    def _validate_before_date(cls, value: str) -> str:
        if len(value) != 10:
            raise ValueError("before_date must be YYYY-MM-DD")
        try:
            parsed = date.fromisoformat(value)
        except ValueError as exc:
            raise ValueError("before_date must be YYYY-MM-DD") from exc
        return parsed.isoformat()


class InflectStorageCleanupResponse(BaseModel):
    """Result from POST /inflect/storage/cleanup."""
    before_date: str
    cleared_raw_payloads: int
    deleted_rows: int
    export_recommended: bool
    message: str


# ═══════════════════════════════════════════════════════════════
#  Manual basis lots
# ═══════════════════════════════════════════════════════════════


class BasisLot(BaseModel):
    """A manual starting lot for missing opening basis."""
    id: int
    account_id: str
    conid: int
    side: Literal["LONG", "SHORT"]
    quantity: float
    entry_date: str
    entry_price: float
    commission: Optional[float] = None
    note: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class BasisLotUpsertRequest(BaseModel):
    """Body for POST/PUT /inflect/basis-lots."""
    conid: int
    side: Literal["LONG", "SHORT"]
    quantity: float = Field(gt=0)
    entry_date: str
    entry_price: float = Field(gt=0)
    commission: Optional[float] = Field(default=None, ge=0)
    note: Optional[str] = None

    @field_validator("entry_date")
    @classmethod
    def _validate_entry_date(cls, value: str) -> str:
        if len(value) != 10:
            raise ValueError("entry_date must be YYYY-MM-DD")
        try:
            parsed = date.fromisoformat(value)
        except ValueError as exc:
            raise ValueError("entry_date must be YYYY-MM-DD") from exc
        return parsed.isoformat()
