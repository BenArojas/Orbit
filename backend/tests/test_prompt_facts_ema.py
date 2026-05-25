from __future__ import annotations

import pytest

from models import IndicatorResult, IndicatorValue
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
