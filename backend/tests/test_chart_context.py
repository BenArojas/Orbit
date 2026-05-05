"""
Tests for chart context builders (feat/analysis-chart-context).

Covers:
  - _build_price_summary: recent closes, streak detection, range position
  - _build_ohlcv_history: table format, bar count capping, volume formatting
  - _detect_candlestick_patterns: doji, hammer, shooting star, engulfing, inside bar
  - _build_pattern_context: empty result, populated result, bullish/bearish summary
  - build_indicator_context: context_mode wired through correctly
  - build_multi_timeframe_context: context params forwarded to each timeframe
  - AnalyzeRequest: context_mode and context_bars validation
"""
from __future__ import annotations

import pytest

from models import CandleData
from services.prompt_builder import (
    _build_ohlcv_history,
    _build_pattern_context,
    _build_price_summary,
    _detect_candlestick_patterns,
    build_indicator_context,
    build_multi_timeframe_context,
)


# ── Fixtures ──────────────────────────────────────────────────


def make_candle(
    close: float,
    open_: float | None = None,
    high: float | None = None,
    low: float | None = None,
    volume: float = 1_000_000,
    time: int = 1_700_000_000,
) -> CandleData:
    o = open_ if open_ is not None else close
    h = high if high is not None else close + 1
    l_ = low if low is not None else close - 1
    return CandleData(time=time, open=o, high=h, low=l_, close=close, volume=volume)


def trending_candles(n: int = 15, start: float = 100.0, step: float = 1.0) -> list[CandleData]:
    """n candles with steadily rising closes."""
    candles = []
    for i in range(n):
        c = start + i * step
        candles.append(make_candle(close=c, open_=c - 0.2, time=1_700_000_000 + i * 86400))
    return candles


# ═══════════════════════════════════════════════════════════════
#  Price Summary
# ═══════════════════════════════════════════════════════════════


class TestBuildPriceSummary:
    def test_returns_empty_string_for_no_candles(self):
        assert _build_price_summary([], n_bars=10) == ""

    def test_contains_close_values(self):
        candles = trending_candles(5)
        result = _build_price_summary(candles, n_bars=5)
        assert "100.00" in result
        assert "104.00" in result

    def test_respects_n_bars(self):
        candles = trending_candles(20)
        result = _build_price_summary(candles, n_bars=5)
        # Should only show last 5 bars — close 115.0 to 119.0
        assert "115.00" in result
        assert "100.00" not in result  # first bar should be cut off

    def test_detects_consecutive_higher_closes(self):
        candles = trending_candles(10, step=1.0)
        result = _build_price_summary(candles, n_bars=10)
        assert "higher" in result.lower()

    def test_detects_consecutive_lower_closes(self):
        candles = trending_candles(10, step=-1.0)
        result = _build_price_summary(candles, n_bars=10)
        assert "lower" in result.lower()

    def test_near_high_detected(self):
        """Price at the very top of the range → 'near the period high'."""
        candles = [
            make_candle(close=100.0, high=105.0, low=95.0),
            make_candle(close=102.0, high=107.0, low=97.0),
            make_candle(close=104.0, high=110.0, low=90.0),  # current = near high
        ]
        result = _build_price_summary(candles, n_bars=3)
        assert "near the period high" in result

    def test_near_low_detected(self):
        """Price at the very bottom of the range → 'near the period low'."""
        candles = [
            make_candle(close=110.0, high=115.0, low=90.0),
            make_candle(close=105.0, high=112.0, low=88.0),
            make_candle(close=92.0, high=100.0, low=85.0),  # current = near low
        ]
        result = _build_price_summary(candles, n_bars=3)
        assert "near the period low" in result


# ═══════════════════════════════════════════════════════════════
#  OHLCV History
# ═══════════════════════════════════════════════════════════════


class TestBuildOhlcvHistory:
    def test_returns_empty_string_for_no_candles(self):
        assert _build_ohlcv_history([], n_bars=10) == ""

    def test_contains_all_ohlcv_labels(self):
        candles = trending_candles(5)
        result = _build_ohlcv_history(candles, n_bars=5)
        assert "O=" in result
        assert "H=" in result
        assert "L=" in result
        assert "C=" in result
        assert "V=" in result

    def test_respects_n_bars(self):
        candles = trending_candles(20)
        # Request 5 bars — result should have 5 data lines (plus header)
        result = _build_ohlcv_history(candles, n_bars=5)
        data_lines = [l for l in result.splitlines() if "O=" in l]
        assert len(data_lines) == 5

    def test_caps_at_available_candles(self):
        candles = trending_candles(3)
        result = _build_ohlcv_history(candles, n_bars=10)
        data_lines = [l for l in result.splitlines() if "O=" in l]
        assert len(data_lines) == 3

    def test_volume_formatted_as_millions(self):
        candles = [make_candle(close=100.0, volume=5_250_000)]
        result = _build_ohlcv_history(candles, n_bars=1)
        assert "5.2M" in result or "5.3M" in result  # rounding

    def test_direction_indicator_present(self):
        bull = [make_candle(close=102.0, open_=100.0)]
        bear = [make_candle(close=98.0, open_=100.0)]
        assert "▲" in _build_ohlcv_history(bull, 1)
        assert "▼" in _build_ohlcv_history(bear, 1)


