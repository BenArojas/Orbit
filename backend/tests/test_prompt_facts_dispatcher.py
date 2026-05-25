"""Tests for build_prompt_facts dispatcher."""
from models import CandleData, IndicatorValue, IndicatorResult
from services.prompt_facts import build_prompt_facts


def _candles(closes: list[float]) -> list[CandleData]:
    return [
        CandleData(time=1_700_000_000 + i * 86400, open=c - 0.5, high=c + 1, low=c - 1, close=c, volume=1_000_000)
        for i, c in enumerate(closes)
    ]


def _ema(period: int, values: list[float]) -> IndicatorResult:
    return IndicatorResult(
        name="ema", type="overlay",
        values=[IndicatorValue(time=1_700_000_000 + i * 86400, value=v) for i, v in enumerate(values)],
        params={"period": period},
    )


class TestDispatcher:
    def test_returns_one_block_per_timeframe(self):
        candles = _candles([100, 101, 102, 103, 104, 105, 106, 107, 108, 109])
        tf_data = {
            "D": {"candles": candles, "indicators": [_ema(9, [99.0] * 10)]},
            "W": {"candles": candles, "indicators": [_ema(9, [99.0] * 10)]},
        }
        blocks = build_prompt_facts(symbol="AAPL", timeframe_data=tf_data, indicator_priority=[])
        assert len(blocks) == 2
        tfs = {b.timeframe for b in blocks}
        assert tfs == {"D", "W"}

    def test_priority_boost_for_listed_indicators(self):
        candles = _candles([100.0] * 25)
        tf_data = {
            "D": {
                "candles": candles,
                "indicators": [_ema(9, [99.0] * 25)],
            }
        }
        blocks = build_prompt_facts(symbol="AAPL", timeframe_data=tf_data, indicator_priority=["ema"])
        ema_facts = [f for b in blocks for f in b.facts if f.indicator == "ema"]
        assert ema_facts
        # All ema facts get +20 priority boost
        assert all(f.priority >= 70 for f in ema_facts)

    def test_facts_sorted_by_priority_desc(self):
        candles = _candles([100.0] * 25)
        tf_data = {
            "D": {
                "candles": candles,
                "indicators": [_ema(9, [99.0] * 25)],
            }
        }
        blocks = build_prompt_facts(symbol="AAPL", timeframe_data=tf_data, indicator_priority=[])
        for block in blocks:
            priorities = [f.priority for f in block.facts]
            assert priorities == sorted(priorities, reverse=True)

    def test_empty_data_returns_empty(self):
        blocks = build_prompt_facts(symbol="AAPL", timeframe_data={}, indicator_priority=[])
        assert blocks == []
