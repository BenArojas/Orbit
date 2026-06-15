from __future__ import annotations

import json
from collections.abc import AsyncIterator
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


def _client(
    *,
    ollama_status: dict | None = None,
    ai: object | None = None,
    ibkr: object | None = None,
    db: object | None = None,
) -> TestClient:
    from deps import get_ai, get_ai_settings, get_db, get_ibkr, get_ollama
    from routers.ai import router

    status = ollama_status or {
        "state": "ready",
        "ready": True,
        "selected_model": "gemma4:26b",
        "error": None,
        "platform": "darwin",
    }

    class FakeOllama:
        def __init__(self) -> None:
            self.selected_model = status.get("selected_model")
 
        def status(self) -> dict:
            return status

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_ollama] = lambda: FakeOllama()
    app.dependency_overrides[get_ai_settings] = lambda: _FakeSettings()
    if ai is not None:
        app.dependency_overrides[get_ai] = lambda: ai
    if ibkr is not None:
        app.dependency_overrides[get_ibkr] = lambda: ibkr
    if db is not None:
        app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


class _FakeSettings:
    async def list_provider_configs(self) -> list[dict]:
        return [
            {
                "provider_name": "ollama",
                "display_name": "Ollama",
                "kind": "local",
                "enabled": True,
                "selected_model": None,
                "api_key_ref": None,
                "routing_role": "default",
                "settings": {},
            }
        ]

    async def get_routing_policy(self) -> dict:
        return {
            "routing_mode": "local_only",
            "local_fallback_enabled": True,
            "per_call_cost_cap_usd": 1.0,
            "monthly_cost_cap_usd": 25.0,
        }


class _FakeKeyStore:
    def __init__(self, *, unavailable: bool = False) -> None:
        self.unavailable = unavailable
        self.saved: list[tuple[str, str]] = []
        self.deleted: list[str] = []

    async def save_provider_key(self, provider_name: str, api_key: str) -> str:
        if self.unavailable:
            from services.ai_keystore import AIKeyStoreUnavailableError

            raise AIKeyStoreUnavailableError("OS keychain is unavailable")
        self.saved.append((provider_name, api_key))
        return f"macos-keychain:orbit-ai/{provider_name}"

    async def delete_provider_key(self, provider_name: str) -> None:
        if self.unavailable:
            from services.ai_keystore import AIKeyStoreUnavailableError

            raise AIKeyStoreUnavailableError("OS keychain is unavailable")
        self.deleted.append(provider_name)


def test_get_ai_providers_returns_local_ollama_default():
    client = _client()

    resp = client.get("/ai/providers")

    assert resp.status_code == 200
    body = resp.json()
    assert body["active_provider"] == "ollama"
    assert body["routing_mode"] == "local_only"
    assert body["cloud_enabled"] is False
    assert body["providers"][0]["provider_name"] == "ollama"
    assert body["providers"][0]["display_name"] == "Ollama"
    assert body["providers"][0]["kind"] == "local"
    assert body["providers"][0]["enabled"] is True
    assert body["providers"][0]["ready"] is True
    assert body["providers"][0]["selected_model"] == "gemma4:26b"
    assert body["providers"][0]["has_key"] is False
    assert body["providers"][0]["error"] is None


@pytest.mark.asyncio
async def test_get_ai_providers_returns_disabled_cloud_settings_shell():
    from deps import get_ai_settings, get_ollama
    from routers.ai import router
    from services.ai_settings import AISettingsService
    from services.db import DatabaseService

    db = DatabaseService(db_path=":memory:")
    await db.initialize()
    settings = AISettingsService(db)

    class FakeOllama:
        selected_model = "gemma4:26b"

        def status(self) -> dict:
            return {
                "state": "ready",
                "ready": True,
                "selected_model": "gemma4:26b",
                "error": None,
                "platform": "darwin",
            }

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_ai_settings] = lambda: settings
    app.dependency_overrides[get_ollama] = lambda: FakeOllama()
    client = TestClient(app)

    resp = client.get("/ai/providers")

    assert resp.status_code == 200
    providers = resp.json()["providers"]
    assert [provider["provider_name"] for provider in providers] == [
        "ollama",
        "openrouter",
        "openai",
        "anthropic",
        "gemini",
        "grok",
    ]
    assert providers[0]["enabled"] is True
    assert providers[0]["ready"] is True
    assert all(provider["enabled"] is False for provider in providers[1:])
    assert all(provider["ready"] is False for provider in providers[1:])
    assert all(provider["has_key"] is False for provider in providers)
    assert all("api_key" not in provider for provider in providers)

    await db.close()


