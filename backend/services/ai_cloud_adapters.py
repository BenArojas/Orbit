"""Cloud AI provider adapters for Orbit.

Slice 5 starts with OpenRouter only, behind mocked network tests. Real cloud
calls stay disabled until a later manual smoke slice.
"""
from __future__ import annotations

import json
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
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


class AIProviderRequestError(RuntimeError):
    """Provider rejected a validly authenticated request."""


@dataclass(frozen=True)
class AIProviderTextResult:
    content: str
    metadata: AIProviderMetadata
    provider_request_id: str | None = None


@dataclass(frozen=True)
class OpenRouterModel:
    id: str
    name: str
    context_length: int
    max_completion_tokens: int
    prompt_price_per_token: str
    completion_price_per_token: str
    request_price: str


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

    async def list_models(self) -> list[OpenRouterModel]:
        try:
            response = await self._http.get(
                "/api/v1/models/user",
                headers=self._headers(),
            )
            await self._raise_for_status(response)
        except httpx.TimeoutException as exc:
            raise AIProviderTimeoutError("OpenRouter request timed out") from exc
        except httpx.NetworkError as exc:
            raise AIProviderNetworkError("OpenRouter network request failed") from exc

        models: list[OpenRouterModel] = []
        for raw_model in response.json().get("data", []):
            model = self._parse_model(raw_model)
            if model is not None:
                models.append(model)
        return models

    async def chat_with_metadata(
        self,
        *,
        messages: list[dict[str, str]],
        model: str,
        max_tokens: int | None = None,
    ) -> AIProviderTextResult:
        started_at = time.monotonic()
        data = await self._post_chat(
            messages=messages, model=model, stream=False, max_tokens=max_tokens,
        )
        content = (
            data.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
        )
        return AIProviderTextResult(
            content=content,
            metadata=self._metadata(
                model=model,
                usage=data.get("usage"),
                resolved_model=data.get("model"),
                provider_request_id=data.get("id"),
                duration_ms=int((time.monotonic() - started_at) * 1000),
            ),
            provider_request_id=data.get("id"),
        )

    async def chat_stream_with_metadata(
        self,
        *,
        messages: list[dict[str, str]],
        model: str,
        max_tokens: int | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        started_at = time.monotonic()
        payload = self._payload(
            messages=messages, model=model, stream=True, max_tokens=max_tokens,
        )
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
                    choices = data.get("choices") or [{}]
                    content = (
                        choices[0]
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
                                resolved_model=data.get("model"),
                                provider_request_id=data.get("id"),
                                duration_ms=int((time.monotonic() - started_at) * 1000),
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
        max_tokens: int | None = None,
    ) -> dict[str, Any]:
        try:
            response = await self._http.post(
                "/api/v1/chat/completions",
                json=self._payload(
                    messages=messages, model=model, stream=stream,
                    max_tokens=max_tokens,
                ),
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
        max_tokens: int | None = None,
    ) -> dict[str, Any]:
        payload = {
            "model": model,
            "messages": messages,
            "stream": stream,
        }
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens
        return payload

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

    @staticmethod
    def _parse_model(raw_model: dict[str, Any]) -> OpenRouterModel | None:
        model_id = raw_model.get("id")
        architecture = raw_model.get("architecture") or {}
        supported_parameters = raw_model.get("supported_parameters") or []
        top_provider = raw_model.get("top_provider") or {}
        pricing = raw_model.get("pricing") or {}
        context_length = raw_model.get("context_length")
        max_completion_tokens = top_provider.get("max_completion_tokens")

        if not isinstance(model_id, str) or model_id.startswith("openrouter/"):
            return None
        if "text" not in architecture.get("input_modalities", []):
            return None
        if "text" not in architecture.get("output_modalities", []):
            return None
        if "max_tokens" not in supported_parameters:
            return None
        if not isinstance(context_length, int) or context_length <= 0:
            return None
        if not isinstance(max_completion_tokens, int) or max_completion_tokens <= 0:
            return None

        price_values = (
            pricing.get("prompt"),
            pricing.get("completion"),
            pricing.get("request"),
        )
        if not all(isinstance(value, str) for value in price_values):
            return None
        try:
            if any(Decimal(value) < 0 for value in price_values):
                return None
        except InvalidOperation:
            return None

        return OpenRouterModel(
            id=model_id,
            name=raw_model.get("name") or model_id,
            context_length=context_length,
            max_completion_tokens=max_completion_tokens,
            prompt_price_per_token=price_values[0],
            completion_price_per_token=price_values[1],
            request_price=price_values[2],
        )

    async def aclose(self) -> None:
        await self._http.aclose()

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
        if response.status_code == 400:
            try:
                message = str(response.json().get("error", {}).get("message", ""))
            except (TypeError, ValueError):
                message = ""
            if "model" in message.lower() and any(
                marker in message.lower()
                for marker in ("no endpoint", "not found", "unavailable", "invalid")
            ):
                raise AIProviderModelUnavailableError("OpenRouter model unavailable")
            raise AIProviderRequestError("OpenRouter request rejected")
        raise AIProviderNetworkError(f"OpenRouter returned HTTP {response.status_code}")

    @staticmethod
    def _metadata(
        model: str,
        usage: dict[str, Any] | None,
        *,
        resolved_model: str | None = None,
        provider_request_id: str | None = None,
        duration_ms: int | None = None,
    ) -> AIProviderMetadata:
        cost = None
        if usage is not None and usage.get("cost") is not None:
            cost = float(usage["cost"])
        usage = usage or {}
        prompt_details = usage.get("prompt_tokens_details") or {}
        completion_details = usage.get("completion_tokens_details") or {}
        resolved_model = resolved_model or model
        return AIProviderMetadata(
            provider_name="openrouter",
            kind="cloud",
            model=resolved_model,
            estimated_cost=None,
            actual_cost=cost,
            fallback_used=False,
            requested_model=model,
            resolved_model=resolved_model,
            provider_request_id=provider_request_id,
            input_tokens=usage.get("prompt_tokens"),
            output_tokens=usage.get("completion_tokens"),
            reasoning_tokens=(
                usage.get("reasoning_tokens")
                or completion_details.get("reasoning_tokens")
            ),
            cached_tokens=prompt_details.get("cached_tokens"),
            duration_ms=duration_ms,
        )


class OpenAIProvider:
    """OpenAI Responses API adapter for read-only analysis calls."""

    name = "openai"

    def __init__(
        self,
        *,
        api_key: str,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self._api_key = api_key
        self._http = http_client or httpx.AsyncClient(
            base_url="https://api.openai.com",
            timeout=httpx.Timeout(connect=10.0, read=180.0, write=30.0, pool=30.0),
        )

    async def chat_with_metadata(
        self,
        *,
        messages: list[dict[str, str]],
        model: str,
    ) -> AIProviderTextResult:
        response = await self._post(
            "/v1/responses",
            json={"model": model, "input": messages},
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
            },
        )
        data = response.json()
        return AIProviderTextResult(
            content=_extract_openai_output_text(data),
            metadata=_cloud_metadata(provider_name="openai", model=model),
            provider_request_id=data.get("id"),
        )

    async def _post(
        self,
        url: str,
        *,
        json: dict[str, Any],
        headers: dict[str, str],
    ) -> httpx.Response:
        return await _post_json(self._http, "OpenAI", url, json=json, headers=headers)

    async def aclose(self) -> None:
        await self._http.aclose()


class AnthropicProvider:
    """Anthropic Messages API adapter for read-only analysis calls."""

    name = "anthropic"

    def __init__(
        self,
        *,
        api_key: str,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self._api_key = api_key
        self._http = http_client or httpx.AsyncClient(
            base_url="https://api.anthropic.com",
            timeout=httpx.Timeout(connect=10.0, read=180.0, write=30.0, pool=30.0),
        )

    async def chat_with_metadata(
        self,
        *,
        messages: list[dict[str, str]],
        model: str,
    ) -> AIProviderTextResult:
        payload = {
            "model": model,
            "max_tokens": 4096,
            **_anthropic_messages_payload(messages),
        }
        response = await _post_json(
            self._http,
            "Anthropic",
            "/v1/messages",
            json=payload,
            headers={
                "x-api-key": self._api_key,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
            },
        )
        data = response.json()
        return AIProviderTextResult(
            content=_extract_anthropic_text(data),
            metadata=_cloud_metadata(provider_name="anthropic", model=model),
            provider_request_id=data.get("id"),
        )

    async def aclose(self) -> None:
        await self._http.aclose()


class GeminiProvider:
    """Gemini GenerateContent API adapter for read-only analysis calls."""

    name = "gemini"

    def __init__(
        self,
        *,
        api_key: str,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self._api_key = api_key
        self._http = http_client or httpx.AsyncClient(
            base_url="https://generativelanguage.googleapis.com",
            timeout=httpx.Timeout(connect=10.0, read=180.0, write=30.0, pool=30.0),
        )

    async def chat_with_metadata(
        self,
        *,
        messages: list[dict[str, str]],
        model: str,
    ) -> AIProviderTextResult:
        response = await _post_json(
            self._http,
            "Gemini",
            f"/v1beta/models/{model}:generateContent",
            json=_gemini_generate_content_payload(messages),
            headers={
                "Content-Type": "application/json",
                "x-goog-api-key": self._api_key,
            },
        )
        data = response.json()
        return AIProviderTextResult(
            content=_extract_gemini_text(data),
            metadata=_cloud_metadata(provider_name="gemini", model=model),
            provider_request_id=data.get("responseId"),
        )

    async def aclose(self) -> None:
        await self._http.aclose()


class GrokProvider:
    """xAI Grok chat-completions adapter for read-only analysis calls."""

    name = "grok"

    def __init__(
        self,
        *,
        api_key: str,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self._api_key = api_key
        self._http = http_client or httpx.AsyncClient(
            base_url="https://api.x.ai",
            timeout=httpx.Timeout(connect=10.0, read=180.0, write=30.0, pool=30.0),
        )

    async def chat_with_metadata(
        self,
        *,
        messages: list[dict[str, str]],
        model: str,
    ) -> AIProviderTextResult:
        response = await _post_json(
            self._http,
            "Grok",
            "/v1/chat/completions",
            json={"model": model, "messages": messages},
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
            },
        )
        data = response.json()
        return AIProviderTextResult(
            content=_extract_chat_completion_text(data),
            metadata=_cloud_metadata(provider_name="grok", model=model),
            provider_request_id=data.get("id"),
        )

    async def aclose(self) -> None:
        await self._http.aclose()


async def _post_json(
    http_client: httpx.AsyncClient,
    provider_label: str,
    url: str,
    *,
    json: dict[str, Any],
    headers: dict[str, str],
    params: dict[str, str] | None = None,
) -> httpx.Response:
    try:
        response = await http_client.post(
            url,
            json=json,
            headers=headers,
            params=params,
        )
        await _raise_provider_status(response, provider_label)
        return response
    except httpx.TimeoutException as exc:
        raise AIProviderTimeoutError(f"{provider_label} request timed out") from exc
    except httpx.NetworkError as exc:
        raise AIProviderNetworkError(
            f"{provider_label} network request failed"
        ) from exc


async def _raise_provider_status(
    response: httpx.Response,
    provider_label: str,
) -> None:
    if response.status_code < 400:
        return
    if response.status_code in {401, 403}:
        raise AIProviderAuthError(f"{provider_label} authentication failed")
    if response.status_code == 404:
        raise AIProviderModelUnavailableError(f"{provider_label} model unavailable")
    if response.status_code == 429:
        raise AIProviderRateLimitError(f"{provider_label} rate limit reached")
    raise AIProviderNetworkError(
        f"{provider_label} returned HTTP {response.status_code}"
    )


def _cloud_metadata(*, provider_name: str, model: str) -> AIProviderMetadata:
    return AIProviderMetadata(
        provider_name=provider_name,
        kind="cloud",
        model=model,
        estimated_cost=None,
        actual_cost=None,
        fallback_used=False,
    )


def _extract_openai_output_text(data: dict[str, Any]) -> str:
    if isinstance(data.get("output_text"), str):
        return data["output_text"]
    parts: list[str] = []
    for item in data.get("output", []):
        for content in item.get("content", []):
            if content.get("type") == "output_text" and content.get("text"):
                parts.append(content["text"])
    return "".join(parts)


def _anthropic_messages_payload(messages: list[dict[str, str]]) -> dict[str, Any]:
    system_parts = [
        message["content"]
        for message in messages
        if message.get("role") == "system" and message.get("content")
    ]
    payload_messages = [
        {"role": message["role"], "content": message["content"]}
        for message in messages
        if message.get("role") != "system"
    ]
    payload: dict[str, Any] = {"messages": payload_messages}
    if system_parts:
        payload["system"] = "\n\n".join(system_parts)
    return payload


def _extract_anthropic_text(data: dict[str, Any]) -> str:
    return "".join(
        part.get("text", "")
        for part in data.get("content", [])
        if part.get("type") == "text"
    )


def _gemini_generate_content_payload(messages: list[dict[str, str]]) -> dict[str, Any]:
    system_parts = [
        {"text": message["content"]}
        for message in messages
        if message.get("role") == "system" and message.get("content")
    ]
    contents = [
        {
            "role": "model" if message.get("role") == "assistant" else "user",
            "parts": [{"text": message["content"]}],
        }
        for message in messages
        if message.get("role") != "system"
    ]
    payload: dict[str, Any] = {"contents": contents}
    if system_parts:
        payload["systemInstruction"] = {"parts": system_parts}
    return payload


def _extract_gemini_text(data: dict[str, Any]) -> str:
    parts: list[str] = []
    for candidate in data.get("candidates", []):
        for part in candidate.get("content", {}).get("parts", []):
            if part.get("text"):
                parts.append(part["text"])
    return "".join(parts)


def _extract_chat_completion_text(data: dict[str, Any]) -> str:
    return (
        data.get("choices", [{}])[0]
        .get("message", {})
        .get("content", "")
    )
