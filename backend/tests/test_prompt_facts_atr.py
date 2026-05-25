"""Tests for ATR prompt facts."""
from models import IndicatorValue, IndicatorResult
from services.prompt_facts.atr import build_atr_facts


def _atr(values: list[float]) -> IndicatorResult:
    return IndicatorResult(
        name="atr", type="value",
        values=[IndicatorValue(time=1_700_000_000 + i * 86400, value=v) for i, v in enumerate(values)],
        params={"period": 14},
    )


class TestAtrFacts:
    def test_emits_stop_distances_when_atr_present(self):
        atr = _atr([1.0, 1.0, 1.0, 1.0, 1.0, 1.0])
        facts = build_atr_facts(symbol="AAPL", timeframe="D", atr=atr, last_close=100.0)

        ids = [f.id for f in facts]
        assert "D.atr.stop_distances" in ids

    def test_expanding_when_recent_atr_rising(self):
        atr = _atr([1.0, 1.1, 1.2, 1.3, 1.4, 1.5])
        facts = build_atr_facts(symbol="AAPL", timeframe="D", atr=atr, last_close=100.0)
        ids = [f.id for f in facts]
        assert "D.atr.expanding" in ids
        assert "D.atr.contracting" not in ids

    def test_contracting_when_recent_atr_falling(self):
        atr = _atr([2.0, 1.8, 1.6, 1.4, 1.2, 1.0])
        facts = build_atr_facts(symbol="AAPL", timeframe="D", atr=atr, last_close=100.0)
        ids = [f.id for f in facts]
        assert "D.atr.contracting" in ids
        assert "D.atr.expanding" not in ids

    def test_empty_atr_returns_no_facts(self):
        atr = IndicatorResult(name="atr", type="value", values=[], params={"period": 14})
        facts = build_atr_facts(symbol="AAPL", timeframe="D", atr=atr, last_close=100.0)
        assert facts == []
