from __future__ import annotations

import pytest

from models import CandleData, IndicatorResult, IndicatorValue
from services.prompt_facts.bbands import build_bbands_facts


def _bb(rows: list[tuple[float, float, float]]) -> IndicatorResult:
    """rows: list of (middle, upper, lower)."""
    vals = [
        IndicatorValue(time=1_700_000_000 + i * 86400, value=m, upper=u, lower=l)
        for i, (m, u, l) in enumerate(rows)
    ]
    return IndicatorResult(name="bbands", type="overlay", values=vals,
                           params={"period": 20, "stddev": 2})


def _candles_from_closes(closes: list[float]) -> list[CandleData]:
    return [
        CandleData(time=1_700_000_000 + i * 86400,
                   open=c - 0.5, high=c + 1, low=c - 1, close=c, volume=1_000_000)
        for i, c in enumerate(closes)
    ]


class TestBbands:
    def test_outside_upper_is_caution(self):
        ir = _bb([(100, 105, 95)] * 30)
        facts = build_bbands_facts(symbol="TEST", timeframe="D", bbands=ir,
                                   last_close=107.0,
                                   candles=_candles_from_closes([107.0]))
        f = next(x for x in facts if x.id == "D.bbands.outside_upper")
        assert f.polarity == "caution"

    def test_upper_band_walk_bullish(self):
        ir = _bb([(100, 110, 90)] * 30)
        closes = [104, 106, 107, 108, 109]
        facts = build_bbands_facts(symbol="TEST", timeframe="D", bbands=ir,
                                   last_close=109.0,
                                   candles=_candles_from_closes(closes))
        ids = {f.id for f in facts}
        assert "D.bbands.upper_band_walk" in ids

    def test_squeeze_when_band_width_below_25th_percentile(self):
        wide = [(100, 120, 80) for _ in range(99)]
        narrow = [(100, 101, 99)]
        ir = _bb(wide + narrow)
        facts = build_bbands_facts(symbol="TEST", timeframe="D", bbands=ir,
                                   last_close=100.0,
                                   candles=_candles_from_closes([100.0]))
        ids = {f.id for f in facts}
        assert "D.bbands.squeeze" in ids


    def test_no_duplicate_caution_on_breakout(self):
        """When close is above upper band, only outside_upper fires — not percent_b_over_100."""
        ir = _bb([(100, 105, 95)] * 30)
        facts = build_bbands_facts(symbol="TEST", timeframe="D", bbands=ir,
                                   last_close=107.0,
                                   candles=_candles_from_closes([107.0]))
        caution_facts = [f for f in facts if f.polarity == "caution"]
        assert len(caution_facts) == 1
        assert caution_facts[0].id == "D.bbands.outside_upper"
        # explicitly: percent_b_over_100 must not appear
        assert all(f.id != "D.bbands.percent_b_over_100" for f in facts)


class TestGuards:
    def test_empty_returns_empty(self):
        ir = IndicatorResult(name="bbands", type="overlay", values=[], params={})
        assert build_bbands_facts(symbol="TEST", timeframe="D", bbands=ir,
                                  last_close=100.0, candles=[]) == []


class TestLevelsCurrent:
    def test_levels_current_always_emitted_with_lower_mid_upper(self):
        ir = _bb([(100, 105, 95)] * 5)
        facts = build_bbands_facts(symbol="TEST", timeframe="D", bbands=ir,
                                   last_close=100.0, candles=_candles_from_closes([100.0]))
        lc = next((f for f in facts if f.id == "D.bbands.levels_current"), None)
        assert lc is not None, "D.bbands.levels_current must always be emitted"
        assert set(lc.price_values) == {95.0, 100.0, 105.0}

    def test_levels_current_emitted_even_when_inside_band(self):
        ir = _bb([(100, 110, 90)] * 5)
        facts = build_bbands_facts(symbol="TEST", timeframe="D", bbands=ir,
                                   last_close=100.0, candles=_candles_from_closes([100.0]))
        ids = {f.id for f in facts}
        assert "D.bbands.levels_current" in ids
