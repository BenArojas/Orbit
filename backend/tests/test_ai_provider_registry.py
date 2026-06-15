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
