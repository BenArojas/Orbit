from __future__ import annotations

import json
from collections.abc import Callable

import httpx
import pytest


@pytest.mark.asyncio
async def test_openrouter_list_models_uses_authenticated_user_catalog():
    from services.ai_cloud_adapters import OpenRouterProvider

    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert request.url.path == "/api/v1/models/user"
        assert request.headers["authorization"] == "Bearer test-key"
        return httpx.Response(200, json={"data": []})

    client = httpx.AsyncClient(
        base_url="https://openrouter.ai",
        transport=httpx.MockTransport(handler),
    )
    provider = OpenRouterProvider(api_key="test-key", http_client=client)

    assert await provider.list_models() == []

    await client.aclose()


@pytest.mark.asyncio
async def test_openrouter_list_models_keeps_only_fixed_priced_text_models():
    from services.ai_cloud_adapters import OpenRouterProvider

    valid_model = {
        "id": "anthropic/claude-sonnet-4",
        "name": "Claude Sonnet 4",
        "context_length": 200000,
        "architecture": {
            "input_modalities": ["text"],
            "output_modalities": ["text"],
        },
        "supported_parameters": ["max_tokens"],
        "top_provider": {"max_completion_tokens": 4096},
        "pricing": {
            "prompt": "0.000003",
            "completion": "0.000015",
        },
    }
    invalid_models = [
        {**valid_model, "id": "openrouter/auto", "name": "Auto"},
        {**valid_model, "id": "openrouter/fusion", "name": "Fusion"},
        {
            **valid_model,
            "id": "example/image-only",
            "architecture": {
                "input_modalities": ["image"],
                "output_modalities": ["text"],
            },
        },
        {
            **valid_model,
            "id": "example/no-max-tokens",
            "supported_parameters": [],
        },
        {
            **valid_model,
            "id": "example/unknown-pricing",
            "pricing": {
                "prompt": "unknown",
                "completion": "0.000001",
                "request": "0",
            },
        },
    ]

    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"data": [valid_model, *invalid_models]})

    client = httpx.AsyncClient(
        base_url="https://openrouter.ai",
        transport=httpx.MockTransport(handler),
    )
    provider = OpenRouterProvider(api_key="test-key", http_client=client)

    models = await provider.list_models()

    assert [model.id for model in models] == ["anthropic/claude-sonnet-4"]
    assert models[0].name == "Claude Sonnet 4"
    assert models[0].context_length == 200000
    assert models[0].max_completion_tokens == 4096
    assert models[0].prompt_price_per_token == "0.000003"
    assert models[0].completion_price_per_token == "0.000015"
    assert models[0].request_price == "0"

    await client.aclose()


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
                    "completion_tokens_details": {"reasoning_tokens": 10},
                    "prompt_tokens_details": {"cached_tokens": 25},
                    "cost": 0.0123,
                },
                "id": "gen-123",
                "model": "anthropic/claude-sonnet-4",
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
    assert result.metadata.model == "anthropic/claude-sonnet-4"
    assert result.metadata.estimated_cost is None
    assert result.metadata.actual_cost == 0.0123
    assert result.provider_request_id == "gen-123"
    assert result.metadata.requested_model == "openrouter/auto"
    assert result.metadata.resolved_model == "anthropic/claude-sonnet-4"
    assert result.metadata.provider_request_id == "gen-123"
    assert result.metadata.input_tokens == 120
    assert result.metadata.output_tokens == 80
    assert result.metadata.reasoning_tokens == 10
    assert result.metadata.cached_tokens == 25
    assert result.metadata.duration_ms is not None
    assert requests[0].url.path == "/api/v1/chat/completions"

    await client.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("provider_cls_name", "provider_name", "base_url", "model", "response_json"),
    [
        (
            "OpenAIProvider",
            "openai",
            "https://api.openai.com",
            "gpt-5.2",
            {
                "id": "resp-123",
                "output_text": "OpenAI narrative.",
                "usage": {"input_tokens": 100, "output_tokens": 50},
            },
        ),
        (
            "AnthropicProvider",
            "anthropic",
            "https://api.anthropic.com",
            "claude-sonnet-4-5",
            {
                "id": "msg-123",
                "content": [{"type": "text", "text": "Anthropic narrative."}],
                "usage": {"input_tokens": 100, "output_tokens": 50},
            },
        ),
        (
            "GeminiProvider",
            "gemini",
            "https://generativelanguage.googleapis.com",
            "gemini-3.5-flash",
            {
                "responseId": "gem-123",
                "candidates": [
                    {
                        "content": {
                            "parts": [{"text": "Gemini narrative."}],
                        },
                    },
                ],
                "usageMetadata": {
                    "promptTokenCount": 100,
                    "candidatesTokenCount": 50,
                },
            },
        ),
        (
            "GrokProvider",
            "grok",
            "https://api.x.ai",
            "latest",
            {
                "id": "chatcmpl-123",
                "choices": [
                    {"message": {"content": "Grok narrative."}},
                ],
                "usage": {
                    "prompt_tokens": 100,
                    "completion_tokens": 50,
                },
            },
        ),
    ],
)
async def test_direct_provider_adapters_satisfy_read_only_metadata_contract(
    provider_cls_name: str,
    provider_name: str,
    base_url: str,
    model: str,
    response_json: dict,
):
    import services.ai_cloud_adapters as adapters

    requests: list[httpx.Request] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json=response_json)

    client = httpx.AsyncClient(
        base_url=base_url,
        transport=httpx.MockTransport(handler),
    )
    provider_cls: Callable[..., object] = getattr(adapters, provider_cls_name)
    provider = provider_cls(api_key="sk-test", http_client=client)

    result = await provider.chat_with_metadata(
        messages=[
            {"role": "system", "content": "You are a technical analyst."},
            {"role": "user", "content": "Analyze AAPL"},
        ],
        model=model,
    )

    expected_content = {
        "openai": "OpenAI narrative.",
        "anthropic": "Anthropic narrative.",
        "gemini": "Gemini narrative.",
        "grok": "Grok narrative.",
    }[provider_name]
    assert result.content == expected_content
    assert result.metadata.provider_name == provider_name
    assert result.metadata.kind == "cloud"
    assert result.metadata.model == model
    assert result.metadata.estimated_cost is None
    assert result.metadata.actual_cost is None
    assert result.metadata.fallback_used is False
    assert result.provider_request_id in {"resp-123", "msg-123", "gem-123", "chatcmpl-123"}
    assert requests, "adapter must issue an HTTP request"

    await client.aclose()


