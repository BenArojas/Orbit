from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal

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
async def test_prepare_builds_exact_ephemeral_body_disclosure_and_cost():
    from services.ai_analysis_preparation import AIAnalysisPreparationService

    now = datetime(2026, 6, 18, tzinfo=UTC)
    messages = [
        {"role": "system", "content": "You are a technical analyst."},
        {"role": "user", "content": "Analyze AAPL."},
    ]
    service = AIAnalysisPreparationService(
        clock=lambda: now,
        token_estimator=lambda _messages: 1000,
    )

    snapshot = await service.prepare(
        _request(),
        provider_name="openrouter",
        model=_model(),
        messages=messages,
        fallback_enabled=True,
    )

    assert snapshot.request_body == {
        "model": "anthropic/claude-sonnet-4",
        "messages": messages,
        "stream": True,
        "max_tokens": 4096,
    }
    assert "IBKR credentials" in snapshot.disclosure.kept_local
    assert snapshot.cost.maximum_cost_usd == Decimal("0.0118000000000")
    assert snapshot.expires_at == now + timedelta(minutes=10)
    assert service.get_snapshot(snapshot.snapshot_id) is snapshot


@pytest.mark.asyncio
async def test_analyze_prepared_stream_uses_snapshot_messages_and_max_tokens():
    from models import AIProviderMetadata
    from services.ai import AiService
    from services.ai_analysis_preparation import AIAnalysisPreparationService

    messages = [{"role": "user", "content": "Analyze AAPL."}]
    snapshot = await AIAnalysisPreparationService(
        token_estimator=lambda _messages: 1000,
    ).prepare(
        _request(),
        provider_name="openrouter",
        model=_model(),
        messages=messages,
        fallback_enabled=False,
    )

    class FakeProvider:
        received = None

        async def chat_stream_with_metadata(self, **kwargs):
            self.received = kwargs
            yield {
                "type": "token",
                "content": (
                    "Constructive.\n```json\n"
                    '{"direction":"LONG","confidence":0.7,"description":"Setup",'
                    '"entry":{},"stop":{},"target":{},"meta":{},'
                    '"confirmations":[],"cautions":[]}\n```'
                ),
            }
            yield {
                "type": "metadata",
                "metadata": AIProviderMetadata(
                    provider_name="openrouter",
                    kind="cloud",
                    model=snapshot.model.id,
                    actual_cost=0.01,
                ).model_dump(),
            }

    provider = FakeProvider()
    events = [
        event async for event in AiService().analyze_prepared_stream(
            snapshot=snapshot,
            provider=provider,
            fallback_provider=None,
        )
    ]

    assert provider.received == {
        "messages": messages,
        "model": "anthropic/claude-sonnet-4",
        "max_tokens": 4096,
    }
    assert events[-1]["type"] == "done"


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


@pytest.mark.asyncio
async def test_prepare_evicts_oldest_snapshot_at_capacity():
    from services.ai_analysis_preparation import (
        AIAnalysisPreparationService,
        AIAnalysisSnapshotNotFoundError,
    )

    service = AIAnalysisPreparationService(max_snapshots=2)
    snapshots = [
        await service.prepare(
            _request(),
            provider_name="openrouter",
            model=_model(),
            messages=[{"role": "user", "content": f"Analyze AAPL {index}."}],
            fallback_enabled=False,
        )
        for index in range(3)
    ]

    with pytest.raises(AIAnalysisSnapshotNotFoundError):
        service.get_snapshot(snapshots[0].snapshot_id)
    assert service.get_snapshot(snapshots[-1].snapshot_id) is snapshots[-1]
