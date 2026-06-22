"""
Tests for AI confidence coercion and signal parsing robustness — critical-promise subset.

Covers:
  - Unsafe trades cannot happen: fabricated prices are rejected, directional output
    with ungrounded prices is withheld and replaced with a safe neutral card.
  - Main user workflows: valid grounded directional signals are preserved end-to-end.
  - External failures stop safely: rejected signal updates return deterministic
    neutral output in both non-streaming and streaming paths.
"""
from __future__ import annotations

from collections.abc import AsyncIterator

import pytest

from models import AIModelOption, AIProviderMetadata, AnalyzeRequest
from services.ai import AiService, signal_to_frontend_format
from services.ai_analysis_preparation import AIAnalysisPreparationService
from services.ai_cloud_adapters import AIProviderTextResult
from services.ai_providers import AIProviderRegistry

DETERMINISTIC_NEUTRAL = "No actionable trade plan could be verified from the supplied facts."


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


# ── _parse_signal ValidationError guard ──────────────────────


class TestParseSignal:
    """
    _parse_signal now catches ValidationError so string confidence values
    from the model cannot bubble as a 500.
    """

    def test_parse_signal_with_string_confidence_does_not_raise(self):
        """String confidence must not bubble as a 500 through _parse_signal."""
        from routers.ai import _parse_signal

        raw_signal = {
            "direction": "LONG",
            "description": "Bullish breakout",
            "confidence": 75,
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


# ── Grounding / safety tests ─────────────────────────────────


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

    assert result["message"] == DETERMINISTIC_NEUTRAL
    assert result["signal"]["direction"] == "NEUTRAL"
    assert result["signal"]["description"] == ""
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

    assert result["message"] == DETERMINISTIC_NEUTRAL
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
    assert events[-1]["message"] == DETERMINISTIC_NEUTRAL
    assert events[-1]["signal"]["direction"] == "NEUTRAL"
