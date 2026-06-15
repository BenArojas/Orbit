"""Cloud AI provider adapters for Orbit.

Slice 5 starts with OpenRouter only, behind mocked network tests. Real cloud
calls stay disabled until a later manual smoke slice.
"""
from __future__ import annotations

import json
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

import httpx

from models import AIProviderMetadata


class AIProviderAuthError(RuntimeError):
    """Provider rejected the configured API key."""


class AIProviderRateLimitError(RuntimeError):
    """Provider rate limit or quota pressure blocked the request."""


class AIProviderNetworkError(RuntimeError):
    """Provider network request failed."""


class AIProviderTimeoutError(RuntimeError):
    """Provider network request timed out."""


class AIProviderModelUnavailableError(RuntimeError):
    """Provider does not expose the requested model."""


@dataclass(frozen=True)
class AIProviderTextResult:
    content: str
    metadata: AIProviderMetadata
    provider_request_id: str | None = None


class OpenRouterProvider:
    """OpenRouter adapter for the chat completions contract."""

    name = "openrouter"

    def __init__(
        self,
        *,
        api_key: str,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self._api_key = api_key
        self._http = http_client or httpx.AsyncClient(
            base_url="https://openrouter.ai",
            timeout=httpx.Timeout(connect=10.0, read=180.0, write=30.0, pool=30.0),
        )

    async def chat_with_metadata(
        self,
        *,
        messages: list[dict[str, str]],
        model: str,
    ) -> AIProviderTextResult:
        data = await self._post_chat(messages=messages, model=model, stream=False)
        content = (
            data.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
        )
        return AIProviderTextResult(
            content=content,
            metadata=self._metadata(model=model, usage=data.get("usage")),
            provider_request_id=data.get("id"),
        )

    async def chat_stream_with_metadata(
        self,
        *,
        messages: list[dict[str, str]],
        model: str,
    ) -> AsyncIterator[dict[str, Any]]:
        payload = self._payload(messages=messages, model=model, stream=True)
        try:
            async with self._http.stream(
                "POST",
                "/api/v1/chat/completions",
                json=payload,
                headers=self._headers(),
            ) as response:
                await self._raise_for_status(response)
                async for line in response.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    raw = line.removeprefix("data: ").strip()
                    if not raw or raw == "[DONE]":
                        continue
                    try:
                        data = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    content = (
                        data.get("choices", [{}])[0]
                        .get("delta", {})
                        .get("content", "")
                    )
                    if content:
                        yield {"type": "token", "content": content}
                    if data.get("usage"):
                        yield {
                            "type": "metadata",
                            "metadata": self._metadata(
                                model=model,
                                usage=data.get("usage"),
                            ).model_dump(),
                        }
        except httpx.TimeoutException as exc:
            raise AIProviderTimeoutError("OpenRouter request timed out") from exc
        except httpx.NetworkError as exc:
            raise AIProviderNetworkError("OpenRouter network request failed") from exc

    async def _post_chat(
        self,
        *,
        messages: list[dict[str, str]],
        model: str,
        stream: bool,
    ) -> dict[str, Any]:
        try:
            response = await self._http.post(
                "/api/v1/chat/completions",
                json=self._payload(messages=messages, model=model, stream=stream),
                headers=self._headers(),
            )
            await self._raise_for_status(response)
            return response.json()
        except httpx.TimeoutException as exc:
            raise AIProviderTimeoutError("OpenRouter request timed out") from exc
        except httpx.NetworkError as exc:
            raise AIProviderNetworkError("OpenRouter network request failed") from exc

    @staticmethod
    def _payload(
        *,
        messages: list[dict[str, str]],
        model: str,
        stream: bool,
    ) -> dict[str, Any]:
        return {
            "model": model,
            "messages": messages,
            "stream": stream,
        }

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

    @staticmethod
    async def _raise_for_status(response: httpx.Response) -> None:
        if response.status_code < 400:
            return
        if response.status_code in {401, 403}:
            raise AIProviderAuthError("OpenRouter authentication failed")
        if response.status_code == 404:
            raise AIProviderModelUnavailableError("OpenRouter model unavailable")
        if response.status_code == 429:
            raise AIProviderRateLimitError("OpenRouter rate limit reached")
        raise AIProviderNetworkError(f"OpenRouter returned HTTP {response.status_code}")

    @staticmethod
    def _metadata(model: str, usage: dict[str, Any] | None) -> AIProviderMetadata:
        cost = None
        if usage is not None and usage.get("cost") is not None:
            cost = float(usage["cost"])
        return AIProviderMetadata(
            provider_name="openrouter",
            kind="cloud",
            model=model,
            estimated_cost=None,
            actual_cost=cost,
            fallback_used=False,
        )
