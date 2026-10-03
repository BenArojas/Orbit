from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class MarketInstrumentEvidence(BaseModel):
    symbol: str
    name: str | None = None
    conid: int | None = None
    session_date: str | None = None
    close: float | None = None
    ema21: float | None = None
    sma50: float | None = None
    sma200: float | None = None
    trend: Literal["constructive", "weak", "mixed"] | None = None
    above_sma50: bool | None = None
    unavailable_reason: str | None = None


class MarketParticipation(BaseModel):
    total: int = 11
    available: int
    missing: int
    confirmed_above: int
    possible_above_min: int
    possible_above_max: int


class PreviousMarketAssessment(BaseModel):
    posture: Literal["broad", "selective", "defensive"]
    evidence_session: str
    calculated_at: str


class MarketAssessmentResponse(BaseModel):
    status: Literal["complete", "partial", "incomplete"]
    posture: Literal["broad", "selective", "defensive"] | None
    expected_session: str | None
    evidence_session: str | None
    calculated_at: str
    indices: list[MarketInstrumentEvidence]
    sectors: list[MarketInstrumentEvidence]
    participation: MarketParticipation
    issues: list[str]
    previous_assessment: PreviousMarketAssessment | None = None
    next_reconcile_at: str | None = None
    market_open: bool = False
