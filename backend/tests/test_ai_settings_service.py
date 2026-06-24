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


