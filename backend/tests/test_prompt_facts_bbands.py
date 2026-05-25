from __future__ import annotations

import pytest

from models import IndicatorResult, IndicatorValue
from services.prompt_facts.bbands import build_facts


def _bb(rows: list[tuple[float, float, float]]) -> IndicatorResult:
    """rows: list of (middle, upper, lower)."""
    vals = [
        IndicatorValue(time=1_700_000_000 + i * 86400, value=m, upper=u, lower=l)
        for i, (m, u, l) in enumerate(rows)
    ]
    return IndicatorResult(name="bbands", type="overlay", values=vals,
                           params={"period": 20, "stddev": 2})


class TestBbands:
    def test_outside_upper_is_caution(self):
        ir = _bb([(100, 105, 95)] * 30)
        facts = build_facts(ir, last_close=107.0, candle_closes=[107.0],
                            timeframe="D")
        f = next(x for x in facts if x.id == "D.bbands.outside_upper")
        assert f.polarity == "caution"

    def test_upper_band_walk_bullish(self):
        ir = _bb([(100, 110, 90)] * 30)
        closes = [104, 106, 107, 108, 109]
        facts = build_facts(ir, last_close=109.0, candle_closes=closes, timeframe="D")
        ids = {f.id for f in facts}
        assert "D.bbands.upper_band_walk" in ids

    def test_squeeze_when_band_width_below_25th_percentile(self):
        wide = [(100, 120, 80) for _ in range(99)]
        narrow = [(100, 101, 99)]
        ir = _bb(wide + narrow)
        facts = build_facts(ir, last_close=100.0, candle_closes=[100.0], timeframe="D")
        ids = {f.id for f in facts}
        assert "D.bbands.squeeze" in ids


class TestGuards:
    def test_empty_returns_empty(self):
        ir = IndicatorResult(name="bbands", type="overlay", values=[], params={})
        assert build_facts(ir, last_close=100.0, candle_closes=[], timeframe="D") == []
