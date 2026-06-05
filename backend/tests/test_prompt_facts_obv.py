"""Tests for OBV prompt facts."""
from models import IndicatorValue, IndicatorResult, CandleData
from services.prompt_facts.obv import build_obv_facts


def _obv(values: list[float]) -> IndicatorResult:
    return IndicatorResult(
        name="obv", type="line",
        values=[IndicatorValue(time=1_700_000_000 + i * 86400, value=v) for i, v in enumerate(values)],
        params={},
    )


def _candles(closes: list[float]) -> list[CandleData]:
    return [
        CandleData(time=1_700_000_000 + i * 86400, open=c - 0.5, high=c + 1.0, low=c - 1.0, close=c, volume=1_000_000)
        for i, c in enumerate(closes)
    ]


class TestObvFacts:
    def test_rising_obv(self):
        candles = _candles([100, 101, 102, 103, 104, 105])
        obv = _obv([1000, 1100, 1200, 1300, 1400, 1500])
        facts = build_obv_facts(symbol="AAPL", timeframe="D", obv=obv, candles=candles)
        ids = [f.id for f in facts]
        assert "D.obv.rising" in ids

    def test_falling_obv(self):
        candles = _candles([105, 104, 103, 102, 101, 100])
        obv = _obv([1500, 1400, 1300, 1200, 1100, 1000])
        facts = build_obv_facts(symbol="AAPL", timeframe="D", obv=obv, candles=candles)
        ids = [f.id for f in facts]
        assert "D.obv.falling" in ids

    def test_bearish_divergence_price_up_obv_down(self):
        candles = _candles([100, 101, 102, 103, 104, 105])  # price up
        obv = _obv([1500, 1450, 1400, 1350, 1300, 1250])    # OBV down
        facts = build_obv_facts(symbol="AAPL", timeframe="D", obv=obv, candles=candles)
        ids = [f.id for f in facts]
        assert "D.obv.divergence_bearish" in ids

    def test_bullish_divergence_price_down_obv_up(self):
        candles = _candles([105, 104, 103, 102, 101, 100])  # price down
        obv = _obv([1000, 1100, 1200, 1300, 1400, 1500])    # OBV up
        facts = build_obv_facts(symbol="AAPL", timeframe="D", obv=obv, candles=candles)
        ids = [f.id for f in facts]
        assert "D.obv.divergence_bullish" in ids
