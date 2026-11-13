"""Displayable quote quality. Receipt times are not exchange trade times."""

from datetime import datetime, timezone
import math

QUOTE_MAX_AGE_SECONDS = 5.0

# D54: fresh live and streaming-delayed quotes may authorize entries (the UI
# labels delayed data); frozen, delayed-frozen, and unknown types may not.
ENTRY_ELIGIBLE_TYPES = frozenset({"live", "delayed"})


def quote_quality(
    received_at: datetime | None, market_data_type: str,
    bid: float | None, ask: float | None, *, now: datetime | None = None,
) -> dict:
    current = now or datetime.now(timezone.utc)
    age = None
    if received_at is not None and received_at.tzinfo is not None:
        age = (current - received_at).total_seconds()
    valid_age = age is not None and 0 <= age <= QUOTE_MAX_AGE_SECONDS
    valid_prices = (
        bid is not None and ask is not None and math.isfinite(bid)
        and math.isfinite(ask) and 0 < bid <= ask
    )
    eligible = market_data_type in ENTRY_ELIGIBLE_TYPES and valid_age and valid_prices

    return {
        "received_at": received_at if age is not None else None,
        "age_seconds": age,
        "freshness": "fresh" if valid_age else ("stale" if age is not None else "unknown"),
        "entry_data_eligible": bool(eligible),
    }
