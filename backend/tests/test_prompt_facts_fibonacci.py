"""Fibonacci fact builder tests — the canonical 'no false fact' suite."""
from __future__ import annotations

import pytest

from models import FibonacciCandidate, FibonacciLevel, FibonacciResult, FibonacciSnapshot
from services.prompt_facts.fibonacci import build_facts


def _fib_result(
    *,
    direction: str = "up",
    swing_low: float = 145.20,
    swing_high: float = 210.50,
    levels: list[FibonacciLevel] | None = None,
    is_nested: bool = False,
    convergence_zones: list[dict] | None = None,
) -> FibonacciResult:
    return FibonacciResult(
        tool_mode="retracement",
        swing_high=swing_high,
        swing_low=swing_low,
        swing_high_time=1_700_000_000,
        swing_low_time=1_699_900_000,
        direction=direction,
        levels=levels or [],
        extensions=[],
        score=80.0,
        swing_clarity=0.85,
        timeframe_clarity="clean",
        candidates=[],
        convergence_zones=convergence_zones or [],
        is_nested=is_nested,
        reasoning="test",
    )


class TestTsmExtensionCase:
    """The canonical bug: price past swing high → extension territory,
    must NOT emit any 'price near 0.5 retracement' facts."""

    def test_extension_emits_position_above_swing(self):
        fib = _fib_result(direction="up", swing_low=145.20, swing_high=210.50)
        facts = build_facts(fib, last_close=215.40, atr=4.10, timeframe="D")
        ids = {f.id for f in facts}
        assert "D.fibonacci.position_above_swing" in ids

    def test_extension_does_not_emit_price_near_05(self):
        fib = _fib_result(direction="up", swing_low=145.20, swing_high=210.50)
        facts = build_facts(fib, last_close=215.40, atr=4.10, timeframe="D")
        ids = {f.id for f in facts}
        for ratio in ("0382", "0500", "0618", "0650", "0716"):
            assert f"D.fibonacci.price_near_{ratio}" not in ids

    def test_extension_skips_inside_swing_fact(self):
        fib = _fib_result(direction="up", swing_low=145.20, swing_high=210.50)
        facts = build_facts(fib, last_close=215.40, atr=4.10, timeframe="D")
        ids = {f.id for f in facts}
        assert "D.fibonacci.position_inside_swing" not in ids


class TestInsideSwing:
    def test_inside_swing_with_golden_pocket(self):
        # Swing 100→200 up: 0.618=138.2, 0.65=135.0, 0.716=128.4. GP spans 128.4–138.2.
        # Price 133.0 is inside.
        fib = _fib_result(
            direction="up", swing_low=100.0, swing_high=200.0,
            levels=[
                FibonacciLevel(level=0.618, price=138.2, label="0.618", kind="retracement", golden_pocket=True),
                FibonacciLevel(level=0.650, price=135.0, label="0.65",  kind="retracement", golden_pocket=True),
                FibonacciLevel(level=0.716, price=128.4, label="0.716", kind="retracement", golden_pocket=True),
            ],
        )
        facts = build_facts(fib, last_close=133.0, atr=2.0, timeframe="D")
        ids = {f.id for f in facts}
        assert "D.fibonacci.in_golden_pocket" in ids
        assert "D.fibonacci.position_inside_swing" in ids

    def test_inside_swing_near_levels_emits_price_near_only_for_close_ones(self):
        # ATR=2; quarter ATR = 0.5. Price 138.4 is 0.2 from 138.2 (NEAR 0.618).
        fib = _fib_result(
            direction="up", swing_low=100.0, swing_high=200.0,
            levels=[
                FibonacciLevel(level=0.618, price=138.2, label="0.618", kind="retracement", golden_pocket=True),
                FibonacciLevel(level=0.650, price=135.0, label="0.65",  kind="retracement", golden_pocket=True),
                FibonacciLevel(level=0.716, price=128.4, label="0.716", kind="retracement", golden_pocket=True),
            ],
        )
        facts = build_facts(fib, last_close=138.4, atr=2.0, timeframe="D")
        ids = {f.id for f in facts}
        assert "D.fibonacci.price_near_0618" in ids
        assert "D.fibonacci.price_near_0650" not in ids
        assert "D.fibonacci.price_near_0716" not in ids

    def test_away_from_levels_when_no_level_in_play(self):
        # All levels far from 180.0; quarter ATR = 0.5; nothing within 0.5.
        fib = _fib_result(
            direction="up", swing_low=100.0, swing_high=200.0,
            levels=[
                FibonacciLevel(level=0.382, price=161.8, label="0.382", kind="retracement"),
                FibonacciLevel(level=0.500, price=150.0, label="0.5",   kind="retracement"),
                FibonacciLevel(level=0.618, price=138.2, label="0.618", kind="retracement", golden_pocket=True),
            ],
        )
        facts = build_facts(fib, last_close=180.0, atr=2.0, timeframe="D")
        ids = {f.id for f in facts}
        assert "D.fibonacci.away_from_levels" in ids
        for ratio in ("0382", "0500", "0618"):
            assert f"D.fibonacci.price_near_{ratio}" not in ids