@pytest.mark.asyncio
async def test_routing_policy_round_trips_non_secret_settings():
    from deps import get_ai_settings
    from routers.ai import router
    from services.ai_settings import AISettingsService
    from services.db import DatabaseService

    db = DatabaseService(db_path=":memory:")
    await db.initialize()
    settings = AISettingsService(db)

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_ai_settings] = lambda: settings
    client = TestClient(app)

    initial = client.get("/ai/routing-policy")
    assert initial.status_code == 200
    assert initial.json() == {
        "routing_mode": "local_only",
        "local_fallback_enabled": True,
        "per_call_cost_cap_usd": 1.0,
        "monthly_cost_cap_usd": 25.0,
    }

    updated = client.put(
        "/ai/routing-policy",
        json={
            "routing_mode": "local_only",
            "local_fallback_enabled": False,
            "per_call_cost_cap_usd": 2.5,
            "monthly_cost_cap_usd": 50.0,
        },
    )

    assert updated.status_code == 200
    assert updated.json() == {
        "routing_mode": "local_only",
        "local_fallback_enabled": False,
        "per_call_cost_cap_usd": 2.5,
        "monthly_cost_cap_usd": 50.0,
    }
    assert client.get("/ai/routing-policy").json() == updated.json()

    await db.close()


@pytest.mark.asyncio
async def test_provider_key_save_enables_cloud_provider_without_returning_secret_material():
    from deps import get_ai_keystore, get_ai_settings, get_ollama
    from routers.ai import router
    from services.ai_settings import AISettingsService
    from services.db import DatabaseService

    db = DatabaseService(db_path=":memory:")
    await db.initialize()
    settings = AISettingsService(db)
    key_store = _FakeKeyStore()

    class FakeOllama:
        selected_model = "gemma4:26b"

        def status(self) -> dict:
            return {
                "state": "ready",
                "ready": True,
                "selected_model": "gemma4:26b",
                "error": None,
                "platform": "darwin",
            }

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_ai_settings] = lambda: settings
    app.dependency_overrides[get_ai_keystore] = lambda: key_store
    app.dependency_overrides[get_ollama] = lambda: FakeOllama()
    client = TestClient(app)

    resp = client.post(
        "/ai/providers/openrouter/key",
        json={"api_key": "sk-or-secret"},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["provider_name"] == "openrouter"
    assert body["enabled"] is True
    assert body["has_key"] is True
    assert "sk-or-secret" not in json.dumps(body)
    assert "api_key" not in body
    assert key_store.saved == [("openrouter", "sk-or-secret")]

    configs = await settings.list_provider_configs()
    openrouter = next(
        provider for provider in configs
        if provider["provider_name"] == "openrouter"
    )
    assert openrouter["enabled"] is True
    assert openrouter["api_key_ref"] == "macos-keychain:orbit-ai/openrouter"
    assert "sk-or-secret" not in json.dumps(openrouter)

    await db.close()


@pytest.mark.asyncio
async def test_provider_key_delete_disables_cloud_provider_and_clears_key_ref():
    from deps import get_ai_keystore, get_ai_settings, get_ollama
    from routers.ai import router
    from services.ai_settings import AISettingsService
    from services.db import DatabaseService

    db = DatabaseService(db_path=":memory:")
    await db.initialize()
    settings = AISettingsService(db)
    key_store = _FakeKeyStore()

    class FakeOllama:
        selected_model = "gemma4:26b"

        def status(self) -> dict:
            return {
                "state": "ready",
                "ready": True,
                "selected_model": "gemma4:26b",
                "error": None,
                "platform": "darwin",
            }

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_ai_settings] = lambda: settings
    app.dependency_overrides[get_ai_keystore] = lambda: key_store
    app.dependency_overrides[get_ollama] = lambda: FakeOllama()
    client = TestClient(app)

    assert client.post(
        "/ai/providers/openrouter/key",
        json={"api_key": "sk-or-secret"},
    ).status_code == 200

    resp = client.delete("/ai/providers/openrouter/key")

    assert resp.status_code == 200
    body = resp.json()
    assert body["provider_name"] == "openrouter"
    assert body["enabled"] is False
    assert body["has_key"] is False
    assert key_store.deleted == ["openrouter"]

    configs = await settings.list_provider_configs()
    openrouter = next(
        provider for provider in configs
        if provider["provider_name"] == "openrouter"
    )
    assert openrouter["enabled"] is False
    assert openrouter["api_key_ref"] is None

    await db.close()


