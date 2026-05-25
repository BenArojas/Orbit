"""Tests for the fact-layer-based prompt builder."""
from __future__ import annotations

from models import CandleData, IndicatorResult, IndicatorValue
from services.prompt_builder import build_indicator_context, build_system_prompt


def _candles(closes: list[float]) -> list[CandleData]:
    return [
        CandleData(
            time=1_700_000_000 + i * 86400,
            open=c - 0.5, high=c + 1, low=c - 1, close=c, volume=1_000_000,
        )
        for i, c in enumerate(closes)
    ]


def _ema(period: int, values: list[float]) -> IndicatorResult:
    return IndicatorResult(
        name="ema", type="overlay",
        values=[
            IndicatorValue(time=1_700_000_000 + i * 86400, value=v)
            for i, v in enumerate(values)
        ],
        params={"period": period},
    )


class TestBuildIndicatorContextFromFacts:
    def test_renders_fact_ids_inline(self):
        candles = _candles([100.0 + i * 0.5 for i in range(25)])
        ema9 = _ema(9, [99.0 + i * 0.5 for i in range(25)])
        ema21 = _ema(21, [98.0 + i * 0.4 for i in range(25)])

        out = build_indicator_context(
            symbol="AAPL", timeframe="D",
            candles=candles, indicators=[ema9, ema21],
        )
        assert "D.ema." in out
        assert "Verified Facts" in out

    def test_does_not_emit_legacy_format_sections(self):
        candles = _candles([100.0] * 25)
        out = build_indicator_context(
            symbol="AAPL", timeframe="D",
            candles=candles, indicators=[],
        )
        # Legacy "Primary fib"/"Locked fib #1"/"Source: MANUAL" labels must NOT appear.
        assert "Primary fib" not in out
        assert "Locked fib #" not in out
        assert "Source: MANUAL" not in out

    def test_returns_empty_string_for_no_candles_and_no_indicators(self):
        out = build_indicator_context(
            symbol="AAPL", timeframe="D",
            candles=[], indicators=[],
        )
        assert out == ""

    def test_accepts_old_context_mode_param_without_crashing(self):
        candles = _candles([100.0] * 10)
        # Old callers pass context_mode — must not raise
        out = build_indicator_context(
            symbol="AAPL", timeframe="D",
            candles=candles, indicators=[],
            context_mode="summary", context_bars=5,
        )
        # The fact layer doesn't emit "Price Summary" (that was the old formatter)
        assert "Price Summary" not in out


class TestBuildSystemPrompt:
    def test_emits_canonical_hint_order(self):
        out = build_system_prompt(
            indicators_display=["RSI", "Fibonacci Retracement", "EMA Stack"],
            indicator_names=["rsi", "fibonacci", "ema"],
        )
        # Fibonacci hint must appear before EMA hint must appear before RSI hint
        f_idx = out.index("Fibonacci Retracement")
        e_idx = out.index("EMA Stack")
        r_idx = out.index("RSI")
        assert f_idx < e_idx < r_idx

    def test_indicators_provided_uses_display_names(self):
        out = build_system_prompt(
            indicators_display=["EMA Stack"],
            indicator_names=["ema"],
        )
        assert "EMA Stack" in out
        # backend name should not appear in the user-facing provided list
        provided_line = next(
            line for line in out.splitlines() if line.startswith("Indicators provided")
        )
        assert "ema" not in provided_line

    def test_no_contradictory_json_instruction(self):
        out = build_system_prompt(
            indicators_display=["RSI"],
            indicator_names=["rsi"],
        )
        assert "you do NOT need to include JSON" not in out
        assert "you do not need to include JSON" not in out

    def test_old_api_still_works(self):
        """Legacy callers with indicators= must not crash."""
        out = build_system_prompt(indicators=["rsi", "ema_9"])
        assert "Parallax AI" in out  # _SYSTEM_BASE still present
