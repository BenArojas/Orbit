from __future__ import annotations

import pytest

from models import IndicatorResult, IndicatorValue
from services.prompt_facts.rsi import build_facts


def _rsi(series: list[float]) -> IndicatorResult:
    return IndicatorResult(
        name="rsi", type="oscillator",
        values=[IndicatorValue(time=1_700_000_000 + i * 86400, value=v) for i, v in enumerate(series)],
        params={"period": 14},
    )


class TestRsi:
    def test_above_50_rising(self):
        facts = build_facts(_rsi([52, 55, 58, 62]), timeframe="D")
        ids = {f.id for f in facts}
        assert "D.rsi.above_50_rising" in ids
        f = next(x for x in facts if x.id == "D.rsi.above_50_rising")
        assert f.polarity == "bullish"

    def test_below_50_falling(self):
        facts = build_facts(_rsi([48, 45, 42, 38]), timeframe="D")
        ids = {f.id for f in facts}
        assert "D.rsi.below_50_falling" in ids

    def test_above_50_falling_is_neutral(self):
        facts = build_facts(_rsi([70, 65, 60, 55]), timeframe="D")
        f = next(x for x in facts if x.id == "D.rsi.above_50_falling")
        assert f.polarity == "neutral"

    def test_overbought_is_caution(self):
        facts = build_facts(_rsi([70, 72, 73, 74]), timeframe="D")
        f = next(x for x in facts if x.id == "D.rsi.overbought")
        assert f.polarity == "caution"

    def test_oversold_is_caution(self):
        facts = build_facts(_rsi([30, 28, 26, 24]), timeframe="D")
        f = next(x for x in facts if x.id == "D.rsi.oversold")
        assert f.polarity == "caution"

    def test_returns_empty_when_no_values(self):
        ir = IndicatorResult(name="rsi", type="oscillator", values=[], params={})
        assert build_facts(ir, timeframe="D") == []
