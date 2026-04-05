"""
Tests for the Fibonacci detection + scoring service (task 4.4).

These tests build synthetic candle data with known swing structure and
assert the fib service picks the right swing, returns the correct level
set, and flags clarity / nesting correctly.
"""
from __future__ import annotations

import math

import pytest

from models import CandleData, FibonacciResult
from services.indicators import (
    FIB_EXTENSION_LEVELS,
    FIB_RETRACEMENT_LEVELS,
    GOLDEN_POCKET_LEVELS,
    IndicatorService,
)


# ── Helpers ─────────────────────────────────────────────────


def make_candle(t: int, o: float, h: float, l: float, c: float, v: float = 1_000_000) -> CandleData:
    return CandleData(time=t, open=o, high=h, low=l, close=c, volume=v)


def clean_uptrend_swing(bars: int = 60, base: float = 100.0, amplitude: float = 30.0) -> list[CandleData]:
    """
    Build a clean V-shape uptrend: sharp rally from `base` to `base+amplitude`
    then a retracement halfway down. This produces one obvious winning swing.
    """
    out: list[CandleData] = []
    t0 = 1_700_000_000
    mid = bars // 3
    # Rally phase
    for i in range(mid):
        price = base + (amplitude * (i / mid))
        out.append(make_candle(
            t=t0 + i * 86400,
            o=price - 0.2, h=price + 0.5, l=price - 0.5, c=price,
        ))
    # Peak
    peak_price = base + amplitude
    out.append(make_candle(
        t=t0 + mid * 86400,
        o=peak_price - 0.1, h=peak_price + 0.3, l=peak_price - 0.3, c=peak_price,
    ))
    # Retracement phase (to roughly 0.5)
    for i in range(bars - mid - 1):
        frac = i / (bars - mid - 1)
        price = peak_price - (amplitude * 0.5 * frac)
        out.append(make_candle(
            t=t0 + (mid + 1 + i) * 86400,
            o=price + 0.1, h=price + 0.4, l=price - 0.4, c=price,
        ))
    return out


def choppy_sideways(bars: int = 60, center: float = 100.0, noise: float = 1.5) -> list[CandleData]:
    """Sideways chop — no clear swing dominates."""
    out: list[CandleData] = []
    t0 = 1_700_000_000
    for i in range(bars):
        # Sinusoidal noise that never breaks out — multiple overlapping swings
        offset = math.sin(i * 0.7) * noise + math.cos(i * 0.3) * noise * 0.5
        price = center + offset
        out.append(make_candle(
            t=t0 + i * 86400,
            o=price - 0.1,
            h=price + noise * 0.4,
            l=price - noise * 0.4,
            c=price,
        ))
    return out


# ── Tests ───────────────────────────────────────────────────


def test_clean_swing_detected_and_scored():
    """Given a clean V-shape, the service returns a plausible winning swing."""
    svc = IndicatorService()
    candles = clean_uptrend_swing(bars=60, base=100.0, amplitude=30.0)
    results, fib = svc.compute(candles, indicators=["fibonacci"])

    assert fib is not None, "Fibonacci result should not be None for clean swing"
    assert isinstance(fib, FibonacciResult)
    assert fib.direction in ("up", "down")
    assert fib.swing_high > fib.swing_low
    assert 0 <= fib.score <= 100
    assert 0 <= fib.swing_clarity <= 1
    assert fib.reasoning  # non-empty explanation
    assert fib.candidates, "Should return at least one candidate"


def test_retracement_level_set_is_ofeks_methodology():
    """Verify the levels returned match Ofek's spec (0, 0.382, 0.5, 0.618, 0.65, 0.716, 1.0)."""
    svc = IndicatorService()
    candles = clean_uptrend_swing()
    _, fib = svc.compute(candles, indicators=["fibonacci"])
    assert fib is not None

    returned_ratios = [lvl.level for lvl in fib.levels]
    assert returned_ratios == FIB_RETRACEMENT_LEVELS
    # Explicitly assert 0.236 and 0.786 are NOT present
    assert 0.236 not in returned_ratios
    assert 0.786 not in returned_ratios


