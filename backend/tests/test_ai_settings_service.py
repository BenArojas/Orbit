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
        "active_provider": "ollama",
        "routing_mode": "local_only",
        "local_fallback_enabled": True,
    }

    updated = await service.update_routing_policy(
        active_provider="openrouter",
        routing_mode="cloud_with_local_fallback",
        local_fallback_enabled=True,
    )

    assert updated == {
        "active_provider": "openrouter",
        "routing_mode": "cloud_with_local_fallback",
        "local_fallback_enabled": True,
    }
    assert set(updated) == {
        "active_provider",
        "routing_mode",
        "local_fallback_enabled",
    }
    assert await service.get_routing_policy() == updated

    await db.close()


@pytest.mark.asyncio
async def test_ai_settings_service_persists_selected_provider_model_only():
    from services.ai_settings import AISettingsService

    db = DatabaseService(db_path=":memory:")
    await db.initialize()
    service = AISettingsService(db)
    await service.set_provider_key_ref(
        provider_name="openrouter",
        api_key_ref="macos-keychain:orbit-ai/openrouter",
    )

    updated = await service.set_provider_model(
        provider_name="openrouter",
        model="anthropic/claude-sonnet-4",
    )

    assert updated["selected_model"] == "anthropic/claude-sonnet-4"
    assert updated["api_key_ref"] == "macos-keychain:orbit-ai/openrouter"
    assert "api_key" not in updated

    await db.close()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("fallback_enabled", "expected_mode"),
    [
        (True, "cloud_with_local_fallback"),
        (False, "cloud_manual"),
    ],
)
async def test_ai_settings_service_migrates_hybrid_auto_routing_mode(
    fallback_enabled: bool,
    expected_mode: str,
):
    from services.ai_settings import AISettingsService

    db = DatabaseService(db_path=":memory:")
    await db.initialize()
    await db.update_ai_routing_policy(
        active_provider="openrouter",
        routing_mode="hybrid_auto",
        local_fallback_enabled=fallback_enabled,
    )

    policy = await AISettingsService(db).get_routing_policy()

    assert policy["routing_mode"] == expected_mode

    await db.close()
