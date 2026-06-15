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
