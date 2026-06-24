"""Tests for _finalize_signal_result and _finalize_analysis_response.

Protects the critical promise that:
- valid NEUTRAL preserves model confidence/description and gets status="neutral"
- grounding failure yields status="rejected", confidence=0, narrative=None
- directional is unchanged, status="directional", no warning
"""
from decimal import Decimal

import pytest

from services.ai import AiService, UNVERIFIED_TRADE_PLAN_MESSAGE
from services.ai_signal_validation import AISignalGroundingError


GROUNDING_MAP: dict = {
    "D.ema.price_near_21": frozenset({Decimal("25.50"), Decimal("27.00")}),
    "D.bbands.outside_lower": frozenset({Decimal("25.50"), Decimal("27.00")}),
    "D.fibonacci.target_extension_1272": frozenset({Decimal("31.50")}),
}


def _neutral_draft() -> dict:
    return {
        "direction": "NEUTRAL",
        "confidence": 42,
        "description": "Mixed signals — no clear setup.",
        "entry": {"price": None, "source_fact_id": None, "note": None},
        "stop": {"price": None, "source_fact_id": None, "note": None},
        "target": {"price": None, "source_fact_id": None, "note": None},
        "confirmations": [],
        "cautions": ["RSI inconclusive"],
        "meta": {"risk_reward": None, "score": None, "adx_trend": None, "volume_signal": None},
    }


def _long_draft() -> dict:
    return {
        "direction": "LONG",
        "confidence": 70,
        "description": "EMA stack bullish, close above all levels.",
        "entry": {"price": 27.0, "source_fact_id": "D.ema.price_near_21", "note": "entry"},
        "stop": {"price": 25.5, "source_fact_id": "D.bbands.outside_lower", "note": "stop"},
        "target": {"price": 31.5, "source_fact_id": "D.fibonacci.target_extension_1272", "note": "target"},
        "confirmations": ["EMA stack bullish"],
        "cautions": [],
        "meta": {"risk_reward": None, "score": None, "adx_trend": None, "volume_signal": None},
    }


def _rejected_draft() -> dict:
    raw = _long_draft()
    raw["entry"]["price"] = 999.0  # not in grounding map
    return raw


# ── _finalize_signal_result ────────────────────────────────────────────────


class TestFinalizeSignalResult:
    def test_valid_neutral_preserves_model_confidence(self):
        result = AiService._finalize_signal_result(_neutral_draft(), grounding_map=GROUNDING_MAP)
        assert result is not None
        assert result.status == "neutral"
        assert result.signal["confidence"] == 42

    def test_valid_neutral_preserves_model_description(self):
        result = AiService._finalize_signal_result(_neutral_draft(), grounding_map=GROUNDING_MAP)
        assert result is not None
        assert result.signal["description"] == "Mixed signals — no clear setup."

    def test_valid_neutral_has_warning(self):
        result = AiService._finalize_signal_result(_neutral_draft(), grounding_map=GROUNDING_MAP)
        assert result is not None
        assert result.warning == UNVERIFIED_TRADE_PLAN_MESSAGE

    def test_valid_neutral_has_null_levels(self):
        result = AiService._finalize_signal_result(_neutral_draft(), grounding_map=GROUNDING_MAP)
        assert result is not None
        levels = result.signal["levels"]
        # All three levels should show "—" (null value)
        assert all(lvl["value"] == "—" for lvl in levels)

    def test_grounding_failure_is_rejected(self):
        result = AiService._finalize_signal_result(_rejected_draft(), grounding_map=GROUNDING_MAP)
        assert result is not None
        assert result.status == "rejected"

    def test_rejected_has_confidence_zero(self):
        result = AiService._finalize_signal_result(_rejected_draft(), grounding_map=GROUNDING_MAP)
        assert result is not None
        assert result.signal["confidence"] == 0

    def test_rejected_has_warning(self):
        result = AiService._finalize_signal_result(_rejected_draft(), grounding_map=GROUNDING_MAP)
        assert result is not None
        assert result.warning == UNVERIFIED_TRADE_PLAN_MESSAGE

    def test_rejected_card_description_is_blank(self):
        result = AiService._finalize_signal_result(_rejected_draft(), grounding_map=GROUNDING_MAP)
        assert result is not None
        assert result.signal["description"] == ""

    def test_rejected_card_has_no_warning_in_checks(self):
        result = AiService._finalize_signal_result(_rejected_draft(), grounding_map=GROUNDING_MAP)
        assert result is not None
        assert all(
            check["text"] != UNVERIFIED_TRADE_PLAN_MESSAGE
            for check in result.signal["checks"]
        )

    def test_valid_directional_status(self):
        result = AiService._finalize_signal_result(_long_draft(), grounding_map=GROUNDING_MAP)
        assert result is not None
        assert result.status == "directional"

    def test_valid_directional_no_warning(self):
        result = AiService._finalize_signal_result(_long_draft(), grounding_map=GROUNDING_MAP)
        assert result is not None
        assert result.warning is None

    def test_none_raw_signal_returns_none(self):
        assert AiService._finalize_signal_result(None) is None


