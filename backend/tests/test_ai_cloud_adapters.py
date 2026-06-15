from __future__ import annotations

import json

import httpx
import pytest


@pytest.mark.asyncio
async def test_openrouter_provider_normalizes_chat_response_and_usage_cost():
    from services.ai_cloud_adapters import OpenRouterProvider

    requests: list[httpx.Request] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        assert request.headers["authorization"] == "Bearer sk-test"
        body = json.loads(request.content)
        assert body == {
            "model": "openrouter/auto",
            "messages": [{"role": "user", "content": "Analyze AAPL"}],
            "stream": False,
        }
        return httpx.Response(
            200,
            json={
                "choices": [
                    {"message": {"content": "Cloud narrative."}},
                ],
                "usage": {
                    "prompt_tokens": 120,
                    "completion_tokens": 80,
                    "cost": 0.0123,
                },
                "id": "gen-123",
            },
        )

    client = httpx.AsyncClient(
        base_url="https://openrouter.ai",
        transport=httpx.MockTransport(handler),
    )
    provider = OpenRouterProvider(api_key="sk-test", http_client=client)

    result = await provider.chat_with_metadata(
        messages=[{"role": "user", "content": "Analyze AAPL"}],
        model="openrouter/auto",
    )

    assert result.content == "Cloud narrative."
    assert result.metadata.provider_name == "openrouter"
    assert result.metadata.kind == "cloud"
    assert result.metadata.model == "openrouter/auto"
    assert result.metadata.estimated_cost is None
    assert result.metadata.actual_cost == 0.0123
    assert result.provider_request_id == "gen-123"
    assert requests[0].url.path == "/api/v1/chat/completions"

    await client.aclose()


@pytest.mark.asyncio
async def test_openrouter_provider_normalizes_stream_chunks_and_usage_cost():
    from services.ai_cloud_adapters import OpenRouterProvider

    async def handler(_request: httpx.Request) -> httpx.Response:
        lines = [
            "data: " + json.dumps({"choices": [{"delta": {"content": "Cloud "}}]}),
            "data: " + json.dumps({"choices": [{"delta": {"content": "stream."}}]}),
            "data: " + json.dumps({
                "usage": {"prompt_tokens": 10, "completion_tokens": 5, "cost": 0.0042}
            }),
            "data: [DONE]",
            "",
        ]
        return httpx.Response(200, content="\n".join(lines))

    client = httpx.AsyncClient(
        base_url="https://openrouter.ai",
        transport=httpx.MockTransport(handler),
    )
    provider = OpenRouterProvider(api_key="sk-test", http_client=client)

    events = [
        event async for event in provider.chat_stream_with_metadata(
            messages=[{"role": "user", "content": "Analyze AAPL"}],
            model="openrouter/auto",
        )
    ]

    assert events == [
        {"type": "token", "content": "Cloud "},
        {"type": "token", "content": "stream."},
        {
            "type": "metadata",
            "metadata": {
                "provider_name": "openrouter",
                "kind": "cloud",
                "model": "openrouter/auto",
                "estimated_cost": None,
                "actual_cost": 0.0042,
                "fallback_used": False,
            },
        },
    ]

    await client.aclose()


@pytest.mark.asyncio
async def test_openrouter_provider_maps_provider_errors_to_typed_exceptions():
    from services.ai_cloud_adapters import (
        AIProviderRateLimitError,
        OpenRouterProvider,
    )

    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, json={"error": {"message": "rate limit"}})

    client = httpx.AsyncClient(
        base_url="https://openrouter.ai",
        transport=httpx.MockTransport(handler),
    )
    provider = OpenRouterProvider(api_key="sk-test", http_client=client)

    with pytest.raises(AIProviderRateLimitError):
        await provider.chat_with_metadata(
            messages=[{"role": "user", "content": "Analyze AAPL"}],
            model="openrouter/auto",
        )

    await client.aclose()
