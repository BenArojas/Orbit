from __future__ import annotations

import pytest

from models import IndicatorResult, IndicatorValue
from services.prompt_facts.macd import build_facts


def _macd(line: list[float], signal: list[float], hist: list[float]) -> IndicatorResult:
    n = min(len(line), len(signal), len(hist))
    vals = [
        IndicatorValue(time=1_700_000_000 + i * 86400,
                       value=line[i], signal=signal[i], histogram=hist[i])
        for i in range(n)
    ]
    return IndicatorResult(name="macd", type="oscillator", values=vals,
                           params={"fast": 12, "slow": 26, "signal": 9})


class TestMacd:
    def test_line_bullish_impulse(self):
        facts = build_facts(_macd([0.5]*4, [0.2]*4, [0.3]*4), timeframe="D")
        f = next(x for x in facts if x.id == "D.macd.line_bullish_impulse")
        assert f.polarity == "bullish"

    def test_line_bearish_improving_is_neutral(self):
        facts = build_facts(_macd([-0.2]*4, [-0.5]*4, [0.3]*4), timeframe="D")
        f = next(x for x in facts if x.id == "D.macd.line_bearish_improving")
        assert f.polarity == "neutral"

    def test_hist_above_rising(self):
        facts = build_facts(_macd([0.5]*4, [0.4]*4, [0.10, 0.15, 0.20, 0.25]), timeframe="D")
        ids = {f.id for f in facts}
        assert "D.macd.hist_above_rising" in ids

    def test_hist_skips_when_near_zero(self):
        facts = build_facts(_macd([0.0]*4, [0.0]*4, [0.0, 0.0, 0.0, 0.00005]), timeframe="D")
        ids = {f.id for f in facts}
        assert not any("hist_" in i for i in ids)

    def test_recent_cross_emits(self):
        facts = build_facts(_macd([-0.1, -0.05, 0.0, 0.10],
                                  [0.1, 0.1, 0.05, 0.05],
                                  [-0.2, -0.15, -0.05, 0.05]),
                            timeframe="D")
        ids = {f.id for f in facts}
        assert "D.macd.cross_recent" in ids
        f = next(x for x in facts if x.id == "D.macd.cross_recent")
        assert f.data["direction"] == "up"

    def test_empty_returns_empty(self):
        ir = IndicatorResult(name="macd", type="oscillator", values=[], params={})
        assert build_facts(ir, timeframe="D") == []
