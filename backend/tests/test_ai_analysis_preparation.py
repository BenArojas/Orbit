from __future__ import annotations

import pytest

from models import AIModelOption, AnalyzeRequest


def _model() -> AIModelOption:
    return AIModelOption(
        id="anthropic/claude-sonnet-4",
        name="Claude Sonnet 4",
        context_length=200000,
        max_completion_tokens=4096,
        prompt_price_per_token="0.000003",
        completion_price_per_token="0.0000021484375",
        request_price="0",
    )


def _request() -> AnalyzeRequest:
    return AnalyzeRequest(
        conid=265598,
        symbol="AAPL",
        timeframes=["D"],
        indicators=["RSI"],
        provider_name="openrouter",
        model="anthropic/claude-sonnet-4",
    )


@pytest.mark.asyncio
async def test_prepare_rejects_prompt_that_exhausts_model_context():
    from services.ai_analysis_preparation import (
        AIAnalysisContextLimitError,
        AIAnalysisPreparationService,
    )

    service = AIAnalysisPreparationService(token_estimator=lambda _messages: 1000)
    model = _model().model_copy(update={"context_length": 1000})

    with pytest.raises(AIAnalysisContextLimitError):
        await service.prepare(
            _request(),
            provider_name="openrouter",
            model=model,
            messages=[{"role": "user", "content": "Analyze AAPL."}],
            fallback_enabled=False,
        )


@pytest.mark.asyncio
async def test_prepared_cloud_failure_uses_captured_local_fallback_model():
    from services.ai import AiService
    from services.ai_analysis_preparation import AIAnalysisPreparationService
    from services.ai_cloud_adapters import AIProviderNetworkError

    snapshot = await AIAnalysisPreparationService().prepare(
        _request(),
        provider_name="openrouter",
        model=_model(),
        messages=[{"role": "user", "content": "Analyze AAPL."}],
        fallback_enabled=True,
        local_model="gemma4:e4b",
    )

    class FailingCloud:
        async def chat_stream_with_metadata(self, **_kwargs):
            raise AIProviderNetworkError("offline")
            yield

    class LocalFallback:
        model = None

        async def chat_stream(self, *, model: str, **_kwargs):
            self.model = model
            yield "Local analysis."

        async def chat(self, **_kwargs):
            return ""

    local = LocalFallback()
    events = [
        event async for event in AiService().analyze_prepared_stream(
            snapshot=snapshot,
            provider=FailingCloud(),
            fallback_provider=local,
        )
    ]

    assert local.model == "gemma4:e4b"
    assert events[-1]["provider"]["fallback_used"] is True


@pytest.mark.asyncio
async def test_prepared_run_can_start_directly_on_captured_fallback():
    from services.ai import AiService
    from services.ai_analysis_preparation import AIAnalysisPreparationService

    snapshot = await AIAnalysisPreparationService().prepare(
        _request(),
        provider_name="openrouter",
        model=_model(),
        messages=[{"role": "user", "content": "Analyze AAPL."}],
        fallback_enabled=True,
        local_model="gemma4:e4b",
    )

    class LocalFallback:
        async def chat_stream(self, **_kwargs):
            yield "Local analysis."

        async def chat(self, **_kwargs):
            return ""

    events = [
        event async for event in AiService().analyze_prepared_stream(
            snapshot=snapshot,
            provider=None,
            fallback_provider=LocalFallback(),
        )
    ]

    assert events[-1]["provider"]["provider_name"] == "ollama"
    assert events[-1]["provider"]["fallback_used"] is True