@pytest.mark.asyncio
async def test_provider_key_save_fails_closed_when_keychain_unavailable():
    from deps import get_ai_keystore, get_ai_settings, get_ollama
    from routers.ai import router
    from services.ai_settings import AISettingsService
    from services.db import DatabaseService

    db = DatabaseService(db_path=":memory:")
    await db.initialize()
    settings = AISettingsService(db)

    class FakeOllama:
        selected_model = "gemma4:26b"

        def status(self) -> dict:
            return {
                "state": "ready",
                "ready": True,
                "selected_model": "gemma4:26b",
                "error": None,
                "platform": "darwin",
            }

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_ai_settings] = lambda: settings
    app.dependency_overrides[get_ai_keystore] = lambda: _FakeKeyStore(unavailable=True)
    app.dependency_overrides[get_ollama] = lambda: FakeOllama()
    client = TestClient(app)

    resp = client.post(
        "/ai/providers/openrouter/key",
        json={"api_key": "sk-or-secret"},
    )

    assert resp.status_code == 503
    assert resp.json()["detail"] == {
        "error": "ai_keychain_unavailable",
        "message": "OS keychain is unavailable. Cloud AI providers remain disabled.",
    }
    assert "sk-or-secret" not in resp.text
    providers = client.get("/ai/providers").json()["providers"]
    assert providers[0]["provider_name"] == "ollama"
    assert providers[0]["enabled"] is True
    assert all(provider["enabled"] is False for provider in providers[1:])

    await db.close()


def test_analyze_stream_done_event_contains_local_provider_metadata():
    class FakeAi:
        async def analyze_stream(self, **_kwargs) -> AsyncIterator[dict]:
            yield {"type": "token", "content": "AAPL is constructive."}
            yield {
                "type": "done",
                "session_id": "session-1",
                "signal": None,
                "message": "AAPL is constructive.",
            }

    fake_ibkr = MagicMock()
    fake_ibkr.history = AsyncMock(return_value={"data": []})

    fake_db = MagicMock()
    fake_db.get_setting = AsyncMock(return_value=None)

    client = _client(ai=FakeAi(), ibkr=fake_ibkr, db=fake_db)

    with client.stream(
        "POST",
        "/ai/analyze/stream",
        json={
            "conid": 265598,
            "symbol": "AAPL",
            "timeframes": ["D"],
            "indicators": ["RSI"],
        },
    ) as resp:
        assert resp.status_code == 200
        frames = [
            json.loads(line.removeprefix("data: "))
            for line in resp.iter_lines()
            if line.startswith("data: ")
        ]

    done = frames[-1]
    assert done["type"] == "done"
    assert done["provider"] == {
        "provider_name": "ollama",
        "kind": "local",
        "model": "gemma4:26b",
        "estimated_cost": None,
        "actual_cost": None,
        "fallback_used": False,
    }