@pytest.mark.asyncio
async def test_openai_provider_uses_responses_contract():
    from services.ai_cloud_adapters import OpenAIProvider

    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/responses"
        assert request.headers["authorization"] == "Bearer sk-test"
        body = json.loads(request.content)
        assert body == {
            "model": "gpt-5.2",
            "input": [
                {"role": "system", "content": "You are a technical analyst."},
                {"role": "user", "content": "Analyze AAPL"},
            ],
        }
        return httpx.Response(
            200,
            json={"id": "resp-123", "output_text": "OpenAI narrative."},
        )

    client = httpx.AsyncClient(
        base_url="https://api.openai.com",
        transport=httpx.MockTransport(handler),
    )
    provider = OpenAIProvider(api_key="sk-test", http_client=client)

    await provider.chat_with_metadata(
        messages=[
            {"role": "system", "content": "You are a technical analyst."},
            {"role": "user", "content": "Analyze AAPL"},
        ],
        model="gpt-5.2",
    )

    await client.aclose()


@pytest.mark.asyncio
async def test_anthropic_provider_uses_messages_contract():
    from services.ai_cloud_adapters import AnthropicProvider

    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/messages"
        assert request.headers["x-api-key"] == "sk-test"
        assert request.headers["anthropic-version"] == "2023-06-01"
        body = json.loads(request.content)
        assert body == {
            "model": "claude-sonnet-4-5",
            "max_tokens": 4096,
            "system": "You are a technical analyst.",
            "messages": [{"role": "user", "content": "Analyze AAPL"}],
        }
        return httpx.Response(
            200,
            json={
                "id": "msg-123",
                "content": [{"type": "text", "text": "Anthropic narrative."}],
            },
        )

    client = httpx.AsyncClient(
        base_url="https://api.anthropic.com",
        transport=httpx.MockTransport(handler),
    )
    provider = AnthropicProvider(api_key="sk-test", http_client=client)

    await provider.chat_with_metadata(
        messages=[
            {"role": "system", "content": "You are a technical analyst."},
            {"role": "user", "content": "Analyze AAPL"},
        ],
        model="claude-sonnet-4-5",
    )

    await client.aclose()