class TestDownSwing:
    def test_below_swing_emits_position_below_swing(self):
        fib = _fib_result(direction="down", swing_low=120.0, swing_high=200.0)
        facts = build_facts(fib, last_close=115.0, atr=2.0, timeframe="D")
        ids = {f.id for f in facts}
        assert "D.fibonacci.position_below_swing" in ids


class TestNestingAndConvergence:
    def test_nested_emits_caution_fact(self):
        fib = _fib_result(is_nested=True)
        facts = build_facts(fib, last_close=170.0, atr=2.0, timeframe="D")
        ids = {f.id for f in facts}
        assert "D.fibonacci.nested_inside_parent" in ids
        nested = next(f for f in facts if f.id == "D.fibonacci.nested_inside_parent")
        assert nested.polarity == "caution"

    def test_convergence_emits_fact(self):
        fib = _fib_result(convergence_zones=[{"price": 150.0, "timeframes": ["D", "W"]}])
        facts = build_facts(fib, last_close=170.0, atr=2.0, timeframe="D")
        ids = {f.id for f in facts}
        assert "D.fibonacci.convergence_cross_tf" in ids


class TestSnapshotInput:
    def test_snapshot_is_normalized_same_as_result(self):
        snap = FibonacciSnapshot(
            source="manual",
            swing_high=210.50,
            swing_low=145.20,
            swing_high_time=1_700_000_000,
            swing_low_time=1_699_900_000,
            direction="up",
            is_primary=True,
        )
        facts = build_facts(snap, last_close=215.40, atr=4.10, timeframe="D")
        ids = {f.id for f in facts}
        assert "D.fibonacci.position_above_swing" in ids


class TestGuards:
    def test_returns_empty_when_input_none(self):
        assert build_facts(None, last_close=100.0, atr=1.0, timeframe="D") == []

    def test_returns_empty_when_swings_degenerate(self):
        fib = _fib_result(swing_low=100.0, swing_high=100.0)
        assert build_facts(fib, last_close=100.0, atr=1.0, timeframe="D") == []


class TestTargetExtensions:
    """When the builder reports a position relative to the swing, it should
    also surface the closest target_extension levels so the LLM has concrete
    upside/downside targets in extension territory."""

    def test_inside_swing_emits_target_extension_above(self):
        fib = _fib_result(direction="up", swing_low=100.0, swing_high=200.0)
        facts = build_facts(fib, last_close=160.0, atr=2.0, timeframe="D")
        ids = {f.id for f in facts}
        assert "D.fibonacci.target_extension_1272" in ids
        assert "D.fibonacci.target_extension_1500" in ids
        assert "D.fibonacci.target_extension_1618" in ids
        ext = next(f for f in facts if f.id == "D.fibonacci.target_extension_1272")
        assert abs(ext.data["price"] - 227.2) < 0.01
        assert ext.data["ratio"] == 1.272

    def test_extension_territory_emits_target_extension_above(self):
        fib = _fib_result(direction="up", swing_low=145.20, swing_high=210.50)
        facts = build_facts(fib, last_close=215.40, atr=4.10, timeframe="D")
        ids = {f.id for f in facts}
        assert "D.fibonacci.target_extension_1272" in ids
        assert "D.fibonacci.target_extension_1500" in ids
        assert "D.fibonacci.target_extension_1618" in ids

    def test_down_swing_emits_target_extension_below(self):
        fib = _fib_result(direction="down", swing_low=120.0, swing_high=200.0)
        facts = build_facts(fib, last_close=150.0, atr=2.0, timeframe="D")
        ids = {f.id for f in facts}
        assert "D.fibonacci.target_extension_1272" in ids
        ext = next(f for f in facts if f.id == "D.fibonacci.target_extension_1272")
        # span=80, extension price = 120 - 80*(1.272-1) = 120 - 21.76 = 98.24
        assert abs(ext.data["price"] - 98.24) < 0.05

    def test_extension_polarity_matches_direction(self):
        fib_up = _fib_result(direction="up", swing_low=100.0, swing_high=200.0)
        facts_up = build_facts(fib_up, last_close=160.0, atr=2.0, timeframe="D")
        ext_up = next(f for f in facts_up if f.id == "D.fibonacci.target_extension_1272")
        assert ext_up.polarity == "bullish"

        fib_down = _fib_result(direction="down", swing_low=120.0, swing_high=200.0)
        facts_down = build_facts(fib_down, last_close=150.0, atr=2.0, timeframe="D")
        ext_down = next(f for f in facts_down if f.id == "D.fibonacci.target_extension_1272")
        assert ext_down.polarity == "bearish"
