"""
Tests for AI confidence coercion and signal parsing robustness.

Covers:
  - _coerce_confidence: int passthrough, string labels, numeric strings,
    unknown strings, None, out-of-range ints
  - _parse_signal: does not crash on string confidence values (ValidationError guard)
  - signal_to_frontend_format: always emits an int confidence
"""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from services.ai import _coerce_confidence, signal_to_frontend_format


# ── _coerce_confidence ────────────────────────────────────────


class TestCoerceConfidence:
    def test_int_passthrough(self):
        assert _coerce_confidence(80) == 80

    def test_int_clamped_high(self):
        assert _coerce_confidence(150) == 100

    def test_int_clamped_low(self):
        assert _coerce_confidence(-10) == 0

    def test_string_high(self):
        assert _coerce_confidence("HIGH") == 75

    def test_string_high_lowercase(self):
        assert _coerce_confidence("high") == 75

    def test_string_medium(self):
        assert _coerce_confidence("MEDIUM") == 50

    def test_string_med(self):
        assert _coerce_confidence("MED") == 50

    def test_string_low(self):
        assert _coerce_confidence("LOW") == 25

    def test_numeric_string(self):
        assert _coerce_confidence("70") == 70

    def test_numeric_string_clamped(self):
        assert _coerce_confidence("200") == 100

    def test_unknown_string_defaults_to_50(self):
        assert _coerce_confidence("VERY_HIGH") == 50

    def test_none_defaults_to_50(self):
        assert _coerce_confidence(None) == 50

    def test_result_is_always_int(self):
        for val in ["HIGH", "low", 80, "70", None]:
            result = _coerce_confidence(val)
            assert isinstance(result, int), f"Expected int, got {type(result)} for {val!r}"


# ── signal_to_frontend_format ────────────────────────────────


class TestSignalToFrontendFormat:
    def _make_signal(self, confidence):
        return {
            "direction": "LONG",
            "description": "Test signal",
            "confidence": confidence,
            "entry": {"price": 100.0, "note": ""},
            "stop": {"price": 95.0, "note": ""},
            "target": {"price": 110.0, "note": ""},
            "meta": {"risk_reward": "2:1", "score": 8, "adx_trend": "strong", "volume_signal": "above"},
            "confirmations": [],
            "cautions": [],
        }

    def test_int_confidence_preserved(self):
        result = signal_to_frontend_format(self._make_signal(75))
        assert result["confidence"] == 75

    def test_string_high_confidence_coerced(self):
        result = signal_to_frontend_format(self._make_signal("HIGH"))
        assert result["confidence"] == 75
        assert isinstance(result["confidence"], int)

    def test_string_low_confidence_coerced(self):
        result = signal_to_frontend_format(self._make_signal("LOW"))
        assert result["confidence"] == 25

    def test_none_confidence_defaults_to_50(self):
        result = signal_to_frontend_format(self._make_signal(None))
        assert result["confidence"] == 50

    def test_missing_confidence_defaults_to_50(self):
        signal = self._make_signal(50)
        del signal["confidence"]
        result = signal_to_frontend_format(signal)
        assert result["confidence"] == 50

    def test_finalize_signal_normalizes_high_for_production_validation(self):
        from services.ai import AiService

        result = AiService._finalize_signal(
            {
                "direction": "LONG",
                "description": "Fact-backed setup",
                "confidence": "HIGH",
                "entry": {
                    "price": 100.0,
                    "source_fact_id": "D.ema.price_near_21",
                    "note": "entry",
                },
                "stop": {
                    "price": 98.0,
                    "source_fact_id": "D.bbands.outside_lower",
                    "note": "stop",
                },
                "target": {
                    "price": 104.0,
                    "source_fact_id": "D.fibonacci.target_extension_1272",
                    "note": "target",
                },
                "meta": {"risk_reward": None, "score": "6/10", "adx_trend": None, "volume_signal": None},
                "confirmations": [],
                "cautions": [],
            },
            grounding_map={
                "D.ema.price_near_21": frozenset({100.0, 98.0}),
                "D.bbands.outside_lower": frozenset({98.0}),
                "D.fibonacci.target_extension_1272": frozenset({104.0}),
            },
        )

        assert result is not None
        assert result["direction"] == "LONG"
        assert result["confidence"] == 75

    def test_finalize_signal_fails_closed_for_fabricated_prices(self):
        from services.ai import AiService

        result = AiService._finalize_signal(
            {
                "direction": "LONG",
                "description": "Fabricated setup",
                "confidence": "HIGH",
                "entry": {
                    "price": 999.0,
                    "source_fact_id": "D.ema.price_near_21",
                    "note": "entry",
                },
                "stop": {
                    "price": 998.0,
                    "source_fact_id": "D.bbands.outside_lower",
                    "note": "stop",
                },
                "target": {
                    "price": 1001.0,
                    "source_fact_id": "D.fibonacci.target_extension_1272",
                    "note": "target",
                },
                "meta": {"risk_reward": None, "score": "6/10", "adx_trend": None, "volume_signal": None},
                "confirmations": [],
                "cautions": [],
            },
            grounding_map={
                "D.ema.price_near_21": frozenset({100.0, 98.0}),
                "D.bbands.outside_lower": frozenset({98.0}),
                "D.fibonacci.target_extension_1272": frozenset({104.0}),
            },
        )

        assert result is not None
        assert result["direction"] == "NEUTRAL"
        assert result["confidence"] == 0


# ── _parse_signal ValidationError guard ──────────────────────


class TestParseSignal:
    """
    _parse_signal now catches ValidationError so string confidence values
    from the model cannot bubble as a 500.
    """

    def test_parse_signal_with_string_confidence_does_not_raise(self):
        """String confidence must not bubble as a 500 through _parse_signal."""
        from routers.ai import _parse_signal
        from services.ai import signal_to_frontend_format

        # Build a frontend-formatted signal (confidence already coerced to int)
        raw_signal = {
            "direction": "LONG",
            "description": "Bullish breakout",
            "confidence": 75,       # already coerced by signal_to_frontend_format
            "levels": [
                {"label": "Entry", "value": "$100.00", "sub": ""},
                {"label": "Stop", "value": "$95.00", "sub": "", "color": "red"},
                {"label": "Target", "value": "$110.00", "sub": "", "color": "green"},
            ],
            "meta": [
                {"label": "R:R", "value": "2:1"},
                {"label": "Score", "value": "8"},
                {"label": "ADX", "value": "strong"},
                {"label": "Vol", "value": "above"},
            ],
            "checks": [],
        }

        result = _parse_signal(raw_signal)
        assert result is not None
        assert result.confidence == 75

    def test_parse_signal_returns_none_on_missing_required_field(self):
        from routers.ai import _parse_signal

        bad_signal = {"direction": "LONG"}  # missing required fields
        result = _parse_signal(bad_signal)
        assert result is None
