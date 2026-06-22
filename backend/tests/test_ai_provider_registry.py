from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from dataclasses import dataclass
from decimal import Decimal
from unittest.mock import AsyncMock, patch

import pytest

from services.ai import AiService


INLINE_JSON_NARRATIVE = (
    "AAPL is holding above the 21 EMA.\n\n"
    "```json\n"
    "{\n"
    '  "direction": "NEUTRAL", "confidence": 50, "description": "Trend continuation",\n'
    '  "entry": {}, "stop": {}, "target": {},\n'
    '  "confirmations": ["EMA support"], "cautions": [],\n'
    '  "meta": {"score": "7/10", "adx_trend": "Firm", "volume_signal": "Normal"}\n'
    "}\n"
    "```"
)

_GROUNDED_LONG_NARRATIVE = (
    "AAPL broke out above resistance.\n\n"
    "```json\n"
    "{\n"
    '  "direction": "LONG", "confidence": 72, "description": "Breakout continuation",\n'
    '  "entry":  {"price": 182.00, "source_fact_id": "close_0", "note": "breakout bar"},\n'
    '  "stop":   {"price": 177.00, "source_fact_id": "ema_21_0", "note": "EMA support"},\n'
    '  "target": {"price": 192.00, "source_fact_id": "swing_high_0", "note": "prior high"},\n'
    '  "confirmations": ["Volume breakout"], "cautions": [],\n'
    '  "meta": {}\n'
    "}\n"
    "```"
)
_GROUNDED_LONG_MAP = {
    "close_0":      frozenset([Decimal("182.00")]),
    "ema_21_0":     frozenset([Decimal("177.00")]),
    "swing_high_0": frozenset([Decimal("192.00")]),
}


@dataclass
class FakeProvider:
    name: str = "ollama"
    calls: list[dict] | None = None

    async def chat(self, *, messages: list[dict[str, str]], model: str, think: bool | None = None) -> str:
        if self.calls is None:
            self.calls = []
        self.calls.append({"kind": "chat", "messages": messages, "model": model, "think": think})
        return INLINE_JSON_NARRATIVE

    async def chat_stream(self, *, messages, model, think=None) -> AsyncIterator[str]:
        if False:
            yield ""

    async def warmup(self, *, model: str) -> None:
        return None


@dataclass
class FakeCloudProvider(FakeProvider):
    name: str = "openrouter"
    actual_cost: float = 0.0123
    fail: bool = False

    async def chat_with_metadata(self, *, messages, model):
        from models import AIProviderMetadata
        from services.ai_cloud_adapters import (
            AIProviderRateLimitError,
            AIProviderTextResult,
        )

        if self.calls is None:
            self.calls = []
        self.calls.append({"kind": "cloud_chat", "messages": messages, "model": model})
        if self.fail:
            raise AIProviderRateLimitError("rate limited")
        return AIProviderTextResult(
            content=INLINE_JSON_NARRATIVE,
            metadata=AIProviderMetadata(
                provider_name="openrouter",
                kind="cloud",
                model=model,
                estimated_cost=None,
                actual_cost=self.actual_cost,
                fallback_used=False,
            ),
            provider_request_id="gen-123",
        )

    async def chat_stream_with_metadata(self, *, messages, model) -> AsyncIterator[dict]:
        if self.calls is None:
            self.calls = []
        self.calls.append({"kind": "cloud_stream", "messages": messages, "model": model})
        yield {"type": "token", "content": INLINE_JSON_NARRATIVE}
        yield {
            "type": "metadata",
            "metadata": {
                "provider_name": "openrouter",
                "kind": "cloud",
                "model": model,
                "estimated_cost": None,
                "actual_cost": self.actual_cost,
                "fallback_used": False,
            },
        }


@pytest.mark.asyncio
async def test_concurrent_request_scoped_providers_never_mutate_singleton_registry():
    from services.ai_providers import AIProviderRegistry

    entered = 0
    both_entered = asyncio.Event()

    @dataclass
    class ConcurrentCloudProvider(FakeCloudProvider):
        request_id: str = ""

        async def chat_with_metadata(self, *, messages, model):
            nonlocal entered
            entered += 1
            if entered == 2:
                both_entered.set()
            await asyncio.wait_for(both_entered.wait(), timeout=1)
            return await super().chat_with_metadata(messages=messages, model=model)

    registry = AIProviderRegistry({"ollama": FakeProvider()})
    service = AiService(provider_registry=registry)
    first = ConcurrentCloudProvider(request_id="first")
    second = ConcurrentCloudProvider(request_id="second")
    kwargs = {
        "symbol": "AAPL",
        "timeframe_data": {"D": {"candles": [], "indicators": [], "fibonacci": None}},
        "indicators_display": ["RSI"],
        "indicator_names": ["rsi"],
        "model": "openrouter/auto",
        "provider_name": "openrouter",
    }

    results = await asyncio.gather(
        service.analyze(**kwargs, provider=first),
        service.analyze(**kwargs, provider=second),
    )

    assert len(results) == 2
    assert first.calls and second.calls
    assert registry.names() == ["ollama"]


@pytest.mark.asyncio
async def test_ai_service_analyze_falls_back_to_ollama_when_cloud_provider_fails():
    from services.ai_providers import AIProviderRegistry

    ollama = FakeProvider()
    openrouter = FakeCloudProvider(fail=True)
    svc = AiService(provider_registry=AIProviderRegistry({
        "ollama": ollama,
        "openrouter": openrouter,
    }))

    result = await svc.analyze(
        symbol="AAPL",
        timeframe_data={"D": {"candles": [], "indicators": [], "fibonacci": None}},
        indicators_display=["EMA Stack"],
        indicator_names=["ema_9", "ema_21", "ema_50", "ema_200"],
        model="openrouter/auto",
        provider_name="openrouter",
        fallback_model="gemma4:26b",
        allow_fallback=True,
    )

    assert result["signal"]["direction"] == "NEUTRAL"
    assert result["provider"] == {
        "provider_name": "ollama",
        "kind": "local",
        "model": "gemma4:26b",
        "estimated_cost": None,
        "actual_cost": None,
        "fallback_used": True,
    }
    assert openrouter.calls and openrouter.calls[0]["kind"] == "cloud_chat"
    assert ollama.calls and ollama.calls[0]["kind"] == "chat"


@pytest.mark.asyncio
async def test_ai_service_analyze_routes_grounded_long():
    """Grounded LONG signal passes validation and routes as LONG (promise #1)."""
    from services.ai_providers import AIProviderRegistry

    class GroundedFakeProvider(FakeProvider):
        async def chat(self, *, messages, model, think=None):  # type: ignore[override]
            return _GROUNDED_LONG_NARRATIVE

    svc = AiService(provider_registry=AIProviderRegistry({"ollama": GroundedFakeProvider()}))

    with patch.object(svc, "_prepare_analysis_payload", AsyncMock(return_value=(
        [{"role": "system", "content": "s"}, {"role": "user", "content": "u"}],
        _GROUNDED_LONG_MAP,
    ))):
        result = await svc.analyze(
            symbol="AAPL",
            timeframe_data={"D": {"candles": [], "indicators": [], "fibonacci": None}},
            indicators_display=["RSI"],
            indicator_names=["rsi"],
            model="gemma4:26b",
        )

    assert result["signal"]["direction"] == "LONG"
