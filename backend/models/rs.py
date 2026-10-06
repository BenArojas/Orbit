from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, PositiveInt


class RSItem(BaseModel):
    conid: int | None = None
    symbol: str
    company_name: str | None = None
    sector: str | None = None
    raw_strength: float | None = None
    published_percentile: int | None = None
    source_price: float | None = None
    avg_volume_50: float | None = None
    source_rank: int


class RSLeadersResponse(BaseModel):
    status: Literal["available", "stale", "unavailable", "verifying"]
    source_revision: str | None = None
    source_published_at: datetime | None = None
    fetched_at: datetime | None = None
    evidence_session: str | None = None
    freshness: Literal["stale", "unknown"]
    eligible_count: int = 0
    items: list[RSItem] = Field(default_factory=list)
    issues: list[str] = Field(default_factory=list)


class RSLeadersSourceResponse(BaseModel):
    phase: Literal["verifying", "unavailable"]
    source_revision: str | None = None
    source_published_at: datetime | None = None
    fetched_at: datetime | None = None
    freshness: Literal["stale", "unknown"] = "unknown"
    eligible_count: int = 0
    issues: list[str] = Field(default_factory=list)


class RSRatingRequest(BaseModel):
    conids: list[PositiveInt] = Field(min_length=1, max_length=250)


class RSRatingItem(BaseModel):
    conid: int
    symbol: str | None = None
    status: Literal["rated", "not_published", "unverified", "source_unavailable"]
    sector: str | None = None
    raw_strength: float | None = None
    published_percentile: int | None = None
    source_price: float | None = None
    avg_volume_50: float | None = None


class RSRatingsResponse(BaseModel):
    status: Literal["available", "stale", "unavailable"]
    source_revision: str | None = None
    source_published_at: datetime | None = None
    evidence_session: str | None = None
    freshness: Literal["stale", "unknown"]
    items: list[RSRatingItem]
