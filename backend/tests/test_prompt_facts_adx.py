"""Tests for ADX prompt facts."""
from models import IndicatorValue, IndicatorResult
from services.prompt_facts.adx import build_adx_facts


def _adx(values: list[float]) -> IndicatorResult:
    return IndicatorResult(
        name="adx", type="value",
        values=[IndicatorValue(time=1_700_000_000 + i * 86400, value=v) for i, v in enumerate(values)],
        params={"period": 14},
    )


class TestAdxFacts:
    def test_strong_rising_neutral_polarity(self):
        # ADX above 25 and rising
        adx = _adx([22, 24, 26, 28, 30, 32])
        facts = build_adx_facts(symbol="AAPL", timeframe="D", adx=adx)
        f = next((x for x in facts if x.id == "D.adx.strong_rising"), None)
        assert f is not None
        assert f.polarity == "neutral"  # ADX measures strength, not direction

    def test_strong_falling_caution_polarity(self):
        # ADX above 25 but falling — trend weakening
        adx = _adx([35, 33, 31, 29, 27, 26])
        facts = build_adx_facts(symbol="AAPL", timeframe="D", adx=adx)
        f = next((x for x in facts if x.id == "D.adx.strong_falling"), None)
        assert f is not None
        assert f.polarity == "caution"

    def test_weak_when_below_20(self):
        adx = _adx([15, 14, 13, 14, 15, 16])
        facts = build_adx_facts(symbol="AAPL", timeframe="D", adx=adx)
        ids = [f.id for f in facts]
        assert "D.adx.weak" in ids
