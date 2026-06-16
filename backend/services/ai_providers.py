"""LLM provider boundary for Orbit AI.

The provider layer hides provider-specific request formats behind the existing
AiService prompt/session logic. v2 starts with only Ollama registered; cloud
providers are added in later slices after key storage and routing policy are
approved.
"""
from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from typing import Protocol

import httpx

from config import OLLAMA_HOST

log = logging.getLogger("parallax.ai.providers")


class LLMProvider(Protocol):
    name: str

    async def chat(
        self,
        *,
        messages: list[dict[str, str]],
        model: str,
        think: bool | None = None,
    ) -> str:
        ...

    async def chat_structured(
        self,
        *,
        messages: list[dict[str, str]],
        model: str,
        json_schema: dict,
        think: bool | None = None,
    ) -> dict:
        ...

    async def chat_stream(
        self,
        *,
        messages: list[dict[str, str]],
        model: str,
        think: bool | None = None,
    ) -> AsyncIterator[str]:
        ...

    async def warmup(self, *, model: str) -> None:
        ...

    async def aclose(self) -> None:
        ...


class AIProviderRegistry:
    """Resolve active LLM providers by stable provider name."""

    def __init__(self, providers: dict[str, LLMProvider]) -> None:
        self._providers = dict(providers)

    def require(self, name: str) -> LLMProvider:
        provider = self._providers.get(name)
        if provider is None:
            raise KeyError(f"AI provider is not registered: {name}")
        return provider

    def register(self, provider: LLMProvider) -> None:
        self._providers[provider.name] = provider

    def names(self) -> list[str]:
        return sorted(self._providers)


class OllamaLLMProvider:
    """Provider adapter for the existing local Ollama `/api/chat` contract."""

    name = "ollama"

    def __init__(self, http_client: httpx.AsyncClient | None = None) -> None:
        self._http = http_client or httpx.AsyncClient(
            base_url=OLLAMA_HOST,
            timeout=httpx.Timeout(120.0, connect=10.0),
        )

    async def chat(
        self,
        *,
        messages: list[dict[str, str]],
        model: str,
        think: bool | None = None,
    ) -> str:
        payload = self._base_payload(messages=messages, model=model, stream=False)
        if think is not None:
            payload["think"] = think
        try:
            resp = await self._http.post("/api/chat", json=payload)
            resp.raise_for_status()
            data = resp.json()
            return data.get("message", {}).get("content", "")
        except httpx.ConnectError:
            raise ConnectionError("Cannot connect to Ollama server")
        except httpx.TimeoutException:
            raise TimeoutError("Ollama request timed out (>120s)")
        except httpx.HTTPStatusError as e:
            raise RuntimeError(f"Ollama returned error: {e.response.status_code}")

    async def chat_structured(
        self,
        *,
        messages: list[dict[str, str]],
        model: str,
        json_schema: dict,
        think: bool | None = None,
    ) -> dict:
        payload = self._base_payload(messages=messages, model=model, stream=False)
        payload["format"] = json_schema
        payload["options"]["temperature"] = 0.2
        if think is not None:
            payload["think"] = think
        try:
            resp = await self._http.post("/api/chat", json=payload)
            resp.raise_for_status()
            data = resp.json()
            content = data.get("message", {}).get("content", "")
            return json.loads(content)
        except httpx.ConnectError:
            raise ConnectionError("Cannot connect to Ollama server")
        except httpx.TimeoutException:
            raise TimeoutError("Ollama request timed out (>120s)")
        except httpx.HTTPStatusError as e:
            raise RuntimeError(f"Ollama returned error: {e.response.status_code}")
        except json.JSONDecodeError as e:
            log.warning("Structured output returned invalid JSON: %s", e)
            raise ValueError(f"Model returned invalid JSON despite schema: {e}")

    async def chat_stream(
        self,
        *,
        messages: list[dict[str, str]],
        model: str,
        think: bool | None = None,
    ) -> AsyncIterator[str]:
        payload = self._base_payload(messages=messages, model=model, stream=True)
        if think is not None:
            payload["think"] = think
        try:
            async with self._http.stream(
                "POST",
                "/api/chat",
                json=payload,
                timeout=httpx.Timeout(connect=10.0, read=180.0, write=180.0, pool=180.0),
            ) as response:
                async for line in response.aiter_lines():
                    if not line.strip():
                        continue
                    try:
                        data = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    content = data.get("message", {}).get("content", "")
                    if content:
                        yield content
                    if data.get("done", False):
                        return
        except httpx.ConnectError:
            yield "\n\n[Error: Cannot connect to Ollama server]"
        except httpx.TimeoutException:
            yield "\n\n[Error: Request timed out]"

    async def warmup(self, *, model: str) -> None:
        payload = {
            "model": model,
            "messages": [{"role": "user", "content": "hi"}],
            "stream": False,
            "keep_alive": "20m",
            "options": {"num_predict": 1},
        }
        try:
            resp = await self._http.post("/api/chat", json=payload, timeout=30.0)
            resp.raise_for_status()
        except (httpx.ConnectError, httpx.TimeoutException, httpx.HTTPStatusError) as e:
            log.debug("Warmup request failed (non-fatal): %s", e)

    async def aclose(self) -> None:
        await self._http.aclose()

    @staticmethod
    def _base_payload(
        *,
        messages: list[dict[str, str]],
        model: str,
        stream: bool,
    ) -> dict:
        return {
            "model": model,
            "messages": messages,
            "stream": stream,
            "keep_alive": "20m",
            "options": {
                "temperature": 0.3,
                "num_predict": 4096,
            },
        }