@pytest.mark.asyncio
async def test_gemini_provider_uses_generate_content_contract():
    from services.ai_cloud_adapters import GeminiProvider

    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1beta/models/gemini-3.5-flash:generateContent"
        assert "sk-test" not in str(request.url)
        assert "key" not in request.url.params
        assert request.headers["x-goog-api-key"] == "sk-test"
        body = json.loads(request.content)
        assert body == {
            "systemInstruction": {
                "parts": [{"text": "You are a technical analyst."}],
            },
            "contents": [
                {
                    "role": "user",
                    "parts": [{"text": "Analyze AAPL"}],
                },
            ],
        }
        return httpx.Response(
            200,
            json={
                "responseId": "gem-123",
                "candidates": [
                    {"content": {"parts": [{"text": "Gemini narrative."}]}}
                ],
            },
        )

    client = httpx.AsyncClient(
        base_url="https://generativelanguage.googleapis.com",
        transport=httpx.MockTransport(handler),
    )
    provider = GeminiProvider(api_key="sk-test", http_client=client)

    await provider.chat_with_metadata(
        messages=[
            {"role": "system", "content": "You are a technical analyst."},
            {"role": "user", "content": "Analyze AAPL"},
        ],
        model="gemini-3.5-flash",
    )

    await client.aclose()


@pytest.mark.asyncio
async def test_grok_provider_uses_chat_completions_contract():
    from services.ai_cloud_adapters import GrokProvider

    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/chat/completions"
        assert request.headers["authorization"] == "Bearer sk-test"
        body = json.loads(request.content)
        assert body == {
            "model": "latest",
            "messages": [
                {"role": "system", "content": "You are a technical analyst."},
                {"role": "user", "content": "Analyze AAPL"},
            ],
        }
        return httpx.Response(
            200,
            json={
                "id": "chatcmpl-123",
                "choices": [{"message": {"content": "Grok narrative."}}],
            },
        )

    client = httpx.AsyncClient(
        base_url="https://api.x.ai",
        transport=httpx.MockTransport(handler),
    )
    provider = GrokProvider(api_key="sk-test", http_client=client)

    await provider.chat_with_metadata(
        messages=[
            {"role": "system", "content": "You are a technical analyst."},
            {"role": "user", "content": "Analyze AAPL"},
        ],
        model="latest",
    )

    await client.aclose()


@pytest.mark.asyncio
async def test_openrouter_provider_normalizes_stream_chunks_and_usage_cost():
    from services.ai_cloud_adapters import OpenRouterProvider

    sent_body = None

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal sent_body
        sent_body = json.loads(request.content)
        lines = [
            "data: " + json.dumps({"choices": [{"delta": {"content": "Cloud "}}]}),
            "data: " + json.dumps({"choices": [{"delta": {"content": "stream."}}]}),
            "data: " + json.dumps({
                "id": "gen-stream-123",
                "model": "anthropic/claude-sonnet-4",
                "choices": [],
                "usage": {
                    "prompt_tokens": 10,
                    "completion_tokens": 5,
                    "reasoning_tokens": 2,
                    "prompt_tokens_details": {"cached_tokens": 3},
                    "cost": 0.0042,
                },
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
            max_tokens=4096,
        )
    ]

    assert events[:2] == [
        {"type": "token", "content": "Cloud "},
        {"type": "token", "content": "stream."},
    ]
    metadata = events[2]["metadata"]
    assert metadata["requested_model"] == "openrouter/auto"
    assert metadata["resolved_model"] == "anthropic/claude-sonnet-4"
    assert metadata["provider_request_id"] == "gen-stream-123"
    assert metadata["input_tokens"] == 10
    assert metadata["output_tokens"] == 5
    assert metadata["reasoning_tokens"] == 2
    assert metadata["cached_tokens"] == 3
    assert metadata["actual_cost"] == 0.0042
    assert metadata["duration_ms"] >= 0
    assert sent_body["max_tokens"] == 4096

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
