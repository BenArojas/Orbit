"""Tests for the fact-layer-based prompt builder."""
from __future__ import annotations

from models import CandleData, IndicatorResult, IndicatorValue
from services.prompt_builder import (
    build_analysis_user_message,
    build_indicator_context,
    build_system_prompt,
)
from services.prompt_facts import build_prompt_facts


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
        name=f"ema_{period}", type="overlay",
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

    def test_prompt_removes_institutional_claims_and_frames_atr_as_distance(self):
        out = build_system_prompt(
            indicators_display=["VWAP", "ATR", "OBV", "Volume"],
            indicator_names=["vwap", "atr", "obv", "volume"],
        )

        assert "institutional benchmark" not in out
        assert "institutional flow" not in out
        assert "do not prove institutional participation" in out
        assert "ATR is a distance, not an absolute price level" in out

    def test_analysis_user_message_makes_levels_conditional(self):
        out = build_analysis_user_message(
            symbol="AAPL",
            context="Verified Facts:\n- [D.ema.stack_bullish] Trend is up.",
            timeframes=["D"],
            indicators_requested=["EMA Stack"],
        )

        assert "Specific entry price with rationale" not in out
        assert "If any of entry, stop, or target lacks an exact grounded price" in out
        assert "both the prose and JSON must be NEUTRAL with null levels" in out
        assert "one fact ID per bracket" in out
        assert "at most 350 words before the JSON block" in out


class TestEmaFactPipeline:
    def test_ema_nine_indicator_result_reaches_build_prompt_facts(self):
        """IndicatorResult(name='ema_9') must produce a D.ema.* fact via build_prompt_facts."""
        candles = _candles([100.0 + i for i in range(25)])
        ema9 = IndicatorResult(
            name="ema_9", type="overlay",
            values=[IndicatorValue(time=1_700_000_000 + i * 86400, value=99.0 + i)
                    for i in range(25)],
            params={"period": 9},
        )
        blocks = build_prompt_facts(
            symbol="TEST",
            timeframe_data={"D": {"candles": candles, "indicators": [ema9], "fibs": [], "fibonacci": None}},
            indicator_priority=[],
        )
        fact_ids = {f.id for block in blocks for f in block.facts}
        assert any(fid.startswith("D.ema.") for fid in fact_ids), (
            f"No D.ema.* fact found; got {fact_ids}"
        )
