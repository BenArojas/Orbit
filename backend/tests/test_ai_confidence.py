"""
Tests for AI confidence coercion and signal parsing robustness.

Covers:
  - _coerce_confidence: int passthrough, string labels, numeric strings,
    unknown strings, None, out-of-range ints
  - _parse_signal: does not crash on string confidence values (ValidationError guard)
  - signal_to_frontend_format: always emits an int confidence
"""
from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
from pydantic import ValidationError

from models import AIModelOption, AIProviderMetadata, AnalyzeRequest
from services.ai import AiService, _coerce_confidence, signal_to_frontend_format, strip_signal_json_from_response
from services.ai_analysis_preparation import AIAnalysisPreparationService
from services.ai_cloud_adapters import AIProviderTextResult
from services.ai_providers import AIProviderRegistry


GROUNDING_MAP = {
    "D.ema.price_near_21": frozenset({100.0}),
    "D.bbands.outside_lower": frozenset({98.0}),
    "D.fibonacci.target_extension_1272": frozenset({104.0}),
}


class _PromptStubAiService(AiService):
    async def _prepare_analysis_payload(self, **_kwargs):
        return (
            [
                {"role": "system", "content": "System prompt."},
                {"role": "user", "content": "User prompt."},
            ],
            GROUNDING_MAP,
        )


class _FakeProvider:
    def __init__(self, content: str) -> None:
        self.content = content

    async def chat(self, *, messages: list[dict[str, str]], model: str, think=None) -> str:
        assert messages
        del model, think
        return self.content

    async def chat_with_metadata(self, *, messages: list[dict[str, str]], model: str):
        assert messages
        return AIProviderTextResult(
            content=self.content,
            metadata=AIProviderMetadata(
                provider_name="ollama",
                kind="local",
                model=model,
                estimated_cost=None,
                actual_cost=None,
                fallback_used=False,
            ),
            provider_request_id=None,
        )

    async def chat_stream_with_metadata(
        self,
        *,
        messages: list[dict[str, str]],
        model: str,
        max_tokens: int | None = None,
    ) -> AsyncIterator[dict]:
        assert messages
        del max_tokens
        yield {"type": "token", "content": self.content}
        yield {
            "type": "metadata",
            "metadata": AIProviderMetadata(
                provider_name="ollama",
                kind="local",
                model=model,
                estimated_cost=None,
                actual_cost=None,
                fallback_used=False,
            ).model_dump(),
        }


def _service_for(content: str) -> _PromptStubAiService:
    return _PromptStubAiService(
        provider_registry=AIProviderRegistry({"ollama": _FakeProvider(content)})
    )


class _QueuedProvider(_FakeProvider):
    def __init__(self, contents: list[str]) -> None:
        self.contents = list(contents)

    def _next(self) -> str:
        assert self.contents, "No queued content left"
        return self.contents.pop(0)

    async def chat(self, *, messages: list[dict[str, str]], model: str, think=None) -> str:
        assert messages
        del model, think
        return self._next()

    async def chat_with_metadata(self, *, messages: list[dict[str, str]], model: str):
        assert messages
        return AIProviderTextResult(
            content=self._next(),
            metadata=AIProviderMetadata(
                provider_name="ollama",
                kind="local",
                model=model,
                estimated_cost=None,
                actual_cost=None,
                fallback_used=False,
            ),
            provider_request_id=None,
        )

    async def chat_stream_with_metadata(
        self,
        *,
        messages: list[dict[str, str]],
        model: str,
        max_tokens: int | None = None,
    ) -> AsyncIterator[dict]:
        assert messages
        del max_tokens
        yield {"type": "token", "content": self._next()}
        yield {
            "type": "metadata",
            "metadata": AIProviderMetadata(
                provider_name="ollama",
                kind="local",
                model=model,
                estimated_cost=None,
                actual_cost=None,
                fallback_used=False,
            ).model_dump(),
        }


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


@pytest.mark.asyncio
async def test_analyze_rejected_directional_output_returns_withheld_message_and_safe_neutral_card():
    service = _service_for(
        "LONG above support.\n\n```json\n"
        '{"direction":"LONG","confidence":"HIGH","description":"Bullish setup",'
        '"entry":{"price":999.0,"source_fact_id":"D.ema.price_near_21","note":"entry"},'
        '"stop":{"price":998.0,"source_fact_id":"D.bbands.outside_lower","note":"stop"},'
        '"target":{"price":1001.0,"source_fact_id":"D.fibonacci.target_extension_1272","note":"target"},'
        '"confirmations":["EMA stack"],"cautions":[],"meta":{"risk_reward":null}}\n```'
    )

    result = await service.analyze(
        symbol="AAPL",
        timeframe_data={},
        indicators_display=["EMA Stack"],
        indicator_names=["ema"],
        model="gemma4:26b",
    )

    assert result["message"] == "Orbit withheld the trade plan because it could not be verified."
    assert result["signal"]["direction"] == "NEUTRAL"
    assert [level["value"] for level in result["signal"]["levels"]] == ["—", "—", "—"]
    assert result["signal"]["meta"][0]["value"] == "—"


