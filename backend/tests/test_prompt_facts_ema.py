from __future__ import annotations

import pytest

from models import CandleData, IndicatorResult, IndicatorValue
from services.prompt_facts.ema import build_ema_facts


def _ema(period: int, last_val: float) -> IndicatorResult:
    return IndicatorResult(
        name=f"ema_{period}",
        type="overlay",
        values=[
            IndicatorValue(time=1_700_000_000 + i * 86_400, value=last_val - (10 - i) * 0.1)
            for i in range(11)
        ],
        params={"period": period},
    )


class TestStackOrder:
    def test_bullish_stack_when_9_above_21_above_50_above_200(self):
        emas = [_ema(9, 110), _ema(21, 105), _ema(50, 100), _ema(200, 90)]
        facts = build_ema_facts(symbol="TEST", timeframe="D", emas=emas,
                                last_close=112.0, atr=1.0)
        ids = {f.id for f in facts}
        assert "D.ema.stack_bullish" in ids
        assert "D.ema.price_above_all" in ids

    def test_bearish_stack_when_inverted(self):
        emas = [_ema(9, 90), _ema(21, 100), _ema(50, 110), _ema(200, 120)]
        facts = build_ema_facts(symbol="TEST", timeframe="D", emas=emas,
                                last_close=85.0, atr=1.0)
        ids = {f.id for f in facts}
        assert "D.ema.stack_bearish" in ids
        assert "D.ema.price_below_all" in ids

    def test_mixed_stack_when_not_ordered(self):
        emas = [_ema(9, 110), _ema(21, 100), _ema(50, 105), _ema(200, 90)]
        facts = build_ema_facts(symbol="TEST", timeframe="D", emas=emas,
                                last_close=108.0, atr=1.0)
        ids = {f.id for f in facts}
        assert "D.ema.stack_mixed" in ids

    def test_incomplete_when_period_missing(self):
        emas = [_ema(9, 110), _ema(21, 100)]
        facts = build_ema_facts(symbol="TEST", timeframe="D", emas=emas,
                                last_close=108.0, atr=1.0)
        ids = {f.id for f in facts}
        assert "D.ema.stack_incomplete" in ids


class TestNearAndCross:
    def test_price_near_ema_emits_per_period(self):
        emas = [_ema(9, 110), _ema(21, 105), _ema(50, 100), _ema(200, 90)]
        facts = build_ema_facts(symbol="TEST", timeframe="D", emas=emas,
                                last_close=110.10, atr=1.0)
        ids = {f.id for f in facts}
        assert "D.ema.price_near_9" in ids
        assert "D.ema.price_near_21" not in ids


class TestCross:
    def test_ema_9_21_cross_emits_within_recency_window(self):
        """C7: EMA-9 crosses EMA-21 within the daily recency window (5 bars)."""
        # Build aligned series where EMA-9 starts below EMA-21 and crosses above
        # within the last 5 bars.
        def _series(period: int, values: list[float]) -> IndicatorResult:
            return IndicatorResult(
                name=f"ema_{period}", type="overlay",
                values=[IndicatorValue(time=1_700_000_000 + i * 86_400, value=v)
                        for i, v in enumerate(values)],
                params={"period": period},
            )

        ema9 = _series(9,  [99, 99, 99, 99, 99, 101, 102, 103])
        ema21 = _series(21, [100, 100, 100, 100, 100, 100, 100, 100])
        ema50 = _series(50, [100, 100, 100, 100, 100, 100, 100, 100])
        ema200 = _series(200, [100, 100, 100, 100, 100, 100, 100, 100])
        facts = build_ema_facts(symbol="TEST", timeframe="D",
                                emas=[ema9, ema21, ema50, ema200],
                                last_close=103.0, atr=1.0)
        ids = {f.id for f in facts}
        assert "D.ema.cross_9_21_recent" in ids


class TestGuards:
    def test_empty_dict_returns_empty(self):
        assert build_ema_facts(symbol="TEST", timeframe="D", emas=[],
                               last_close=100.0, atr=1.0) == []

    def test_none_values_returns_empty(self):
        ir = IndicatorResult(name="ema_9", type="overlay", values=[
            IndicatorValue(time=1_700_000_000, value=None),
        ], params={"period": 9})
        assert build_ema_facts(symbol="TEST", timeframe="D", emas=[ir],
                               last_close=100.0, atr=1.0) == []


class TestLevelsCurrent:
    def test_full_stack_emits_levels_current_with_all_four_prices(self):
        emas = [_ema(9, 110), _ema(21, 105), _ema(50, 100), _ema(200, 90)]
        facts = build_ema_facts(symbol="TEST", timeframe="D", emas=emas,
                                last_close=112.0, atr=1.0)
        lc = next((f for f in facts if f.id == "D.ema.levels_current"), None)
        assert lc is not None, "D.ema.levels_current fact must be emitted"
        assert set(lc.price_values) == {110.0, 105.0, 100.0, 90.0}

    def test_incomplete_stack_still_emits_levels_current(self):
        emas = [_ema(9, 110), _ema(21, 100)]
        facts = build_ema_facts(symbol="TEST", timeframe="D", emas=emas,
                                last_close=108.0, atr=1.0)
        lc = next((f for f in facts if f.id == "D.ema.levels_current"), None)
        assert lc is not None, "D.ema.levels_current must be emitted for incomplete stack"
        assert set(lc.price_values) == {110.0, 100.0}


class TestCurrentCloseFact:
    def test_current_close_fact_emitted_by_dispatcher(self):
        """_build_for_tf must always emit a {TF}.price.current_close fact."""
        from services.prompt_facts import build_prompt_facts

        candles = [CandleData(time=1_700_000_000, open=99, high=115, low=98, close=112.0, volume=1000)]
        blocks = build_prompt_facts(
            symbol="TEST",
            timeframe_data={"D": {"candles": candles, "indicators": [], "fibs": [], "fibonacci": None}},
            indicator_priority=[],
        )
        fact_ids = {f.id for block in blocks for f in block.facts}
        assert "D.price.current_close" in fact_ids
        close_fact = next(f for block in blocks for f in block.facts if f.id == "D.price.current_close")
        assert close_fact.price_values == (112.0,)