# ═══════════════════════════════════════════════════════════════
#  Pattern Detection
# ═══════════════════════════════════════════════════════════════


class TestDetectCandlestickPatterns:
    def test_no_patterns_in_clean_trending_bars(self):
        """Normal trending bars with no extreme shadows shouldn't produce patterns."""
        candles = [
            make_candle(close=102.0, open_=100.0, high=103.0, low=99.0, time=t)
            for t in range(1_700_000_000, 1_700_000_000 + 5 * 86400, 86400)
        ]
        findings = _detect_candlestick_patterns(candles, n_bars=5)
        # These are clean bars — no patterns expected
        assert not any(p == "Doji" for _, p in findings)

    def test_doji_detected(self):
        """Bar where open ≈ close (body < 10% of range) is a Doji."""
        # Full range = 10, body = 0.5 → body/range = 5% < 10%
        candle = make_candle(close=100.25, open_=100.0, high=105.0, low=95.0, time=1_700_000_000)
        findings = _detect_candlestick_patterns([candle], n_bars=1)
        assert any(p == "Doji" for _, p in findings)

    def test_hammer_detected(self):
        """Small body at the top, long lower shadow = Hammer."""
        # Body = 0.5 (100.5→100), lower shadow = 8 (100→92), upper shadow = 0.2
        candle = make_candle(close=100.5, open_=100.0, high=100.7, low=92.0, time=1_700_000_000)
        findings = _detect_candlestick_patterns([candle], n_bars=1)
        assert any("Hammer" in p for _, p in findings)

    def test_shooting_star_detected(self):
        """Small body at the bottom, long upper shadow = Shooting Star."""
        # Body = 0.5 (100→100.5), upper shadow = 8 (100.5→108.5), lower shadow = 0.2
        candle = make_candle(close=100.0, open_=100.5, high=108.5, low=99.8, time=1_700_000_000)
        findings = _detect_candlestick_patterns([candle], n_bars=1)
        assert any(p == "Shooting Star" for _, p in findings)

    def test_bullish_engulfing_detected(self):
        """Bearish bar followed by bullish bar that fully contains the prior body."""
        t = 1_700_000_000
        prev = make_candle(close=98.0, open_=102.0, high=103.0, low=97.0, time=t)         # bearish
        curr = make_candle(close=105.0, open_=96.0, high=106.0, low=95.0, time=t + 86400)  # bullish engulfs
        findings = _detect_candlestick_patterns([prev, curr], n_bars=2)
        assert any(p == "Bullish Engulfing" for _, p in findings)

    def test_bearish_engulfing_detected(self):
        """Bullish bar followed by bearish bar that fully contains the prior body."""
        t = 1_700_000_000
        prev = make_candle(close=104.0, open_=100.0, high=105.0, low=99.0, time=t)         # bullish
        curr = make_candle(close=97.0, open_=106.0, high=107.0, low=96.0, time=t + 86400)  # bearish engulfs
        findings = _detect_candlestick_patterns([prev, curr], n_bars=2)
        assert any(p == "Bearish Engulfing" for _, p in findings)

    def test_inside_bar_detected(self):
        """Bar whose high < prev high AND low > prev low = Inside Bar."""
        t = 1_700_000_000
        prev = make_candle(close=102.0, open_=100.0, high=110.0, low=90.0, time=t)
        curr = make_candle(close=101.0, open_=100.5, high=105.0, low=95.0, time=t + 86400)
        findings = _detect_candlestick_patterns([prev, curr], n_bars=2)
        assert any(p == "Inside Bar" for _, p in findings)

    def test_zero_range_bar_skipped(self):
        """Bar with high == low should not crash or produce patterns."""
        candle = CandleData(time=1_700_000_000, open=100.0, high=100.0, low=100.0, close=100.0, volume=0)
        findings = _detect_candlestick_patterns([candle], n_bars=1)
        assert findings == []


# ═══════════════════════════════════════════════════════════════
#  Pattern Context Formatter
# ═══════════════════════════════════════════════════════════════


class TestBuildPatternContext:
    def test_no_patterns_returns_no_patterns_message(self):
        candles = [
            make_candle(close=102.0, open_=100.0, high=103.0, low=99.0, time=t)
            for t in range(1_700_000_000, 1_700_000_000 + 5 * 86400, 86400)
        ]
        result = _build_pattern_context(candles, n_bars=5)
        assert "No notable patterns" in result

    def test_pattern_context_includes_bullish_engulfing(self):
        t = 1_700_000_000
        candles = [
            make_candle(close=98.0, open_=102.0, high=103.0, low=97.0, time=t),
            make_candle(close=105.0, open_=96.0, high=106.0, low=95.0, time=t + 86400),
        ]
        result = _build_pattern_context(candles, n_bars=2)
        assert "Bullish Engulfing" in result

    def test_summary_line_present(self):
        t = 1_700_000_000
        candles = [
            make_candle(close=98.0, open_=102.0, high=103.0, low=97.0, time=t),
            make_candle(close=105.0, open_=96.0, high=106.0, low=95.0, time=t + 86400),
        ]
        result = _build_pattern_context(candles, n_bars=2)
        assert "Summary:" in result
        assert "bullish" in result


