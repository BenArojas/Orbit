from __future__ import annotations

import pytest

from models import CandleData, IndicatorResult, IndicatorValue
from services.prompt_facts.vwap import build_vwap_facts


def _vwap(series: list[float]) -> IndicatorResult:
    return IndicatorResult(
        name="vwap", type="overlay",
        values=[IndicatorValue(time=1_700_000_000 + i * 86400, value=v) for i, v in enumerate(series)],
        params={},
    )


def _candles_from_closes(closes: list[float]) -> list[CandleData]:
    return [
        CandleData(time=1_700_000_000 + i * 86400,
                   open=c - 0.5, high=c + 1, low=c - 1, close=c, volume=1_000_000)
        for i, c in enumerate(closes)
    ]


class TestVwap:
    def test_price_above_vwap(self):
        facts = build_vwap_facts(symbol="TEST", timeframe="D", vwap=_vwap([99, 99, 100]),
                                 last_close=101.0)
        f = next(x for x in facts if x.id == "D.vwap.price_above")
        assert f.polarity == "bullish"

    def test_price_below_vwap(self):
        facts = build_vwap_facts(symbol="TEST", timeframe="D", vwap=_vwap([100, 100, 100]),
                                 last_close=98.0)
        ids = {f.id for f in facts}
        assert "D.vwap.price_below" in ids

    def test_reclaim_recent(self):
        vwap_series = [100, 100, 100, 100, 100]
        candle_closes = [98, 98, 99, 100, 101]
        facts = build_vwap_facts(symbol="TEST", timeframe="D",
                                 vwap=_vwap(vwap_series),
                                 candles=_candles_from_closes(candle_closes),
                                 last_close=101.0)
        ids = {f.id for f in facts}
        assert "D.vwap.reclaim_recent" in ids

    def test_distance_far_emits_caution(self):
        facts = build_vwap_facts(symbol="TEST", timeframe="D", vwap=_vwap([100]),
                                 last_close=102.0)
        f = next(x for x in facts if x.id == "D.vwap.distance_far")
        assert f.polarity == "caution"

    def test_empty_returns_empty(self):
        ir = IndicatorResult(name="vwap", type="overlay", values=[], params={})
        assert build_vwap_facts(symbol="TEST", timeframe="D", vwap=ir,
                                last_close=100.0) == []
