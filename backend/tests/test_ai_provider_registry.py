from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass

import pytest

from services.ai import AiService


INLINE_JSON_NARRATIVE = (
    "AAPL is holding above the 21 EMA.\n\n"
    "```json\n"
    "{\n"
    '  "direction": "LONG", "confidence": 72, "description": "Trend continuation",\n'
    '  "entry": {"price": 180.0, "note": "pullback hold"},\n'
    '  "stop": {"price": 175.0, "note": "below structure"},\n'
    '  "target": {"price": 192.0, "note": "prior high"},\n'
    '  "confirmations": ["EMA support"], "cautions": [],\n'
    '  "meta": {"risk_reward": "1:2.4", "score": "7/10", "adx_trend": "Firm", "volume_signal": "Normal"}\n'
    "}\n"
    "```"
)


@dataclass
class FakeProvider:
    name: str = "ollama"
    calls: list[dict] | None = None

    async def chat(self, *, messages: list[dict[str, str]], model: str, think: bool | None = None) -> str:
        if self.calls is None:
            self.calls = []
        self.calls.append({"kind": "chat", "messages": messages, "model": model, "think": think})
        return INLINE_JSON_NARRATIVE

    async def chat_structured(
        self,
        *,
        messages: list[dict[str, str]],
        model: str,
        json_schema: dict,
        think: bool | None = None,
    ) -> dict:
        raise AssertionError("chat_structured should not be used by one-shot analyze")

    async def chat_stream(
        self,
        *,
        messages: list[dict[str, str]],
        model: str,
        think: bool | None = None,
    ) -> AsyncIterator[str]:
        if False:
            yield ""

    async def warmup(self, *, model: str) -> None:
        return None


@dataclass
class FakeCloudProvider(FakeProvider):
    name: str = "openrouter"
    actual_cost: float = 0.0123
    fail: bool = False

    async def chat_with_metadata(
        self,
        *,
        messages: list[dict[str, str]],
        model: str,
    ):
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

    async def chat_stream_with_metadata(
        self,
        *,
        messages: list[dict[str, str]],
        model: str,
    ) -> AsyncIterator[dict]:
        if self.calls is None:
            self.calls = []
        self.calls.append({"kind": "cloud_stream", "messages": messages, "model": model})
        yield {"type": "token", "content": "Cloud "}
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
async def test_ai_service_analyze_routes_through_provider_registry():
    from services.ai_providers import AIProviderRegistry

    provider = FakeProvider()
    registry = AIProviderRegistry({"ollama": provider})
    svc = AiService(provider_registry=registry)

    result = await svc.analyze(
        symbol="AAPL",
        timeframe_data={"D": {"candles": [], "indicators": [], "fibonacci": None}},
        indicators_display=["EMA Stack"],
        indicator_names=["ema_9", "ema_21", "ema_50", "ema_200"],
        model="gemma4:26b",
    )

    assert result["session_id"]
    assert result["signal"]["direction"] == "LONG"
    assert result["message"] == "AAPL is holding above the 21 EMA."
    assert provider.calls == [
        {
            "kind": "chat",
            "messages": provider.calls[0]["messages"],
            "model": "gemma4:26b",
            "think": None,
        }
    ]
    assert provider.calls[0]["messages"][0]["role"] == "system"
    assert provider.calls[0]["messages"][1]["role"] == "user"


@dataclass
class StreamingFakeProvider(FakeProvider):
    async def chat_stream(
        self,
        *,
        messages: list[dict[str, str]],
        model: str,
        think: bool | None = None,
    ) -> AsyncIterator[str]:
        if self.calls is None:
            self.calls = []
        self.calls.append({"kind": "stream", "model": model, "think": think})
        for token in ["Streamed narrative. ", INLINE_JSON_NARRATIVE]:
            yield token

    async def warmup(self, *, model: str) -> None:
        if self.calls is None:
            self.calls = []
        self.calls.append({"kind": "warmup", "model": model})


@pytest.mark.asyncio
async def test_ai_service_analyze_stream_routes_through_provider_registry():
    from services.ai_providers import AIProviderRegistry

    provider = StreamingFakeProvider()
    svc = AiService(provider_registry=AIProviderRegistry({"ollama": provider}))

    events = []
    async for event in svc.analyze_stream(
        symbol="AAPL",
        timeframe_data={"D": {"candles": [], "indicators": [], "fibonacci": None}},
        indicators_display=["EMA Stack"],
        indicator_names=["ema_9", "ema_21", "ema_50", "ema_200"],
        model="gemma4:26b",
    ):
        events.append(event)

    assert [event["type"] for event in events].count("token") == 2
    assert events[-1]["type"] == "done"
    assert events[-1]["signal"]["direction"] == "LONG"
    assert provider.calls[0]["kind"] == "stream"


@pytest.mark.asyncio
async def test_ai_service_warmup_routes_through_provider_registry():
    from services.ai_providers import AIProviderRegistry

    provider = StreamingFakeProvider()
    svc = AiService(provider_registry=AIProviderRegistry({"ollama": provider}))

    await svc.warmup("gemma4:26b")

    assert provider.calls == [{"kind": "warmup", "model": "gemma4:26b"}]


def test_default_registry_exposes_local_ollama_provider():
    from services.ai_providers import AIProviderRegistry, OllamaLLMProvider

    registry = AIProviderRegistry({"ollama": OllamaLLMProvider()})

    assert registry.names() == ["ollama"]
    assert registry.require("ollama").name == "ollama"


@pytest.mark.asyncio
async def test_ai_service_analyze_can_route_read_only_analysis_to_openrouter():
    from services.ai_providers import AIProviderRegistry

    ollama = FakeProvider()
    openrouter = FakeCloudProvider()
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
    )

    assert result["signal"]["direction"] == "LONG"
    assert result["provider"] == {
        "provider_name": "openrouter",
        "kind": "cloud",
        "model": "openrouter/auto",
        "estimated_cost": None,
        "actual_cost": 0.0123,
        "fallback_used": False,
    }
    assert openrouter.calls and openrouter.calls[0]["kind"] == "cloud_chat"
    assert ollama.calls is None


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

    assert result["signal"]["direction"] == "LONG"
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
async def test_ai_service_analyze_stream_can_route_to_openrouter_with_metadata():
    from services.ai_providers import AIProviderRegistry

    openrouter = FakeCloudProvider()
    svc = AiService(provider_registry=AIProviderRegistry({
        "ollama": FakeProvider(),
        "openrouter": openrouter,
    }))

    events = []
    async for event in svc.analyze_stream(
        symbol="AAPL",
        timeframe_data={"D": {"candles": [], "indicators": [], "fibonacci": None}},
        indicators_display=["EMA Stack"],
        indicator_names=["ema_9", "ema_21", "ema_50", "ema_200"],
        model="openrouter/auto",
        provider_name="openrouter",
    ):
        events.append(event)

    assert [event["type"] for event in events].count("token") == 2
    assert events[-1]["type"] == "done"
    assert events[-1]["provider"] == {
        "provider_name": "openrouter",
        "kind": "cloud",
        "model": "openrouter/auto",
        "estimated_cost": None,
        "actual_cost": 0.0123,
        "fallback_used": False,
    }
    assert openrouter.calls and openrouter.calls[0]["kind"] == "cloud_stream"