# ═══════════════════════════════════════════════════════════════
#  build_indicator_context — context_mode routing
# ═══════════════════════════════════════════════════════════════


class TestBuildIndicatorContextModes:
    def _make_candles(self, n=10):
        return trending_candles(n)

    def test_mode_none_has_no_context_block(self):
        result = build_indicator_context(
            symbol="AAPL", timeframe="D",
            candles=self._make_candles(), indicators=[],
            context_mode="none", context_bars=5,
        )
        assert "Price Summary" not in result
        assert "OHLCV History" not in result
        assert "Candlestick Patterns" not in result

    def test_mode_summary_appends_block(self):
        result = build_indicator_context(
            symbol="AAPL", timeframe="D",
            candles=self._make_candles(), indicators=[],
            context_mode="summary", context_bars=5,
        )
        assert "Price Summary" in result

    def test_mode_ohlcv_appends_table(self):
        result = build_indicator_context(
            symbol="AAPL", timeframe="D",
            candles=self._make_candles(), indicators=[],
            context_mode="ohlcv", context_bars=5,
        )
        assert "OHLCV History" in result
        assert "O=" in result

    def test_mode_patterns_appends_pattern_block(self):
        result = build_indicator_context(
            symbol="AAPL", timeframe="D",
            candles=self._make_candles(), indicators=[],
            context_mode="patterns", context_bars=10,
        )
        assert "Candlestick Patterns" in result


# ═══════════════════════════════════════════════════════════════
#  build_multi_timeframe_context — params forwarded
# ═══════════════════════════════════════════════════════════════


class TestBuildMultiTimeframeContext:
    def test_context_mode_applied_to_all_timeframes(self):
        candles = trending_candles(10)
        data = {
            "4H": {"candles": candles, "indicators": [], "fibonacci": None},
            "D":  {"candles": candles, "indicators": [], "fibonacci": None},
        }
        result = build_multi_timeframe_context(
            "AAPL", data, context_mode="summary", context_bars=5
        )
        # Both timeframe sections should have a Price Summary block
        assert result.count("Price Summary") == 2

    def test_default_mode_none_has_no_blocks(self):
        candles = trending_candles(10)
        data = {
            "D": {"candles": candles, "indicators": [], "fibonacci": None},
        }
        result = build_multi_timeframe_context("AAPL", data)
        assert "Price Summary" not in result
        assert "OHLCV History" not in result
        assert "Candlestick Patterns" not in result


# ═══════════════════════════════════════════════════════════════
#  AnalyzeRequest model validation
# ═══════════════════════════════════════════════════════════════


class TestAnalyzeRequestContextFields:
    def test_default_context_mode_is_none(self):
        from models import AnalyzeRequest
        req = AnalyzeRequest(conid=265598, symbol="AAPL")
        assert req.context_mode == "none"

    def test_default_context_bars_is_10(self):
        from models import AnalyzeRequest
        req = AnalyzeRequest(conid=265598, symbol="AAPL")
        assert req.context_bars == 10

    def test_valid_context_modes_accepted(self):
        from models import AnalyzeRequest
        for mode in ("none", "summary", "ohlcv", "patterns"):
            req = AnalyzeRequest(conid=265598, symbol="AAPL", context_mode=mode)
            assert req.context_mode == mode

    def test_invalid_context_mode_rejected(self):
        from pydantic import ValidationError
        from models import AnalyzeRequest
        with pytest.raises(ValidationError):
            AnalyzeRequest(conid=265598, symbol="AAPL", context_mode="full_chart")

    def test_context_bars_below_minimum_rejected(self):
        from pydantic import ValidationError
        from models import AnalyzeRequest
        with pytest.raises(ValidationError):
            AnalyzeRequest(conid=265598, symbol="AAPL", context_bars=4)

    def test_context_bars_above_maximum_rejected(self):
        from pydantic import ValidationError
        from models import AnalyzeRequest
        with pytest.raises(ValidationError):
            AnalyzeRequest(conid=265598, symbol="AAPL", context_bars=31)

    def test_context_bars_boundary_values_accepted(self):
        from models import AnalyzeRequest
        req_min = AnalyzeRequest(conid=265598, symbol="AAPL", context_bars=5)
        req_max = AnalyzeRequest(conid=265598, symbol="AAPL", context_bars=30)
        assert req_min.context_bars == 5
        assert req_max.context_bars == 30