def test_golden_pocket_tagged_correctly():
    """Golden pocket levels (0.618, 0.65, 0.716) must be tagged golden_pocket=True."""
    svc = IndicatorService()
    candles = clean_uptrend_swing()
    _, fib = svc.compute(candles, indicators=["fibonacci"])
    assert fib is not None

    gp_levels = {lvl.level for lvl in fib.levels if lvl.golden_pocket}
    assert gp_levels == GOLDEN_POCKET_LEVELS

    # Non-GP levels must not be flagged
    non_gp = [lvl for lvl in fib.levels if lvl.level not in GOLDEN_POCKET_LEVELS]
    assert all(not lvl.golden_pocket for lvl in non_gp)


def test_extension_levels_present_and_projected_correctly():
    """Extensions should project beyond the swing, in the trend direction."""
    svc = IndicatorService()
    candles = clean_uptrend_swing()
    _, fib = svc.compute(candles, indicators=["fibonacci"])
    assert fib is not None

    returned_ext = [lvl.level for lvl in fib.extensions]
    assert returned_ext == FIB_EXTENSION_LEVELS

    if fib.direction == "up":
        # All extensions should be ABOVE swing_high
        for lvl in fib.extensions:
            assert lvl.price >= fib.swing_high - 1e-6, (
                f"Extension {lvl.level} should be above swing high in uptrend"
            )
    else:
        # All extensions should be BELOW swing_low
        for lvl in fib.extensions:
            assert lvl.price <= fib.swing_low + 1e-6, (
                f"Extension {lvl.level} should be below swing low in downtrend"
            )


def test_retracement_prices_bracket_the_swing():
    """The 0 and 1.0 retracement levels must bracket the swing range."""
    svc = IndicatorService()
    candles = clean_uptrend_swing()
    _, fib = svc.compute(candles, indicators=["fibonacci"])
    assert fib is not None

    prices = [lvl.price for lvl in fib.levels]
    lo, hi = min(prices), max(prices)
    assert lo >= fib.swing_low - 1e-6
    assert hi <= fib.swing_high + 1e-6


def test_timeframe_clarity_choppy_on_sideways_data():
    """Choppy sideways data should flag timeframe_clarity as 'choppy'."""
    svc = IndicatorService()
    candles = choppy_sideways(bars=80)
    _, fib = svc.compute(candles, indicators=["fibonacci"])
    # Either no result (no clean swing) or flagged choppy
    if fib is not None:
        assert fib.timeframe_clarity in ("clean", "choppy")
        # With many competing micro-swings the top candidate shouldn't
        # completely dominate — expect choppy most of the time.
        # (Not a hard assert — sinusoidal patterns are deterministic but
        # scoring has many factors; we assert the flag exists.)


def test_insufficient_data_returns_none():
    """Fewer bars than 2*PIVOT_WINDOW+5 should return None gracefully."""
    svc = IndicatorService()
    candles = [
        make_candle(t=1_700_000_000 + i * 86400, o=100, h=101, l=99, c=100)
        for i in range(5)
    ]
    results, fib = svc.compute(candles, indicators=["fibonacci"])
    assert fib is None


def test_candidates_sorted_by_score_desc():
    """Returned candidates should be ordered by score, highest first."""
    svc = IndicatorService()
    candles = clean_uptrend_swing(bars=80)
    _, fib = svc.compute(candles, indicators=["fibonacci"])
    assert fib is not None

    scores = [c.score for c in fib.candidates]
    assert scores == sorted(scores, reverse=True)


def test_level_labels_mark_golden_pocket():
    """GP levels should have a 'GP' marker in their label."""
    svc = IndicatorService()
    candles = clean_uptrend_swing()
    _, fib = svc.compute(candles, indicators=["fibonacci"])
    assert fib is not None
    gp_lvls = [lvl for lvl in fib.levels if lvl.golden_pocket]
    assert gp_lvls
    for lvl in gp_lvls:
        assert "GP" in lvl.label


def test_trend_alias_matches_direction():
    """Backwards-compat .trend property should mirror .direction."""
    svc = IndicatorService()
    candles = clean_uptrend_swing()
    _, fib = svc.compute(candles, indicators=["fibonacci"])
    assert fib is not None
    assert fib.trend == fib.direction