@pytest.mark.asyncio
async def test_analyze_preserves_valid_grounded_directional_narrative_and_card():
    service = _service_for(
        "Bullish continuation backed by [D.ema.price_near_21].\n\n```json\n"
        '{"direction":"LONG","confidence":72,"description":"Bullish setup",'
        '"entry":{"price":100.0,"source_fact_id":"D.ema.price_near_21","note":"entry"},'
        '"stop":{"price":98.0,"source_fact_id":"D.bbands.outside_lower","note":"stop"},'
        '"target":{"price":104.0,"source_fact_id":"D.fibonacci.target_extension_1272","note":"target"},'
        '"confirmations":["EMA stack"],"cautions":[],"meta":{"risk_reward":null}}\n```'
    )

    result = await service.analyze(
        symbol="AAPL",
        timeframe_data={},
        indicators_display=["EMA Stack"],
        indicator_names=["ema"],
        model="gemma4:26b",
    )

    assert result["message"] == "Bullish continuation backed by [D.ema.price_near_21]."
    assert result["signal"]["direction"] == "LONG"
    assert [level["value"] for level in result["signal"]["levels"]] == ["$100.00", "$98.00", "$104.00"]


@pytest.mark.asyncio
async def test_analyze_preserves_valid_model_neutral_narrative():
    service = _service_for(
        "Evidence is mixed and does not support an actionable setup.\n\n```json\n"
        '{"direction":"NEUTRAL","confidence":34,"description":"Mixed evidence",'
        '"entry":{"price":null,"source_fact_id":null,"note":"No grounded level"},'
        '"stop":{"price":null,"source_fact_id":null,"note":"No grounded level"},'
        '"target":{"price":null,"source_fact_id":null,"note":"No grounded level"},'
        '"confirmations":["Trend unclear"],"cautions":["Sparse evidence"],"meta":{"risk_reward":null}}\n```'
    )

    result = await service.analyze(
        symbol="AAPL",
        timeframe_data={},
        indicators_display=["EMA Stack"],
        indicator_names=["ema"],
        model="gemma4:26b",
    )

    assert result["message"] == "Evidence is mixed and does not support an actionable setup."
    assert result["signal"]["direction"] == "NEUTRAL"
    assert result["signal"]["description"] == "Mixed evidence"


@pytest.mark.asyncio
async def test_analyze_stream_done_message_uses_authoritative_withheld_text():
    service = _service_for(
        "LONG but malformed.\n\n```json\n"
        '{"direction":"LONG","confidence":70,"description":"Broken setup",'
        '"entry":{"price":100.0,"note":"entry"}'
    )

    events = [
        event
        async for event in service.analyze_stream(
            symbol="AAPL",
            timeframe_data={},
            indicators_display=["EMA Stack"],
            indicator_names=["ema"],
            model="gemma4:26b",
        )
    ]

    assert events[-1]["type"] == "done"
    assert events[-1]["message"] == "Orbit withheld the trade plan because it could not be verified."
    assert events[-1]["signal"]["direction"] == "NEUTRAL"


@pytest.mark.asyncio
async def test_analyze_prepared_stream_done_message_uses_authoritative_withheld_text():
    provider = _FakeProvider(
        "LONG but malformed.\n\n```json\n"
        '{"direction":"LONG","confidence":70,"description":"Broken setup",'
        '"entry":{"price":100.0,"note":"entry"}'
    )
    service = _PromptStubAiService(
        provider_registry=AIProviderRegistry({"ollama": provider})
    )
    preparation = AIAnalysisPreparationService()
    snapshot = await preparation.prepare(
        AnalyzeRequest(conid=265598, symbol="AAPL"),
        provider_name="openrouter",
        model=AIModelOption(
            id="anthropic/claude-sonnet-4",
            name="Claude Sonnet 4",
            context_length=200000,
            max_completion_tokens=4096,
            prompt_price_per_token="0.000003",
            completion_price_per_token="0.000015",
            request_price="0",
        ),
        messages=[{"role": "user", "content": "Analyze AAPL."}],
        fallback_enabled=False,
        grounding_map=GROUNDING_MAP,
    )

    events = [
        event
        async for event in service.analyze_prepared_stream(
            snapshot=snapshot,
            provider=provider,
            fallback_provider=None,
            grounding_map=GROUNDING_MAP,
        )
    ]

    assert events[-1]["type"] == "done"
    assert events[-1]["message"] == "Orbit withheld the trade plan because it could not be verified."
    assert events[-1]["signal"]["direction"] == "NEUTRAL"


