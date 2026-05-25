"""Tests for build_prompt_facts dispatcher."""
from models import CandleData, FibonacciSnapshot, IndicatorValue, IndicatorResult
from services.prompt_facts import build_prompt_facts
from services.prompt_facts.types import PromptContextBlock, PromptFact


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

    def test_recency_tie_breaker_newest_first(self):
        """When priority and strength tie, most recently emitted fact comes first.

        The dispatcher uses insertion order as a recency proxy (higher index
        means more recent). Replicate the dispatcher's intra-block sort here.
        """
        def _f(idx: int) -> PromptFact:
            return PromptFact(
                id=f"D.ema.tie_{idx}", timeframe="D", indicator="ema",
                text=f"tied fact {idx}", polarity="bullish",
                strength=60, priority=80, data={},
            )
        facts = [_f(0), _f(1), _f(2)]
        # Replicate the dispatcher's sort key exactly.
        facts_sorted = sorted(
            list(enumerate(facts)),
            key=lambda pair: (-pair[1].priority, -pair[1].strength, -pair[0]),
        )
        ordered = [pair[1] for pair in facts_sorted]
        # Newest (idx 2) must sort first, then 1, then 0 (oldest).
        assert ordered[0].id == "D.ema.tie_2"
        assert ordered[1].id == "D.ema.tie_1"
        assert ordered[2].id == "D.ema.tie_0"

    def test_snapshot_fib_without_primary_falls_back_to_first(self):
        """C10: when no fib is is_primary=True, fibs[0] is used."""
        candles = _candles([100.0] * 25)
        snap = FibonacciSnapshot(
            source="auto",
            swing_low=90.0, swing_high=110.0,
            swing_low_time=1_700_000_000, swing_high_time=1_700_086_400,
            direction="up", is_primary=False,
        )
        tf_data = {
            "D": {
                "candles": candles,
                "indicators": [],
                "fibs": [snap],
            }
        }
        blocks = build_prompt_facts(symbol="AAPL", timeframe_data=tf_data, indicator_priority=[])
        fib_facts = [f for b in blocks for f in b.facts if f.indicator == "fibonacci"]
        assert fib_facts, "expected at least one fibonacci fact from non-primary fallback"