# ── _finalize_analysis_response ───────────────────────────────────────────


_RESPONSE_WITH_JSON = (
    "Mixed signals this week. RSI inconclusive.\n"
    "```json\n{\"direction\":\"NEUTRAL\"}\n```"
)
_RESPONSE_DIRECTIONAL = (
    "EMA stack bullish, price confirmed above all levels.\n"
    "```json\n{\"direction\":\"LONG\"}\n```"
)


class TestFinalizeAnalysisResponse:
    def test_neutral_narrative_present(self):
        resp = AiService._finalize_analysis_response(
            _RESPONSE_WITH_JSON, _neutral_draft(), grounding_map=GROUNDING_MAP
        )
        assert resp["status"] == "neutral"
        assert resp["narrative"] is not None
        assert "RSI inconclusive" in resp["narrative"]

    def test_neutral_warning_present(self):
        resp = AiService._finalize_analysis_response(
            _RESPONSE_WITH_JSON, _neutral_draft(), grounding_map=GROUNDING_MAP
        )
        assert resp["warning"] == UNVERIFIED_TRADE_PLAN_MESSAGE

    def test_neutral_message_is_warning_not_narrative(self):
        """Chat history for neutral gets the short warning, not the full narrative."""
        resp = AiService._finalize_analysis_response(
            _RESPONSE_WITH_JSON, _neutral_draft(), grounding_map=GROUNDING_MAP
        )
        assert resp["message"] == UNVERIFIED_TRADE_PLAN_MESSAGE

    def test_rejected_narrative_is_none(self):
        resp = AiService._finalize_analysis_response(
            _RESPONSE_WITH_JSON, _rejected_draft(), grounding_map=GROUNDING_MAP
        )
        assert resp["status"] == "rejected"
        assert resp["narrative"] is None

    def test_directional_narrative_present_no_warning(self):
        resp = AiService._finalize_analysis_response(
            _RESPONSE_DIRECTIONAL, _long_draft(), grounding_map=GROUNDING_MAP
        )
        assert resp["status"] == "directional"
        assert resp["narrative"] is not None
        assert resp["warning"] is None

    def test_directional_message_equals_narrative(self):
        resp = AiService._finalize_analysis_response(
            _RESPONSE_DIRECTIONAL, _long_draft(), grounding_map=GROUNDING_MAP
        )
        assert resp["message"] == resp["narrative"]

    def test_no_raw_signal_is_rejected(self):
        resp = AiService._finalize_analysis_response(
            "Some text with no JSON", None, grounding_map=GROUNDING_MAP
        )
        assert resp["status"] == "rejected"
        assert resp["narrative"] is None
        assert resp["warning"] == UNVERIFIED_TRADE_PLAN_MESSAGE

    def test_no_signal_card_description_is_blank(self):
        resp = AiService._finalize_analysis_response(
            "Some text with no JSON", None, grounding_map=GROUNDING_MAP
        )
        assert resp["signal"]["description"] == ""

    def test_no_signal_card_has_no_warning_in_checks(self):
        resp = AiService._finalize_analysis_response(
            "Some text with no JSON", None, grounding_map=GROUNDING_MAP
        )
        assert all(
            check["text"] != UNVERIFIED_TRADE_PLAN_MESSAGE
            for check in resp["signal"]["checks"]
        )

    def test_rejected_carries_raw_response_text(self):
        raw_text = "Some text with no JSON"
        resp = AiService._finalize_analysis_response(
            raw_text, _rejected_draft(), grounding_map=GROUNDING_MAP
        )
        assert resp["status"] == "rejected"
        assert resp["rejected_output"] == raw_text

    def test_no_signal_carries_raw_response_text(self):
        raw_text = "Model output with no parseable signal"
        resp = AiService._finalize_analysis_response(
            raw_text, None, grounding_map=GROUNDING_MAP
        )
        assert resp["rejected_output"] == raw_text

    def test_neutral_rejected_output_is_none(self):
        resp = AiService._finalize_analysis_response(
            _RESPONSE_WITH_JSON, _neutral_draft(), grounding_map=GROUNDING_MAP
        )
        assert resp["status"] == "neutral"
        assert resp["rejected_output"] is None

    def test_directional_rejected_output_is_none(self):
        resp = AiService._finalize_analysis_response(
            _RESPONSE_DIRECTIONAL, _long_draft(), grounding_map=GROUNDING_MAP
        )
        assert resp["status"] == "directional"
        assert resp["rejected_output"] is None