@pytest.mark.asyncio
async def test_follow_up_rejected_signal_update_returns_withheld_message_and_safe_neutral_card():
    provider = _QueuedProvider([
        (
            "Initial grounded setup.\n\n```json\n"
            '{"direction":"LONG","confidence":72,"description":"Bullish setup",'
            '"entry":{"price":100.0,"source_fact_id":"D.ema.price_near_21","note":"entry"},'
            '"stop":{"price":98.0,"source_fact_id":"D.bbands.outside_lower","note":"stop"},'
            '"target":{"price":104.0,"source_fact_id":"D.fibonacci.target_extension_1272","note":"target"},'
            '"confirmations":["EMA stack"],"cautions":[],"meta":{"risk_reward":null}}\n```'
        ),
        (
            "Actually this is still a LONG.\n\n```json\n"
            '{"direction":"LONG","confidence":"HIGH","description":"Broken update",'
            '"entry":{"price":999.0,"source_fact_id":"D.ema.price_near_21","note":"entry"},'
            '"stop":{"price":998.0,"source_fact_id":"D.bbands.outside_lower","note":"stop"},'
            '"target":{"price":1001.0,"source_fact_id":"D.fibonacci.target_extension_1272","note":"target"},'
            '"confirmations":["EMA stack"],"cautions":[],"meta":{"risk_reward":null}}\n```'
        ),
    ])
    service = _PromptStubAiService(
        provider_registry=AIProviderRegistry({"ollama": provider})
    )

    analysis = await service.analyze(
        symbol="AAPL",
        timeframe_data={},
        indicators_display=["EMA Stack"],
        indicator_names=["ema"],
        model="gemma4:26b",
    )
    result = await service.follow_up(
        session_id=analysis["session_id"],
        message="Are the levels still valid?",
    )

    assert result["message"] == "Orbit withheld the trade plan because it could not be verified."
    assert result["signal"]["direction"] == "NEUTRAL"
    assert [level["value"] for level in result["signal"]["levels"]] == ["—", "—", "—"]


@pytest.mark.asyncio
async def test_follow_up_stream_rejected_signal_update_emits_authoritative_done_message():
    provider = _QueuedProvider([
        (
            "Initial grounded setup.\n\n```json\n"
            '{"direction":"LONG","confidence":72,"description":"Bullish setup",'
            '"entry":{"price":100.0,"source_fact_id":"D.ema.price_near_21","note":"entry"},'
            '"stop":{"price":98.0,"source_fact_id":"D.bbands.outside_lower","note":"stop"},'
            '"target":{"price":104.0,"source_fact_id":"D.fibonacci.target_extension_1272","note":"target"},'
            '"confirmations":["EMA stack"],"cautions":[],"meta":{"risk_reward":null}}\n```'
        ),
        (
            "Actually this is still a LONG.\n\n```json\n"
            '{"direction":"LONG","confidence":"HIGH","description":"Broken update",'
            '"entry":{"price":999.0,"source_fact_id":"D.ema.price_near_21","note":"entry"},'
            '"stop":{"price":998.0,"source_fact_id":"D.bbands.outside_lower","note":"stop"},'
            '"target":{"price":1001.0,"source_fact_id":"D.fibonacci.target_extension_1272","note":"target"},'
            '"confirmations":["EMA stack"],"cautions":[],"meta":{"risk_reward":null}}\n```'
        ),
    ])
    service = _PromptStubAiService(
        provider_registry=AIProviderRegistry({"ollama": provider})
    )

    analysis = await service.analyze(
        symbol="AAPL",
        timeframe_data={},
        indicators_display=["EMA Stack"],
        indicator_names=["ema"],
        model="gemma4:26b",
    )
    events = [
        event
        async for event in service.follow_up_stream(
            session_id=analysis["session_id"],
            message="Are the levels still valid?",
        )
    ]

    assert events[-1]["type"] == "done"
    assert events[-1]["message"] == "Orbit withheld the trade plan because it could not be verified."
    assert events[-1]["signal"]["direction"] == "NEUTRAL"


def test_strip_signal_json_from_response_removes_incomplete_trailing_fenced_json():
    text = (
        "Support held into the close.\n\n"
        "```json\n"
        '{"direction":"LONG","confidence":70'
    )

    assert strip_signal_json_from_response(text) == "Support held into the close."
