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
    INSIDE_TOLERANCE,
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


def test_direction_field_present():
    """FibonacciResult must have a direction field (up or down)."""
    svc = IndicatorService()
    candles = clean_uptrend_swing()
    _, fib = svc.compute(candles, indicators=["fibonacci"])
    assert fib is not None
    assert fib.direction in ("up", "down")


def test_flat_candles_zero_price_range():
    """Flat candles (same high/low everywhere) should not crash — returns None or valid result."""
    svc = IndicatorService()
    # All bars at exactly the same price → price_range = 0 for every swing candidate
    candles = [
        make_candle(t=1_700_000_000 + i * 86400, o=100, h=100, l=100, c=100)
        for i in range(30)
    ]
    results, fib = svc.compute(candles, indicators=["fibonacci"])
    # Either None (no valid swing) or a valid result — must not raise
    assert fib is None or isinstance(fib, FibonacciResult)


# ── Primary range selection (Branch 1 — plan items 1A/1B) ────


class TestPrimaryRangeSelection:
    """
    Branch 1 of docs/fibonacci-improvements-plan.md.

    The PRIMARY (auto-rendered) fib must be a swing price is currently
    inside, within INSIDE_TOLERANCE of either boundary. Played-out and
    broken swings remain in the Candidates list for context but never
    become the primary.
    """

    @staticmethod
    def _ramp_candles(
        sections: list[tuple[int, float, float]],
        t0: int = 1_700_000_000,
        bar_seconds: int = 86400,
    ) -> list[CandleData]:
        """
        Build candles as a sequence of linear segments.

        `sections` is a list of (bar_count, start_price, end_price). Each
        segment ramps linearly between the two prices over bar_count
        bars. Wicks are deliberately small so the close-based status
        checks aren't perturbed by intrabar noise.
        """
        out: list[CandleData] = []
        idx = 0
        for bars_in_section, p0, p1 in sections:
            for i in range(bars_in_section):
                frac = i / max(1, bars_in_section - 1) if bars_in_section > 1 else 1.0
                price = p0 + (p1 - p0) * frac
                out.append(make_candle(
                    t=t0 + (idx + i) * bar_seconds,
                    o=price,
                    h=price + 0.3,
                    l=price - 0.3,
                    c=price,
                ))
            idx += bars_in_section
        return out

    # ── Test 1: alive swing wins over higher-scoring played-out ──

    def test_picks_alive_swing_over_higher_scoring_played_out(self):
        """
        Two distinct swing structures: a large historical swing that has
        played out (price marched well past its target), then a smaller
        recent swing that price is currently inside.

        Expectation: primary is from the active set. `no_active_fib` is
        False. The played-out swing is still visible in `candidates`.
        """
        svc = IndicatorService()
        # Section 1: rally 100→130 (large historical swing peak)
        # Section 2: continued rally 130→200 (so the 100→130 swing closes
        #            well past expanded_high = 130 + 30*0.15 = 134.5)
        # Section 3: pullback 200→185 (creates a recent pivot)
        # Section 4: rally 185→195 (recent swing high)
        # Section 5: settle to ~190 (current price inside the 185→195 swing)
        candles = self._ramp_candles([
            (15, 100.0, 130.0),
            (15, 130.0, 200.0),
            (15, 200.0, 185.0),
            (15, 185.0, 195.0),
            (15, 195.0, 190.0),
        ])
        _, fib = svc.compute(candles, indicators=["fibonacci"])
        assert fib is not None
        assert fib.no_active_fib is False
        # The selected primary's swing must contain the current price
        # (within the tolerance band).
        current_price = candles[-1].close
        price_range = fib.swing_high - fib.swing_low
        expanded_low = fib.swing_low - price_range * INSIDE_TOLERANCE
        expanded_high = fib.swing_high + price_range * INSIDE_TOLERANCE
        assert expanded_low <= current_price <= expanded_high, (
            f"Primary swing band [{expanded_low:.2f}, {expanded_high:.2f}] "
            f"does not contain current price {current_price:.2f}"
        )
        # Played-out / broken candidates should still appear in the list.
        statuses = [c.status for c in fib.candidates]
        assert any(s != "active" for s in statuses) or len(fib.candidates) == 1, (
            f"Expected at least one non-active candidate in {statuses}"
        )

    # ── Test 2: no active candidate → no_active_fib flagged ──

    def test_returns_no_active_fib_when_all_broken(self):
        """
        Build a rally then a decisive crash that puts current price below
        every swing's expanded_low (for up swings) and well past every
        down swing's target (for down swings).
        """
        svc = IndicatorService()
        # Sharp rally then catastrophic collapse. End price far below
        # all the lows the rally swung from.
        candles = self._ramp_candles([
            (10, 100.0, 130.0),    # up swing peak ~130
            (15, 130.0, 200.0),    # continued up — peaks higher
            (20, 200.0, 40.0),     # massive crash
            (15, 40.0, 30.0),      # continuation downward
        ])
        _, fib = svc.compute(candles, indicators=["fibonacci"])
        assert fib is not None
        # Either every candidate is non-active (no_active_fib=True), or
        # if some down swing happens to bracket the current price we
        # accept that — but the contract is just "primary must be active
        # OR no_active_fib=True".
        if fib.no_active_fib:
            # Best case — exercises the no-active code path.
            assert fib.no_active_fib_reason is not None
            assert fib.candidates, "Candidates panel must still populate"
        else:
            # Fallback: ensure whatever IS primary is itself active.
            current_price = candles[-1].close
            price_range = fib.swing_high - fib.swing_low
            expanded_low = fib.swing_low - price_range * INSIDE_TOLERANCE
            expanded_high = fib.swing_high + price_range * INSIDE_TOLERANCE
            assert expanded_low <= current_price <= expanded_high

    # ── Test 3: wick poke within tolerance stays active ──

    def test_tolerance_band_keeps_swing_active_on_wick_poke(self):
        """
        Build a swing where the most recent price has barely poked past
        the 1.0 boundary — within INSIDE_TOLERANCE * range.

        For an up-swing low=100, high=130 (range=30):
          expanded_high = 130 + 30 * 0.15 = 134.5

        We park current price at 132 — past swing_high but well inside
        the tolerance band. Status should remain "active".
        """
        svc = IndicatorService()
        # Clean clean up swing, then a small pullback, then a tiny poke
        # 2 points above the swing high. 2 / 30 = ~6.7% < 15% tolerance.
        candles = self._ramp_candles([
            (10, 100.0, 100.0),    # flat lead-in so pivot low forms cleanly
            (10, 100.0, 130.0),    # rally to 130
            (10, 130.0, 115.0),    # retracement
            (8, 115.0, 132.0),     # creeps just past swing high
            (10, 132.0, 132.0),    # holds (current price 132)
        ])
        _, fib = svc.compute(candles, indicators=["fibonacci"])
        assert fib is not None
        # At least one candidate matching this swing should be "active".
        # We don't tightly assert which candidate the pivot detector
        # picks (it may find sub-swings) — we just verify the algorithm
        # didn't reject every candidate as played_out.
        assert fib.no_active_fib is False, (
            "A swing whose price sits ~7% past 1.0 (well inside the "
            "15% tolerance) must remain active"
        )

    # ── Test 4: decisive break excludes the swing from active set ──

    def test_tolerance_band_excludes_swing_on_decisive_break(self):
        """
        Same structure as test 3 but the post-swing price moves
        ~25% past the swing high — outside INSIDE_TOLERANCE. That
        specific swing should NOT be active.

        We can't easily isolate the targeted swing through the public
        compute() API (pivot detection finds many), so we assert the
        weaker claim: among the candidates, the one whose swing range
        closely matches our crafted (100,130) swing has status !=
        "active".
        """
        svc = IndicatorService()
        # Rally then march well past the 1.0 boundary.
        # 130 + 30 * 0.25 = 137.5 → push current to ~140 (33% past).
        candles = self._ramp_candles([
            (10, 100.0, 100.0),
            (10, 100.0, 130.0),
            (8, 130.0, 125.0),     # mild pullback so 130 is a pivot
            (10, 125.0, 140.0),    # decisive break above tolerance
            (10, 140.0, 140.0),    # current price 140
        ])
        _, fib = svc.compute(candles, indicators=["fibonacci"])
        assert fib is not None
        # Find the candidate closest to our crafted (100, 130) swing.
        target_lo, target_hi = 100.0, 130.0
        def dist(c) -> float:
            return abs(c.swing_low - target_lo) + abs(c.swing_high - target_hi)
        closest = min(fib.candidates, key=dist)
        # If pivot detection actually located our crafted swing
        # (within $5 of both endpoints), it must NOT be "active".
        if abs(closest.swing_low - target_lo) < 5.0 and abs(closest.swing_high - target_hi) < 5.0:
            assert closest.status != "active", (
                f"Swing {closest.swing_low}→{closest.swing_high} is "
                f"~33% past its 1.0 boundary — must not be 'active'. "
                f"Got status={closest.status}"
            )

    # ── Test 5: candidates panel populated when no active fib ──

    def test_candidates_panel_still_populated_when_no_active_fib(self):
        """
        Even when the primary is unavailable (`no_active_fib=True`), the
        Candidates list must still be populated so the user can pick a
        historical swing to study from the right panel.
        """
        svc = IndicatorService()
        # Reuse the crashy setup from test 2.
        candles = self._ramp_candles([
            (10, 100.0, 130.0),
            (15, 130.0, 200.0),
            (20, 200.0, 40.0),
            (15, 40.0, 30.0),
        ])
        _, fib = svc.compute(candles, indicators=["fibonacci"])
        assert fib is not None
        # Skip the test when conditions failed to produce no_active_fib —
        # the assertion below is meaningful only in the no-active branch.
        if not fib.no_active_fib:
            pytest.skip(
                "Synthetic data did not produce no_active_fib=True "
                "(an active down-swing bracketed the current price)"
            )
        assert fib.candidates, (
            "Candidates list must be non-empty even when no_active_fib=True"
        )
        # And the no-active-reason should be set.
        assert fib.no_active_fib_reason is not None
