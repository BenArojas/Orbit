from __future__ import annotations

import pytest

from services.db import DatabaseService


@pytest.mark.asyncio
async def test_ai_settings_service_seeds_non_secret_provider_defaults():
    from services.ai_settings import AISettingsService

    db = DatabaseService(db_path=":memory:")
    await db.initialize()
    service = AISettingsService(db)

    providers = await service.list_provider_configs()

    assert [provider["provider_name"] for provider in providers] == [
        "ollama",
        "openrouter",
        "openai",
        "anthropic",
        "gemini",
        "grok",
    ]
    assert providers[0]["enabled"] is True
    assert providers[0]["kind"] == "local"
    assert all(provider["enabled"] is False for provider in providers[1:])
    assert all(provider["kind"] == "cloud" for provider in providers[1:])
    assert all(provider["api_key_ref"] is None for provider in providers)
    assert all("api_key" not in provider for provider in providers)
    assert all("secret" not in provider for provider in providers)

    await db.close()


@pytest.mark.asyncio
async def test_ai_settings_service_round_trips_routing_policy():
    from services.ai_settings import AISettingsService

    db = DatabaseService(db_path=":memory:")
    await db.initialize()
    service = AISettingsService(db)

    policy = await service.get_routing_policy()
    assert policy == {
        "routing_mode": "local_only",
        "local_fallback_enabled": True,
        "per_call_cost_cap_usd": 1.0,
        "monthly_cost_cap_usd": 25.0,
    }

    updated = await service.update_routing_policy(
        routing_mode="local_only",
        local_fallback_enabled=False,
        per_call_cost_cap_usd=2.5,
        monthly_cost_cap_usd=50.0,
    )

    assert updated == {
        "routing_mode": "local_only",
        "local_fallback_enabled": False,
        "per_call_cost_cap_usd": 2.5,
        "monthly_cost_cap_usd": 50.0,
    }
    assert await service.get_routing_policy() == updated

    await db.close()
