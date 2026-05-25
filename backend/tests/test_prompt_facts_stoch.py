"""Tests for Stochastic prompt facts."""
from models import IndicatorValue, IndicatorResult
from services.prompt_facts.stoch import build_stoch_facts


def _stoch(pairs: list[tuple[float, float]]) -> IndicatorResult:
    """pairs of (k, d)."""
    return IndicatorResult(
        name="stoch", type="oscillator",
        values=[
            IndicatorValue(time=1_700_000_000 + i * 86400, value=k, signal=d)
            for i, (k, d) in enumerate(pairs)
        ],
        params={"k_period": 14, "d_period": 3, "smooth_k": 3},
    )


class TestStochFacts:
    def test_k_above_d(self):
        stoch = _stoch([(40, 38), (45, 40), (50, 42), (55, 45)])
        facts = build_stoch_facts(symbol="AAPL", timeframe="D", stoch=stoch)
        ids = [f.id for f in facts]
        assert "D.stoch.k_above_d" in ids

    def test_k_below_d(self):
        stoch = _stoch([(60, 62), (55, 60), (50, 58), (45, 55)])
        facts = build_stoch_facts(symbol="AAPL", timeframe="D", stoch=stoch)
        ids = [f.id for f in facts]
        assert "D.stoch.k_below_d" in ids

    def test_recent_cross_emits_signal(self):
        stoch = _stoch([(40, 50), (42, 50), (52, 50), (60, 52)])
        facts = build_stoch_facts(symbol="AAPL", timeframe="D", stoch=stoch)
        ids = [f.id for f in facts]
        assert "D.stoch.cross_recent" in ids

    def test_overbought_exit_caution(self):
        stoch = _stoch([(78, 75), (82, 78), (85, 82), (78, 82)])
        facts = build_stoch_facts(symbol="AAPL", timeframe="D", stoch=stoch)
        assert any(f.id == "D.stoch.overbought_exit" for f in facts)
        ex = next(f for f in facts if f.id == "D.stoch.overbought_exit")
        assert ex.polarity == "caution"

    def test_oversold_exit_bullish(self):
        """C9: lock the full emitted ID set so multi-emission is regression-proof."""
        stoch = _stoch([(22, 25), (18, 22), (15, 18), (22, 18)])
        facts = build_stoch_facts(symbol="AAPL", timeframe="D", stoch=stoch)
        ids = {f.id for f in facts}
        # All three signals fire in this scenario:
        #   - k_above_d  (current k > current d)
        #   - cross_recent (%K crossed up through %D)
        #   - oversold_exit (prev_k <= 20 and current k > 20)
        assert ids == {"D.stoch.k_above_d", "D.stoch.cross_recent", "D.stoch.oversold_exit"}
        ex = next(f for f in facts if f.id == "D.stoch.oversold_exit")
        assert ex.polarity == "bullish"
