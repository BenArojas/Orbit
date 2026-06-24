from __future__ import annotations

import httpx
import pytest


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


@pytest.mark.asyncio
async def test_openrouter_provider_maps_400_errors_without_leaking_response_body():
    from services.ai_cloud_adapters import (
        AIProviderModelUnavailableError,
        AIProviderRequestError,
        OpenRouterProvider,
    )

    responses = iter([
        {"error": {"message": "No endpoints found for requested model"}},
        {"error": {"message": "Rejected request containing secret prompt text"}},
    ])

    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json=next(responses))

    client = httpx.AsyncClient(
        base_url="https://openrouter.ai",
        transport=httpx.MockTransport(handler),
    )
    provider = OpenRouterProvider(api_key="sk-test", http_client=client)

    with pytest.raises(AIProviderModelUnavailableError):
        await provider.chat_with_metadata(
            messages=[{"role": "user", "content": "Analyze AAPL"}],
            model="missing/model",
        )

    with pytest.raises(AIProviderRequestError, match="OpenRouter request rejected") as exc:
        await provider.chat_with_metadata(
            messages=[{"role": "user", "content": "secret prompt text"}],
            model="valid/model",
        )
    assert "secret prompt text" not in str(exc.value)

    await client.aclose()
