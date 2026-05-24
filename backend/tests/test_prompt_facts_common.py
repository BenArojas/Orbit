"""Smoke tests for the PromptFact / PromptContextBlock contract."""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from services.prompt_facts._common import (
    is_near, is_rising_n, is_falling_n, recent_cross, percentile_rank,
)
from services.prompt_facts.types import PromptFact, PromptContextBlock


def test_promptfact_accepts_valid_polarity():
    f = PromptFact(
        id="D.rsi.above_50_rising",
        timeframe="D",
        indicator="rsi",
        text="RSI 62.3, above 50 and rising 3 bars",
        polarity="bullish",
        strength=60,
        priority=10,
        data={"rsi": 62.3},
    )
    assert f.polarity == "bullish"


def test_promptfact_rejects_invalid_polarity():
    with pytest.raises(ValidationError):
        PromptFact(
            id="D.rsi.above_50_rising",
            timeframe="D",
            indicator="rsi",
            text="x",
            polarity="bullish (weakening)",  # not a Literal value
            strength=60,
            priority=10,
            data={},
        )


def test_promptcontextblock_holds_facts_and_metadata():
    block = PromptContextBlock(
        timeframe="D",
        tf_weight=3,
        facts=[],
        last_close=215.40,
        chart_context=None,
    )
    assert block.timeframe == "D"
    assert block.tf_weight == 3
    assert block.last_close == 215.40
    assert block.chart_context is None


class TestIsNear:
    def test_within_quarter_atr_returns_true(self):
        assert is_near(price=100.0, level=100.20, atr=1.00) is True   # 0.20 <= 0.25*1.0

    def test_outside_quarter_atr_returns_false(self):
        assert is_near(price=100.0, level=100.30, atr=1.00) is False  # 0.30 > 0.25*1.0

    def test_no_atr_uses_half_percent_fallback(self):
        assert is_near(price=100.0, level=100.49, atr=None) is True   # 0.49% <= 0.5%
        assert is_near(price=100.0, level=100.60, atr=None) is False  # 0.6% > 0.5%

    def test_zero_atr_falls_back_to_percent(self):
        assert is_near(price=100.0, level=100.49, atr=0.0) is True


class TestIsRisingFalling:
    def test_momentum_rising_majority_steps_positive(self):
        # values: ..., 10, 11, 12, 13 — 3 step diffs, all positive
        assert is_rising_n([10, 11, 12, 13], n=3, mode="momentum") is True

    def test_momentum_rising_noisy_majority_positive(self):
        # last 3 step diffs: +1, -0.5, +2 → net positive, 2/3 positive
        assert is_rising_n([10, 11, 10.5, 12.5], n=3, mode="momentum") is True

    def test_momentum_not_rising_when_net_negative(self):
        assert is_rising_n([10, 11, 10.5, 10.0], n=3, mode="momentum") is False

    def test_slow_mode_rising_needs_net_positive_over_n(self):
        assert is_rising_n([1, 2, 1.5, 2.0, 2.5, 3.0], n=5, mode="slow") is True

    def test_returns_false_when_too_few_values(self):
        assert is_rising_n([10, 11], n=3, mode="momentum") is False

    def test_handles_none_entries(self):
        assert is_rising_n([None, 10, 11, 12], n=3, mode="momentum") is True

    def test_falling_is_symmetric(self):
        assert is_falling_n([13, 12, 11, 10], n=3, mode="momentum") is True


class TestRecentCross:
    def test_up_cross_detected_within_daily_window(self):
        # last 5 daily bars: a was below b, then crosses above
        a = [9, 9.5, 10, 11, 12]
        b = [10, 10, 10, 10, 10]
        found, bars_ago = recent_cross(a, b, timeframe="D")
        assert found is True
        assert bars_ago in (1, 2)   # cross between index 1 and 2

    def test_no_cross_returns_false(self):
        a = [9, 9, 9, 9, 9]
        b = [10, 10, 10, 10, 10]
        found, bars_ago = recent_cross(a, b, timeframe="D")
        assert found is False
        assert bars_ago == -1

    def test_hourly_uses_60_underlying_bar_window(self):
        # cross 50 bars ago should still be detected on 1H
        a = [9] * 50 + [11] + [11] * 14    # cross at index 50, total 65 bars
        b = [10] * 65
        found, _ = recent_cross(a, b, timeframe="1H")
        assert found is True


class TestPercentileRank:
    def test_returns_0_when_lowest(self):
        assert percentile_rank(1.0, history=[1, 2, 3, 4, 5]) == 0.0

    def test_returns_high_when_top(self):
        assert percentile_rank(5.0, history=[1, 2, 3, 4, 5]) == 0.8

    def test_respects_lookback(self):
        # only last 3 entries counted; current value 0.5 → lowest of [3,4,5]
        assert percentile_rank(0.5, history=[1, 2, 3, 4, 5], lookback=3) == 0.0
