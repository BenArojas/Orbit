from __future__ import annotations

import pytest

from models import IndicatorResult, IndicatorValue
from services.prompt_facts.vwap import build_facts


def _vwap(series: list[float]) -> IndicatorResult:
    return IndicatorResult(
        name="vwap", type="overlay",
        values=[IndicatorValue(time=1_700_000_000 + i * 86400, value=v) for i, v in enumerate(series)],
        params={},
    )


class TestVwap:
    def test_price_above_vwap(self):
        facts = build_facts(_vwap([99, 99, 100]), last_close=101.0, timeframe="D")
        f = next(x for x in facts if x.id == "D.vwap.price_above")
        assert f.polarity == "bullish"

    def test_price_below_vwap(self):
        facts = build_facts(_vwap([100, 100, 100]), last_close=98.0, timeframe="D")
        ids = {f.id for f in facts}
        assert "D.vwap.price_below" in ids

    def test_reclaim_recent(self):
        vwap_series = [100, 100, 100, 100, 100]
        candle_closes = [98, 98, 99, 100, 101]
        facts = build_facts(_vwap(vwap_series), last_close=101.0, timeframe="D",
                            candle_closes=candle_closes)
        ids = {f.id for f in facts}
        assert "D.vwap.reclaim_recent" in ids

    def test_distance_far_emits_caution(self):
        facts = build_facts(_vwap([100]), last_close=102.0, timeframe="D")
        f = next(x for x in facts if x.id == "D.vwap.distance_far")
        assert f.polarity == "caution"

    def test_empty_returns_empty(self):
        ir = IndicatorResult(name="vwap", type="overlay", values=[], params={})
        assert build_facts(ir, last_close=100.0, timeframe="D") == []
