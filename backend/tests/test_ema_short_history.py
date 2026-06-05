"""
Tests for _compute_ema — short-history resilience.

Covers:
  - EMA-200 over 60 daily bars returns an empty result (not a crash).
  - EMA returns empty when ta.ema() returns None.
  - EMA returns empty when ta.ema() returns an empty Series.
  - EMA still works correctly when there is enough history.

Bug context: previously, requesting ema_200 on a 3-month daily window
(~63 bars) crashed with `'NoneType' object is not iterable` because
pandas-ta's ta.ema() returns None when len(df) < period and we passed
None into _series_to_values which iterates over it.
"""
from __future__ import annotations

from unittest.mock import patch
import pytest

from services.indicators import IndicatorService
from models import CandleData


# ── Helpers ───────────────────────────────────────────────────

def _make_candles(n: int) -> list[CandleData]:
    """Build n minimal candles (price 100 with small variation)."""
    return [
        CandleData(
            time=1700000000 + i * 86400,
            open=100.0,
            high=101.0,
            low=99.0,
            close=100.0 + (i % 5) * 0.25,
            volume=1000.0,
        )
        for i in range(n)
    ]


# ── Tests ─────────────────────────────────────────────────────

class TestEmaShortHistory:
    def test_ema_200_with_60_bars_returns_empty_not_crash(self):
        """Regression: requesting EMA-200 with too few bars must not raise."""
        svc = IndicatorService()
        candles = _make_candles(60)

        # Must not raise
        results, _ = svc.compute(candles=candles, indicators=["ema_200"])

        assert len(results) == 1
        assert results[0].name == "ema_200"
        assert results[0].values == []
        assert results[0].params == {"period": 200}

    def test_ema_handles_pandas_ta_returning_none(self):
        """If ta.ema returns None even with enough rows, we return empty."""
        svc = IndicatorService()
        candles = _make_candles(250)  # plenty of data

        with patch("services.indicators.ta.ema", return_value=None):
            results, _ = svc.compute(candles=candles, indicators=["ema_50"])

        assert len(results) == 1
        assert results[0].name == "ema_50"
        assert results[0].values == []

    def test_ema_handles_pandas_ta_returning_empty_series(self):
        """If ta.ema returns an empty Series, we return empty."""
        # Local import — pandas is heavy and only this one test needs it
        import pandas as pd  # noqa: PLC0415

        svc = IndicatorService()
        candles = _make_candles(250)

        with patch("services.indicators.ta.ema", return_value=pd.Series(dtype=float)):
            results, _ = svc.compute(candles=candles, indicators=["ema_50"])

        assert len(results) == 1
        assert results[0].values == []

    def test_ema_with_enough_history_produces_values(self):
        """Sanity: with 250 bars, EMA-50 should still produce values."""
        svc = IndicatorService()
        candles = _make_candles(250)

        results, _ = svc.compute(candles=candles, indicators=["ema_50"])

        assert len(results) == 1
        assert results[0].name == "ema_50"
        assert len(results[0].values) > 0

    @pytest.mark.parametrize("period", [9, 21, 50, 200])
    def test_each_ema_period_safe_with_short_history(self, period):
        """All four EMA periods must handle <period bars gracefully."""
        svc = IndicatorService()
        candles = _make_candles(period - 1)  # one bar short

        results, _ = svc.compute(candles=candles, indicators=[f"ema_{period}"])

        assert len(results) == 1
        assert results[0].values == []

    def test_mixed_emas_partial_success(self):
        """ema_9/21/50 succeed, ema_200 returns empty — none crash."""
        svc = IndicatorService()
        candles = _make_candles(60)

        results, _ = svc.compute(
            candles=candles,
            indicators=["ema_9", "ema_21", "ema_50", "ema_200"],
        )

        by_name = {r.name: r for r in results}
        assert len(by_name["ema_9"].values) > 0
        assert len(by_name["ema_21"].values) > 0
        assert len(by_name["ema_50"].values) > 0
        assert by_name["ema_200"].values == []
