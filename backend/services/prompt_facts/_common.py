"""Shared threshold helpers used by every fact builder.

Imported via `from services.prompt_facts._common import is_near, ...`.
Builders MUST NOT inline these thresholds — keep them centralized so
the v2 learning algorithm can tune them in one place.
"""
from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Literal, Optional

_GROUNDING_CENT = Decimal("0.01")


def quantize_ground_price(value: float) -> Decimal:
    """Quantize a price to cents for grounding.

    The single source of truth for grounding precision: the renderer formats
    candidates from this, the grounding map is built from this, so the price a
    model sees is always exactly the price the validator allows.
    """
    return Decimal(str(value)).quantize(_GROUNDING_CENT, rounding=ROUND_HALF_UP)


def is_near(price: float, level: float, atr: Optional[float] = None) -> bool:
    """ATR-aware 'is price near this level' check.

    Primary rule: within 0.25 * ATR.
    Fallback (when ATR is missing or zero): within 0.5% of price.
    """
    if atr is not None and atr > 0:
        return abs(price - level) <= 0.25 * atr
    if price == 0:
        return False
    return abs(price - level) / price <= 0.005


_RisingMode = Literal["momentum", "slow"]


def _clean(values: list[Optional[float]]) -> list[float]:
    return [v for v in values if v is not None]


def is_rising_n(
    values: list[Optional[float]],
    n: int = 3,
    mode: _RisingMode = "momentum",
) -> bool:
    """True if `values` has been rising over the last `n` step-diffs.

    momentum mode (default for RSI / MACD hist / Stoch): N=3, requires net
    slope > 0 AND >= ceil(n/2) of the step-diffs same sign as the slope.
    Tolerates one noisy bar.

    slow mode (ADX, OBV slope, BBand-width percentile): looser — just
    net slope > 0 over n bars.

    Computing `n` step-diffs requires n+1 points; with fewer, returns False.
    """
    clean = _clean(values)
    if len(clean) < n + 1:
        return False
    window = clean[-(n + 1):]
    net = window[-1] - window[0]
    if mode == "slow":
        return net > 0
    diffs = [window[i + 1] - window[i] for i in range(n)]
    same_sign = sum(1 for d in diffs if d > 0)
    return net > 0 and same_sign >= (n + 1) // 2


def is_falling_n(
    values: list[Optional[float]],
    n: int = 3,
    mode: _RisingMode = "momentum",
) -> bool:
    """Symmetric counterpart to is_rising_n.

    Computing `n` step-diffs requires n+1 points; with fewer, returns False.
    """
    clean = _clean(values)
    if len(clean) < n + 1:
        return False
    window = clean[-(n + 1):]
    net = window[-1] - window[0]
    if mode == "slow":
        return net < 0
    diffs = [window[i + 1] - window[i] for i in range(n)]
    same_sign = sum(1 for d in diffs if d < 0)
    return net < 0 and same_sign >= (n + 1) // 2


# Recency lookback per displayed timeframe, counted in true bars of that
# timeframe (resolved via TIMEFRAME_SPEC in constants/ibkr_history.py — 1H/4H
# are real 1h/4h bars, not resampled finer candles).
_RECENCY_WINDOWS: dict[str, int] = {
    "1H": 7,
    "4H": 3,
    "D":   5,
    "W":   5,
    "M":   5,
}


def recent_cross(
    values_a: list[Optional[float]],
    values_b: list[Optional[float]],
    timeframe: str,
) -> tuple[bool, int]:
    """Did `values_a` cross `values_b` within the timeframe's recency window?

    Both input series must have the same length (aligned to the same candle
    stream). Raises ValueError otherwise.

    Returns (True, bars_ago) on cross, (False, -1) otherwise.
    bars_ago counts back from the most recent bar (most recent bar is 0).
    """
    if len(values_a) != len(values_b):
        raise ValueError(
            f"recent_cross requires equal-length inputs, "
            f"got len(values_a)={len(values_a)} and len(values_b)={len(values_b)}"
        )
    window = _RECENCY_WINDOWS.get(timeframe, 5)
    n = len(values_a)
    if n < 2:
        return False, -1
    a = values_a
    b = values_b
    start = max(1, n - window)
    for i in range(n - 1, start - 1, -1):
        a_now, a_prev = a[i], a[i - 1]
        b_now, b_prev = b[i], b[i - 1]
        if None in (a_now, a_prev, b_now, b_prev):
            continue
        # Cross occurs when sign of (a - b) flips between i-1 and i.
        # Semantics:
        #   prev <= 0 and now > 0   → up-cross (a was at/below b, is now strictly above)
        #   prev >= 0 and now < 0   → down-cross (a was at/above b, is now strictly below)
        # Note: prev == 0 and now == 0 is NOT a cross (no flip in sign), which is
        #   the desired behavior — two flat-equal bars don't constitute a crossing.
        prev_diff = a_prev - b_prev
        now_diff = a_now - b_now
        if (prev_diff <= 0 and now_diff > 0) or (prev_diff >= 0 and now_diff < 0):
            return True, (n - 1 - i)
    return False, -1


def percentile_rank(
    value: float,
    history: list[Optional[float]],
    lookback: int = 100,
) -> float:
    """Percentile of `value` against the last `lookback` non-None entries.

    Returns a float in [0, 1). The value is the fraction of `history` entries
    strictly less than `value`. The maximum of the history yields `(len-1)/len`,
    not 1.0.
    """
    clean = _clean(history)
    if not clean:
        return 0.0
    sample = clean[-lookback:]
    below = sum(1 for v in sample if v < value)
    return below / len(sample)
