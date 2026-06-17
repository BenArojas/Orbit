from __future__ import annotations

import json
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from models import AIModelOption, AnalyzeRequest


def _client(
    *,
    ollama_status: dict | None = None,
    ai: object | None = None,
    ibkr: object | None = None,
    db: object | None = None,
    preparation: object | None = None,
) -> TestClient:
    from deps import get_ai, get_ai_settings, get_db, get_ibkr, get_ollama
    from routers.ai import router
    from services.ai_analysis_preparation import AIAnalysisPreparationService

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
    app.state.ai_analysis_preparation = preparation or AIAnalysisPreparationService()
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
            "active_provider": "ollama",
            "routing_mode": "local_only",
            "local_fallback_enabled": True,
            "per_call_cost_cap_usd": 1.0,
            "monthly_cost_cap_usd": 25.0,
        }


class _FakeCloudSettings(_FakeSettings):
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
            },
            {
                "provider_name": "openrouter",
                "display_name": "OpenRouter",
                "kind": "cloud",
                "enabled": True,
                "selected_model": "anthropic/claude-sonnet-4",
                "api_key_ref": "macos-keychain:orbit-ai/openrouter",
                "routing_role": "manual",
                "settings": {},
            },
        ]

    async def get_routing_policy(self) -> dict:
        return {
            "active_provider": "openrouter",
            "routing_mode": "cloud_manual",
            "local_fallback_enabled": True,
            "per_call_cost_cap_usd": 1.0,
            "monthly_cost_cap_usd": 25.0,
        }


class _FakeLocalOnlyCloudSettings(_FakeCloudSettings):
    async def get_routing_policy(self) -> dict:
        return {
            "active_provider": "openrouter",
            "routing_mode": "local_only",
            "local_fallback_enabled": True,
            "per_call_cost_cap_usd": 1.0,
            "monthly_cost_cap_usd": 25.0,
        }


class _FakeCloudSettingsWithoutModel(_FakeCloudSettings):
    async def list_provider_configs(self) -> list[dict]:
        configs = await super().list_provider_configs()
        return [
            {**config, "selected_model": None}
            if config["provider_name"] == "openrouter"
            else config
            for config in configs
        ]


class _FakeLowCapCloudSettings(_FakeCloudSettings):
    async def get_routing_policy(self) -> dict:
        return {
            "active_provider": "openrouter",
            "routing_mode": "cloud_manual",
            "local_fallback_enabled": True,
            "per_call_cost_cap_usd": 0.01,
            "monthly_cost_cap_usd": 25.0,
        }


class _FakeNoFallbackCloudSettings(_FakeCloudSettings):
    async def get_routing_policy(self) -> dict:
        return {
            "active_provider": "openrouter",
            "routing_mode": "cloud_manual",
            "local_fallback_enabled": False,
            "per_call_cost_cap_usd": 1.0,
            "monthly_cost_cap_usd": 25.0,
        }


class _FakeUsageLedger:
    def __init__(
        self,
        *,
        monthly_actual_cost_usd: float = 0.0,
        monthly_estimated_cost_usd: float = 0.0,
    ) -> None:
        self.records: list[dict] = []
        self.summary = {
            "monthly_actual_cost_usd": monthly_actual_cost_usd,
            "monthly_estimated_cost_usd": monthly_estimated_cost_usd,
        }

    async def monthly_spend_summary(self) -> dict:
        return self.summary

    async def monthly_effective_spend_usd(self) -> float:
        return self.summary["monthly_actual_cost_usd"]

    async def record_usage(self, **kwargs) -> dict:
        self.records.append(kwargs)
        return {"id": len(self.records), **kwargs}


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


class _FakeReadableKeyStore(_FakeKeyStore):
    def __init__(self, *, api_key: str | None = "sk-runtime-secret") -> None:
        super().__init__()
        self.api_key = api_key
        self.reads: list[tuple[str, str]] = []

    async def get_provider_key(self, provider_name: str, api_key_ref: str) -> str:
        self.reads.append((provider_name, api_key_ref))
        if self.api_key is None:
            from services.ai_keystore import AIKeyStoreUnavailableError

            raise AIKeyStoreUnavailableError("OS keychain is unavailable")
        return self.api_key


def test_preview_returns_exact_body_without_starting_cloud_inference(
    monkeypatch: pytest.MonkeyPatch,
):
    from deps import get_ai_keystore, get_ai_settings
    from routers import ai as ai_router
    from services.ai_analysis_preparation import AIAnalysisPreparationService
    from services.ai_cloud_adapters import OpenRouterModel

    class FakeProvider:
        completion_calls = 0

        async def list_models(self) -> list[OpenRouterModel]:
            return [
                OpenRouterModel(
                    id="anthropic/claude-sonnet-4",
                    name="Claude Sonnet 4",
                    context_length=200000,
                    max_completion_tokens=4096,
                    prompt_price_per_token="0.000003",
                    completion_price_per_token="0.000015",
                    request_price="0",
                )
            ]

        async def aclose(self) -> None:
            return None

    class FakeAi:
        async def prepare_analysis_messages(self, **_kwargs) -> list[dict[str, str]]:
            return [{"role": "user", "content": "Analyze AAPL."}]

    monkeypatch.setattr(
        ai_router,
        "OpenRouterProvider",
        lambda *, api_key: FakeProvider(),
    )
    fake_ibkr = MagicMock()
    fake_ibkr.history = AsyncMock(return_value={"data": []})
    fake_db = MagicMock()
    fake_db.get_setting = AsyncMock(return_value=None)
    client = _client(
        ai=FakeAi(),
        ibkr=fake_ibkr,
        db=fake_db,
        preparation=AIAnalysisPreparationService(token_estimator=lambda _messages: 1000),
    )
    client.app.dependency_overrides[get_ai_settings] = lambda: _FakeCloudSettings()
    client.app.dependency_overrides[get_ai_keystore] = lambda: _FakeReadableKeyStore()

    response = client.post(
        "/ai/analysis/preview",
        json={
            "conid": 265598,
            "symbol": "AAPL",
            "timeframes": ["D"],
            "indicators": ["RSI"],
            "provider_name": "openrouter",
            "model": "anthropic/claude-sonnet-4",
        },
    )

    assert response.status_code == 200
    assert response.json()["request_body"] == {
        "model": "anthropic/claude-sonnet-4",
        "messages": [{"role": "user", "content": "Analyze AAPL."}],
        "stream": True,
        "max_tokens": 4096,
    }
    assert FakeProvider.completion_calls == 0


def test_cloud_stream_executes_snapshot_without_refetching_market_data(
    monkeypatch: pytest.MonkeyPatch,
):
    from deps import get_ai_keystore, get_ai_settings, get_ai_usage_ledger
    from routers import ai as ai_router
    from services.ai_analysis_preparation import AIAnalysisPreparationService
    from services.ai_cloud_adapters import OpenRouterModel

    class FakeProvider:
        async def list_models(self) -> list[OpenRouterModel]:
            return [
                OpenRouterModel(
                    id="anthropic/claude-sonnet-4",
                    name="Claude Sonnet 4",
                    context_length=200000,
                    max_completion_tokens=4096,
                    prompt_price_per_token="0.000003",
                    completion_price_per_token="0.000015",
                    request_price="0",
                )
            ]

        async def aclose(self) -> None:
            return None

    class FakeAi:
        executed_body = None

        async def prepare_analysis_messages(self, **_kwargs) -> list[dict[str, str]]:
            return [{"role": "user", "content": "Analyze AAPL."}]

        async def analyze_prepared_stream(self, *, snapshot, **_kwargs):
            self.executed_body = snapshot.request_body
            yield {
                "type": "done",
                "session_id": "session-1",
                "signal": None,
                "message": "Cloud narrative.",
                "provider": {
                    "provider_name": "openrouter",
                    "kind": "cloud",
                    "model": snapshot.model.id,
                    "estimated_cost": None,
                    "actual_cost": 0.01,
                    "fallback_used": False,
                },
            }

    monkeypatch.setattr(
        ai_router,
        "OpenRouterProvider",
        lambda *, api_key: FakeProvider(),
    )
    fake_ai = FakeAi()
    fake_ibkr = MagicMock()
    fake_ibkr.history = AsyncMock(return_value={"data": []})
    fake_db = MagicMock()
    fake_db.get_setting = AsyncMock(return_value=None)
    client = _client(
        ai=fake_ai,
        ibkr=fake_ibkr,
        db=fake_db,
        preparation=AIAnalysisPreparationService(token_estimator=lambda _messages: 1000),
    )
    client.app.dependency_overrides[get_ai_settings] = lambda: _FakeCloudSettings()
    client.app.dependency_overrides[get_ai_keystore] = lambda: _FakeReadableKeyStore()
    client.app.dependency_overrides[get_ai_usage_ledger] = lambda: _FakeUsageLedger()
    request = {
        "conid": 265598,
        "symbol": "AAPL",
        "timeframes": ["D"],
        "indicators": ["RSI"],
        "provider_name": "openrouter",
        "model": "anthropic/claude-sonnet-4",
    }

    preview = client.post("/ai/analysis/preview", json=request).json()
    with client.stream(
        "POST", "/ai/analyze/stream", json={"snapshot_id": preview["snapshot_id"]},
    ) as response:
        assert response.status_code == 200
        list(response.iter_lines())

    assert fake_ibkr.history.await_count == 1
    assert fake_ai.executed_body == preview["request_body"]


@pytest.mark.asyncio
async def test_cloud_stream_rejects_expired_snapshot_with_typed_error():
    from deps import get_ai_settings, get_ai_usage_ledger
    from services.ai_analysis_preparation import AIAnalysisPreparationService

    now = datetime(2026, 6, 18, tzinfo=UTC)
    clock = [now]
    preparation = AIAnalysisPreparationService(clock=lambda: clock[0])
    snapshot = await preparation.prepare(
        AnalyzeRequest(
            conid=265598,
            symbol="AAPL",
            timeframes=["D"],
            indicators=["RSI"],
            provider_name="openrouter",
            model="anthropic/claude-sonnet-4",
        ),
        provider_name="openrouter",
        model=AIModelOption(
            id="anthropic/claude-sonnet-4",
            name="Claude Sonnet 4",
            context_length=200000,
            max_completion_tokens=4096,
            prompt_price_per_token="0.000003",
            completion_price_per_token="0.000015",
            request_price="0",
        ),
        messages=[{"role": "user", "content": "Analyze AAPL."}],
        fallback_enabled=False,
    )
    clock[0] = now + timedelta(minutes=10)
    client = _client(
        ai=MagicMock(),
        ibkr=MagicMock(),
        db=MagicMock(),
        preparation=preparation,
    )
    client.app.dependency_overrides[get_ai_settings] = lambda: _FakeCloudSettings()
    client.app.dependency_overrides[get_ai_usage_ledger] = lambda: _FakeUsageLedger()

    response = client.post(
        "/ai/analyze/stream", json={"snapshot_id": snapshot.snapshot_id},
    )

    assert response.status_code == 410
    assert response.json()["detail"]["error"] == "ai_analysis_snapshot_expired"


@pytest.mark.asyncio
async def test_cloud_stream_rejects_snapshot_when_selected_model_changed(
    monkeypatch: pytest.MonkeyPatch,
):
    from deps import get_ai_keystore, get_ai_settings, get_ai_usage_ledger
    from routers import ai as ai_router
    from services.ai_analysis_preparation import AIAnalysisPreparationService

    class ChangedModelSettings(_FakeCloudSettings):
        async def list_provider_configs(self) -> list[dict]:
            configs = await super().list_provider_configs()
            return [
                {**config, "selected_model": "openai/gpt-5"}
                if config["provider_name"] == "openrouter"
                else config
                for config in configs
            ]

    class FakeProvider:
        async def aclose(self) -> None:
            return None

    monkeypatch.setattr(
        ai_router, "OpenRouterProvider", lambda *, api_key: FakeProvider(),
    )
    preparation = AIAnalysisPreparationService()
    snapshot = await preparation.prepare(
        AnalyzeRequest(
            conid=265598,
            symbol="AAPL",
            provider_name="openrouter",
            model="anthropic/claude-sonnet-4",
        ),
        provider_name="openrouter",
        model=AIModelOption(
            id="anthropic/claude-sonnet-4",
            name="Claude Sonnet 4",
            context_length=200000,
            max_completion_tokens=4096,
            prompt_price_per_token="0.000003",
            completion_price_per_token="0.000015",
            request_price="0",
        ),
        messages=[{"role": "user", "content": "Analyze AAPL."}],
        fallback_enabled=False,
    )
    client = _client(
        ai=MagicMock(), ibkr=MagicMock(), db=MagicMock(), preparation=preparation,
    )
    client.app.dependency_overrides[get_ai_settings] = lambda: ChangedModelSettings()
    client.app.dependency_overrides[get_ai_keystore] = lambda: _FakeReadableKeyStore()
    client.app.dependency_overrides[get_ai_usage_ledger] = lambda: _FakeUsageLedger()

    response = client.post(
        "/ai/analyze/stream", json={"snapshot_id": snapshot.snapshot_id},
    )

    assert response.status_code == 409
    assert response.json()["detail"]["error"] == "ai_analysis_snapshot_model_changed"


@pytest.mark.asyncio
async def test_cloud_stream_enforces_cost_cap_against_snapshot_maximum(
    monkeypatch: pytest.MonkeyPatch,
):
    from deps import get_ai_keystore, get_ai_settings, get_ai_usage_ledger
    from routers import ai as ai_router
    from services.ai_analysis_preparation import AIAnalysisPreparationService

    class CappedSettings(_FakeCloudSettings):
        async def get_routing_policy(self) -> dict:
            return {
                **await super().get_routing_policy(),
                "per_call_cost_cap_usd": 0.03,
            }

    class FakeProvider:
        async def aclose(self) -> None:
            return None

    class FakeAi:
        executed = False

        async def analyze_prepared_stream(self, **_kwargs):
            self.executed = True
            if False:
                yield {}

    monkeypatch.setattr(
        ai_router, "OpenRouterProvider", lambda *, api_key: FakeProvider(),
    )
    preparation = AIAnalysisPreparationService(token_estimator=lambda _messages: 1000)
    snapshot = await preparation.prepare(
        AnalyzeRequest(
            conid=265598,
            symbol="AAPL",
            provider_name="openrouter",
            model="anthropic/claude-sonnet-4",
        ),
        provider_name="openrouter",
        model=AIModelOption(
            id="anthropic/claude-sonnet-4",
            name="Claude Sonnet 4",
            context_length=200000,
            max_completion_tokens=4096,
            prompt_price_per_token="0.000003",
            completion_price_per_token="0.000015",
            request_price="0",
        ),
        messages=[{"role": "user", "content": "Analyze AAPL."}],
        fallback_enabled=False,
    )
    fake_ai = FakeAi()
    usage = _FakeUsageLedger()
    client = _client(
        ai=fake_ai, ibkr=MagicMock(), db=MagicMock(), preparation=preparation,
    )
    client.app.dependency_overrides[get_ai_settings] = lambda: CappedSettings()
    client.app.dependency_overrides[get_ai_keystore] = lambda: _FakeReadableKeyStore()
    client.app.dependency_overrides[get_ai_usage_ledger] = lambda: usage

    response = client.post(
        "/ai/analyze/stream", json={"snapshot_id": snapshot.snapshot_id},
    )

    assert snapshot.cost.estimated_cost_usd < Decimal("0.03")
    assert snapshot.cost.maximum_cost_usd > Decimal("0.03")
    assert response.status_code == 402
    assert response.json()["detail"]["error"] == "ai_cost_limit_exceeded"
    assert fake_ai.executed is False


def test_openrouter_models_returns_user_filtered_catalog_and_selected_model(
    monkeypatch: pytest.MonkeyPatch,
):
    from deps import get_ai_keystore, get_ai_settings
    from routers import ai as ai_router
    from services.ai_cloud_adapters import OpenRouterModel

    class FakeProvider:
        closed = False

        async def list_models(self) -> list[OpenRouterModel]:
            return [
                OpenRouterModel(
                    id="anthropic/claude-sonnet-4",
                    name="Claude Sonnet 4",
                    context_length=200000,
                    max_completion_tokens=4096,
                    prompt_price_per_token="0.000003",
                    completion_price_per_token="0.000015",
                    request_price="0",
                )
            ]

        async def aclose(self) -> None:
            self.closed = True

    provider = FakeProvider()
    settings = _FakeCloudSettings()
    key_store = _FakeReadableKeyStore()
    monkeypatch.setattr(
        ai_router,
        "OpenRouterProvider",
        lambda *, api_key: provider,
    )

    app = FastAPI()
    app.include_router(ai_router.router)
    app.dependency_overrides[get_ai_settings] = lambda: settings
    app.dependency_overrides[get_ai_keystore] = lambda: key_store

    response = TestClient(app).get("/ai/providers/openrouter/models")

    assert response.status_code == 200
    assert response.json()["selected_model"] == "anthropic/claude-sonnet-4"
    assert response.json()["models"][0]["id"] == "anthropic/claude-sonnet-4"
    assert key_store.reads == [
        ("openrouter", "macos-keychain:orbit-ai/openrouter")
    ]
    assert provider.closed is True


def test_select_openrouter_model_rejects_model_missing_from_catalog(
    monkeypatch: pytest.MonkeyPatch,
):
    from deps import get_ai_keystore, get_ai_settings
    from routers import ai as ai_router
    from services.ai_cloud_adapters import OpenRouterModel

    class FakeProvider:
        async def list_models(self) -> list[OpenRouterModel]:
            return [
                OpenRouterModel(
                    id="anthropic/claude-sonnet-4",
                    name="Claude Sonnet 4",
                    context_length=200000,
                    max_completion_tokens=4096,
                    prompt_price_per_token="0.000003",
                    completion_price_per_token="0.000015",
                    request_price="0",
                )
            ]

        async def aclose(self) -> None:
            return None

    class Settings(_FakeCloudSettings):
        selected: list[str] = []

        async def set_provider_model(self, *, provider_name: str, model: str) -> dict:
            self.selected.append(model)
            return {}

    settings = Settings()
    monkeypatch.setattr(
        ai_router,
        "OpenRouterProvider",
        lambda *, api_key: FakeProvider(),
    )

    app = FastAPI()
    app.include_router(ai_router.router)
    app.dependency_overrides[get_ai_settings] = lambda: settings
    app.dependency_overrides[get_ai_keystore] = lambda: _FakeReadableKeyStore()

    response = TestClient(app).put(
        "/ai/providers/openrouter/model",
        json={"model": "gemma4:e4b"},
    )

    assert response.status_code == 422
    assert response.json()["detail"]["error"] == "ai_provider_model_unavailable"
    assert settings.selected == []


@pytest.mark.asyncio
async def test_select_openrouter_model_persists_validated_catalog_model(
    monkeypatch: pytest.MonkeyPatch,
):
    from deps import get_ai_keystore, get_ai_settings
    from routers import ai as ai_router
    from services.ai_cloud_adapters import OpenRouterModel
    from services.ai_settings import AISettingsService
    from services.db import DatabaseService

    class FakeProvider:
        async def list_models(self) -> list[OpenRouterModel]:
            return [
                OpenRouterModel(
                    id="anthropic/claude-sonnet-4",
                    name="Claude Sonnet 4",
                    context_length=200000,
                    max_completion_tokens=4096,
                    prompt_price_per_token="0.000003",
                    completion_price_per_token="0.000015",
                    request_price="0",
                )
            ]

        async def aclose(self) -> None:
            return None

    db = DatabaseService(db_path=":memory:")
    await db.initialize()
    settings = AISettingsService(db)
    await settings.set_provider_key_ref(
        provider_name="openrouter",
        api_key_ref="macos-keychain:orbit-ai/openrouter",
    )
    monkeypatch.setattr(
        ai_router,
        "OpenRouterProvider",
        lambda *, api_key: FakeProvider(),
    )

    app = FastAPI()
    app.include_router(ai_router.router)
    app.dependency_overrides[get_ai_settings] = lambda: settings
    app.dependency_overrides[get_ai_keystore] = lambda: _FakeReadableKeyStore()

    response = TestClient(app).put(
        "/ai/providers/openrouter/model",
        json={"model": "anthropic/claude-sonnet-4"},
    )

    assert response.status_code == 200
    assert response.json()["selected_model"] == "anthropic/claude-sonnet-4"
    configs = await settings.list_provider_configs()
    openrouter = next(
        config for config in configs if config["provider_name"] == "openrouter"
    )
    assert openrouter["selected_model"] == "anthropic/claude-sonnet-4"
    assert openrouter["api_key_ref"] == "macos-keychain:orbit-ai/openrouter"

    await db.close()


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
        "active_provider": "ollama",
        "routing_mode": "local_only",
        "local_fallback_enabled": True,
        "per_call_cost_cap_usd": 1.0,
        "monthly_cost_cap_usd": 25.0,
    }

    updated = client.put(
        "/ai/routing-policy",
        json={
            "active_provider": "openrouter",
            "routing_mode": "cloud_manual",
            "local_fallback_enabled": False,
            "per_call_cost_cap_usd": 2.5,
            "monthly_cost_cap_usd": 50.0,
        },
    )

    assert updated.status_code == 200
    assert updated.json() == {
        "active_provider": "openrouter",
        "routing_mode": "cloud_manual",
        "local_fallback_enabled": False,
        "per_call_cost_cap_usd": 2.5,
        "monthly_cost_cap_usd": 50.0,
    }
    assert client.get("/ai/routing-policy").json() == updated.json()

    await db.close()


@pytest.mark.asyncio
async def test_get_ai_providers_exposes_selected_enabled_cloud_route():
    from deps import get_ai_settings, get_ollama
    from routers.ai import router

    class FakeOllama:
        selected_model = None

        def status(self) -> dict:
            return {"state": "not_installed", "ready": False, "selected_model": None}

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_ai_settings] = lambda: _FakeCloudSettings()
    app.dependency_overrides[get_ollama] = lambda: FakeOllama()

    response = TestClient(app).get("/ai/providers")

    assert response.status_code == 200
    assert response.json()["active_provider"] == "openrouter"
    assert response.json()["cloud_enabled"] is True


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


def test_cloud_analysis_requires_a_validated_selected_model(
    monkeypatch: pytest.MonkeyPatch,
):
    from deps import get_ai_keystore, get_ai_settings, get_ai_usage_ledger
    from routers import ai as ai_router
    from models import AIProviderMetadata

    class FakeProvider:
        async def aclose(self) -> None:
            return None

    class FakeAi:
        async def analyze(self, **kwargs) -> dict:
            return {
                "session_id": "session-1",
                "signal": None,
                "message": "Cloud narrative.",
                "provider": AIProviderMetadata(
                    provider_name="openrouter",
                    kind="cloud",
                    model=kwargs["model"],
                ).model_dump(),
            }

    monkeypatch.setattr(
        ai_router,
        "OpenRouterProvider",
        lambda *, api_key: FakeProvider(),
    )
    fake_ibkr = MagicMock()
    fake_ibkr.history = AsyncMock(return_value={"data": []})
    fake_db = MagicMock()
    fake_db.get_setting = AsyncMock(return_value=None)
    client = _client(ai=FakeAi(), ibkr=fake_ibkr, db=fake_db)
    client.app.dependency_overrides[get_ai_settings] = (
        lambda: _FakeCloudSettingsWithoutModel()
    )
    client.app.dependency_overrides[get_ai_keystore] = lambda: _FakeReadableKeyStore()
    client.app.dependency_overrides[get_ai_usage_ledger] = lambda: _FakeUsageLedger()

    response = client.post(
        "/ai/analyze",
        json={
            "conid": 265598,
            "symbol": "AAPL",
            "timeframes": ["D"],
            "indicators": ["RSI"],
            "provider_name": "openrouter",
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"]["error"] == "ai_provider_model_required"


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


def test_analyze_returns_cloud_provider_metadata_for_enabled_openrouter():
    from deps import get_ai_keystore, get_ai_settings, get_ai_usage_ledger

    class FakeAi:
        async def analyze(self, **kwargs) -> dict:
            assert kwargs["provider_name"] == "openrouter"
            assert kwargs["model"] == "anthropic/claude-sonnet-4"
            assert kwargs["fallback_model"] == "gemma4:26b"
            assert kwargs["allow_fallback"] is True
            return {
                "session_id": "session-1",
                "signal": None,
                "message": "Cloud narrative.",
                "provider": {
                    "provider_name": "openrouter",
                    "kind": "cloud",
                    "model": "anthropic/claude-sonnet-4",
                    "estimated_cost": 0.02,
                    "actual_cost": 0.0123,
                    "fallback_used": False,
                },
            }

    fake_ibkr = MagicMock()
    fake_ibkr.history = AsyncMock(return_value={"data": []})
    fake_db = MagicMock()
    fake_db.get_setting = AsyncMock(return_value=None)

    client = _client(ai=FakeAi(), ibkr=fake_ibkr, db=fake_db)
    usage = _FakeUsageLedger()
    client.app.dependency_overrides[get_ai_settings] = lambda: _FakeCloudSettings()
    client.app.dependency_overrides[get_ai_usage_ledger] = lambda: usage
    client.app.dependency_overrides[get_ai_keystore] = lambda: _FakeReadableKeyStore()

    resp = client.post(
        "/ai/analyze",
        json={
            "conid": 265598,
            "symbol": "AAPL",
            "timeframes": ["D"],
            "indicators": ["RSI"],
            "provider_name": "openrouter",
        },
    )

    assert resp.status_code == 200
    assert resp.json()["provider"] == {
        "provider_name": "openrouter",
        "kind": "cloud",
        "model": "anthropic/claude-sonnet-4",
        "estimated_cost": 0.02,
        "actual_cost": 0.0123,
        "fallback_used": False,
    }
    assert usage.records == [
        {
            "provider_name": "openrouter",
            "model": "anthropic/claude-sonnet-4",
            "task_type": "analysis",
            "routing_mode": "cloud_manual",
            "input_tokens": None,
            "output_tokens": None,
            "estimated_cost": 0.02,
            "actual_cost": 0.0123,
            "status": "success",
            "provider_request_id": None,
            "error_code": None,
        }
    ]


def test_analyze_rejects_cloud_provider_when_routing_policy_is_local_only():
    from deps import get_ai_settings

    fake_ai = MagicMock()
    fake_ibkr = MagicMock()
    fake_ibkr.history = AsyncMock(return_value={"data": []})
    fake_db = MagicMock()
    fake_db.get_setting = AsyncMock(return_value=None)

    client = _client(ai=fake_ai, ibkr=fake_ibkr, db=fake_db)
    client.app.dependency_overrides[get_ai_settings] = (
        lambda: _FakeLocalOnlyCloudSettings()
    )

    resp = client.post(
        "/ai/analyze",
        json={
            "conid": 265598,
            "symbol": "AAPL",
            "timeframes": ["D"],
            "indicators": ["RSI"],
            "provider_name": "openrouter",
        },
    )

    assert resp.status_code == 400
    assert resp.json()["detail"] == {
        "error": "ai_cloud_routing_local_only",
        "message": "Cloud AI is disabled by the local-only routing policy.",
    }
    fake_ai.analyze.assert_not_called()


def test_analyze_stream_rejects_cloud_provider_when_routing_policy_is_local_only():
    from deps import get_ai_settings

    fake_ai = MagicMock()
    fake_ibkr = MagicMock()
    fake_ibkr.history = AsyncMock(return_value={"data": []})
    fake_db = MagicMock()
    fake_db.get_setting = AsyncMock(return_value=None)

    client = _client(ai=fake_ai, ibkr=fake_ibkr, db=fake_db)
    client.app.dependency_overrides[get_ai_settings] = (
        lambda: _FakeLocalOnlyCloudSettings()
    )

    resp = client.post(
        "/ai/analyze/stream",
        json={
            "conid": 265598,
            "symbol": "AAPL",
            "timeframes": ["D"],
            "indicators": ["RSI"],
            "provider_name": "openrouter",
        },
    )

    assert resp.status_code == 400
    assert resp.json()["detail"] == {
        "error": "ai_cloud_routing_local_only",
        "message": "Cloud AI is disabled by the local-only routing policy.",
    }
    fake_ai.analyze_stream.assert_not_called()


def test_analyze_keychain_failure_falls_back_to_ollama_with_truthful_usage():
    from deps import get_ai_keystore, get_ai_settings, get_ai_usage_ledger

    class FakeAi:
        async def analyze(self, **kwargs) -> dict:
            assert kwargs["provider_name"] == "ollama"
            assert kwargs["model"] == "gemma4:26b"
            return {
                "session_id": "fallback-session",
                "signal": None,
                "message": "Local fallback.",
                "provider": {"provider_name": "ollama", "kind": "local", "model": "gemma4:26b",
                             "estimated_cost": None, "actual_cost": None, "fallback_used": False},
            }

    fake_ibkr = MagicMock()
    fake_ibkr.history = AsyncMock(return_value={"data": []})
    fake_db = MagicMock()
    fake_db.get_setting = AsyncMock(return_value=None)
    usage = _FakeUsageLedger()
    client = _client(ai=FakeAi(), ibkr=fake_ibkr, db=fake_db)
    client.app.dependency_overrides[get_ai_settings] = lambda: _FakeCloudSettings()
    client.app.dependency_overrides[get_ai_keystore] = lambda: _FakeReadableKeyStore(api_key=None)
    client.app.dependency_overrides[get_ai_usage_ledger] = lambda: usage

    response = client.post("/ai/analyze", json={
        "conid": 265598, "symbol": "AAPL", "timeframes": ["D"],
        "indicators": ["RSI"], "provider_name": "openrouter",
    })

    assert response.status_code == 200
    assert response.json()["provider"]["provider_name"] == "ollama"
    assert response.json()["provider"]["fallback_used"] is True
    assert response.json()["provider"]["estimated_cost"] is None
    assert [record["status"] for record in usage.records] == ["failed", "fallback_success"]
    assert usage.records[0]["estimated_cost"] == 0.02
    assert usage.records[1]["estimated_cost"] is None


def test_analyze_stream_keychain_failure_falls_back_to_ollama():
    from deps import get_ai_keystore, get_ai_settings, get_ai_usage_ledger

    class FakeAi:
        async def analyze_stream(self, **kwargs) -> AsyncIterator[dict]:
            assert kwargs["provider_name"] == "ollama"
            yield {"type": "done", "session_id": "fallback-session", "signal": None,
                   "message": "Local fallback.",
                   "provider": {"provider_name": "ollama", "kind": "local", "model": "gemma4:26b",
                                "estimated_cost": None, "actual_cost": None, "fallback_used": False}}

    fake_ibkr = MagicMock()
    fake_ibkr.history = AsyncMock(return_value={"data": []})
    fake_db = MagicMock()
    fake_db.get_setting = AsyncMock(return_value=None)
    usage = _FakeUsageLedger()
    client = _client(ai=FakeAi(), ibkr=fake_ibkr, db=fake_db)
    client.app.dependency_overrides[get_ai_settings] = lambda: _FakeCloudSettings()
    client.app.dependency_overrides[get_ai_keystore] = lambda: _FakeReadableKeyStore(api_key=None)
    client.app.dependency_overrides[get_ai_usage_ledger] = lambda: usage

    with client.stream("POST", "/ai/analyze/stream", json={
        "conid": 265598, "symbol": "AAPL", "timeframes": ["D"],
        "indicators": ["RSI"], "provider_name": "openrouter",
    }) as response:
        frames = [json.loads(line.removeprefix("data: ")) for line in response.iter_lines()
                  if line.startswith("data: ")]

    assert frames[-1]["provider"]["provider_name"] == "ollama"
    assert frames[-1]["provider"]["fallback_used"] is True
    assert [record["status"] for record in usage.records] == ["failed", "fallback_success"]


def test_analyze_registers_enabled_openrouter_from_keychain_ref(monkeypatch):
    from deps import get_ai_keystore, get_ai_settings, get_ai_usage_ledger
    from services.ai import AiService
    from services.ai_cloud_adapters import AIProviderTextResult
    from services.ai_providers import AIProviderRegistry
    from models import AIProviderMetadata

    class FakeOllamaProvider:
        name = "ollama"

        async def chat(self, **_kwargs) -> str:
            return "Local fallback."

        async def chat_structured(self, **_kwargs) -> dict:
            return {}

        async def chat_stream(self, **_kwargs):
            if False:
                yield ""

        async def warmup(self, **_kwargs) -> None:
            return None

        async def aclose(self) -> None:
            return None

    class FakeOpenRouterProvider:
        name = "openrouter"
        seen_keys: list[str] = []
        calls = 0

        def __init__(self, *, api_key: str) -> None:
            self.seen_keys.append(api_key)

        async def chat_with_metadata(self, *, messages: list[dict[str, str]], model: str):
            assert messages
            self.__class__.calls += 1
            return AIProviderTextResult(
                content=(
                    "Cloud narrative.\n\n```json\n"
                    "{\"direction\":\"LONG\",\"confidence\":0.7,\"description\":\"Constructive\","
                    "\"entry\":{},\"stop\":{},\"target\":{},\"meta\":{},"
                    "\"confirmations\":[],\"cautions\":[]}\n```"
                ),
                metadata=AIProviderMetadata(
                    provider_name="openrouter",
                    kind="cloud",
                    model=model,
                    estimated_cost=None,
                    actual_cost=0.0123,
                    fallback_used=False,
                ),
                provider_request_id="gen-runtime-1",
            )

    monkeypatch.setattr(
        "routers.ai.OpenRouterProvider",
        FakeOpenRouterProvider,
        raising=False,
    )

    fake_ibkr = MagicMock()
    fake_ibkr.history = AsyncMock(return_value={"data": []})
    fake_db = MagicMock()
    fake_db.get_setting = AsyncMock(return_value=None)
    key_store = _FakeReadableKeyStore()
    usage = _FakeUsageLedger()
    ai = AiService(provider_registry=AIProviderRegistry({"ollama": FakeOllamaProvider()}))
    client = _client(ai=ai, ibkr=fake_ibkr, db=fake_db)
    client.app.dependency_overrides[get_ai_settings] = lambda: _FakeCloudSettings()
    client.app.dependency_overrides[get_ai_keystore] = lambda: key_store
    client.app.dependency_overrides[get_ai_usage_ledger] = lambda: usage

    resp = client.post(
        "/ai/analyze",
        json={
            "conid": 265598,
            "symbol": "AAPL",
            "timeframes": ["D"],
            "indicators": ["RSI"],
            "provider_name": "openrouter",
        },
    )

    assert resp.status_code == 200
    assert resp.json()["provider"] == {
        "provider_name": "openrouter",
        "kind": "cloud",
        "model": "anthropic/claude-sonnet-4",
        "estimated_cost": 0.02,
        "actual_cost": 0.0123,
        "fallback_used": False,
    }
    assert key_store.reads == [
        ("openrouter", "macos-keychain:orbit-ai/openrouter"),
    ]
    assert FakeOpenRouterProvider.seen_keys == ["sk-runtime-secret"]
    assert "sk-runtime-secret" not in resp.text

    follow_up = client.post(
        "/ai/chat",
        json={"session_id": resp.json()["session_id"], "message": "What invalidates it?"},
    )

    assert follow_up.status_code == 200
    assert FakeOpenRouterProvider.calls == 2

    with client.stream(
        "POST",
        "/ai/chat/stream",
        json={"session_id": resp.json()["session_id"], "message": "And the target?"},
    ) as stream_response:
        assert stream_response.status_code == 200
        assert any("Cloud narrative." in line for line in stream_response.iter_lines())
    assert FakeOpenRouterProvider.calls == 3


def test_analyze_evicts_key_bearing_cloud_provider_after_request(monkeypatch):
    from deps import get_ai_keystore, get_ai_settings, get_ai_usage_ledger
    from services.ai import AiService
    from services.ai_cloud_adapters import AIProviderTextResult
    from services.ai_providers import AIProviderRegistry
    from models import AIProviderMetadata

    class FakeOllamaProvider:
        name = "ollama"

        async def chat(self, **_kwargs) -> str:
            return "Local fallback."

        async def chat_structured(self, **_kwargs) -> dict:
            return {}

        async def chat_stream(self, **_kwargs):
            if False:
                yield ""

        async def warmup(self, **_kwargs) -> None:
            return None

        async def aclose(self) -> None:
            return None

    class FakeOpenRouterProvider:
        name = "openrouter"
        closed = 0

        def __init__(self, *, api_key: str) -> None:
            assert api_key == "sk-runtime-secret"

        async def chat_with_metadata(self, *, messages: list[dict[str, str]], model: str):
            return AIProviderTextResult(
                content="Cloud narrative.",
                metadata=AIProviderMetadata(
                    provider_name="openrouter",
                    kind="cloud",
                    model=model,
                    estimated_cost=None,
                    actual_cost=0.0123,
                    fallback_used=False,
                ),
            )

        async def aclose(self) -> None:
            self.__class__.closed += 1

    monkeypatch.setattr(
        "routers.ai.OpenRouterProvider",
        FakeOpenRouterProvider,
        raising=False,
    )

    fake_ibkr = MagicMock()
    fake_ibkr.history = AsyncMock(return_value={"data": []})
    fake_db = MagicMock()
    fake_db.get_setting = AsyncMock(return_value=None)
    registry = AIProviderRegistry({"ollama": FakeOllamaProvider()})
    ai = AiService(provider_registry=registry)
    client = _client(ai=ai, ibkr=fake_ibkr, db=fake_db)
    client.app.dependency_overrides[get_ai_settings] = lambda: _FakeCloudSettings()
    client.app.dependency_overrides[get_ai_keystore] = lambda: _FakeReadableKeyStore()
    client.app.dependency_overrides[get_ai_usage_ledger] = lambda: _FakeUsageLedger()

    resp = client.post(
        "/ai/analyze",
        json={
            "conid": 265598,
            "symbol": "AAPL",
            "timeframes": ["D"],
            "indicators": ["RSI"],
            "provider_name": "openrouter",
        },
    )

    assert resp.status_code == 200
    assert registry.names() == ["ollama"]
    assert FakeOpenRouterProvider.closed == 1


def test_analyze_maps_cloud_auth_error_to_typed_response_and_failed_usage(monkeypatch):
    from deps import get_ai_keystore, get_ai_settings, get_ai_usage_ledger
    from services.ai import AiService
    from services.ai_cloud_adapters import AIProviderAuthError
    from services.ai_providers import AIProviderRegistry

    class FakeOllamaProvider:
        name = "ollama"

        async def chat(self, **_kwargs) -> str:
            return "Local fallback."

        async def chat_structured(self, **_kwargs) -> dict:
            return {}

        async def chat_stream(self, **_kwargs):
            if False:
                yield ""

        async def warmup(self, **_kwargs) -> None:
            return None

        async def aclose(self) -> None:
            return None

    class FakeOpenRouterProvider:
        name = "openrouter"

        def __init__(self, *, api_key: str) -> None:
            assert api_key == "sk-runtime-secret"

        async def chat_with_metadata(self, *, messages: list[dict[str, str]], model: str):
            raise AIProviderAuthError("bad key: sk-runtime-secret")

        async def aclose(self) -> None:
            return None

    monkeypatch.setattr(
        "routers.ai.OpenRouterProvider",
        FakeOpenRouterProvider,
        raising=False,
    )

    fake_ibkr = MagicMock()
    fake_ibkr.history = AsyncMock(return_value={"data": []})
    fake_db = MagicMock()
    fake_db.get_setting = AsyncMock(return_value=None)
    usage = _FakeUsageLedger()
    ai = AiService(provider_registry=AIProviderRegistry({"ollama": FakeOllamaProvider()}))
    client = _client(ai=ai, ibkr=fake_ibkr, db=fake_db)
    client.app.dependency_overrides[get_ai_settings] = (
        lambda: _FakeNoFallbackCloudSettings()
    )
    client.app.dependency_overrides[get_ai_keystore] = lambda: _FakeReadableKeyStore()
    client.app.dependency_overrides[get_ai_usage_ledger] = lambda: usage

    resp = client.post(
        "/ai/analyze",
        json={
            "conid": 265598,
            "symbol": "AAPL",
            "timeframes": ["D"],
            "indicators": ["RSI"],
            "provider_name": "openrouter",
        },
    )

    assert resp.status_code == 401
    assert resp.json()["detail"] == {
        "error": "ai_provider_auth_error",
        "message": "Cloud AI provider authentication failed.",
        "provider_name": "openrouter",
    }
    assert "sk-runtime-secret" not in resp.text
    assert usage.records[-1] == {
        "provider_name": "openrouter",
        "model": "anthropic/claude-sonnet-4",
        "task_type": "analysis",
        "routing_mode": "cloud_manual",
        "input_tokens": None,
        "output_tokens": None,
        "estimated_cost": 0.02,
        "actual_cost": None,
        "status": "failed",
        "provider_request_id": None,
        "error_code": "ai_provider_auth_error",
    }


def test_analyze_resolves_cloud_route_before_ollama_readiness(monkeypatch):
    from deps import get_ai_keystore, get_ai_settings, get_ai_usage_ledger
    from services.ai import AiService
    from services.ai_cloud_adapters import AIProviderTextResult
    from services.ai_providers import AIProviderRegistry
    from models import AIProviderMetadata

    class FakeOllamaProvider:
        name = "ollama"

        async def chat(self, **_kwargs) -> str:
            return "Local fallback."

        async def chat_structured(self, **_kwargs) -> dict:
            return {}

        async def chat_stream(self, **_kwargs):
            if False:
                yield ""

        async def warmup(self, **_kwargs) -> None:
            return None

        async def aclose(self) -> None:
            return None

    class FakeOpenRouterProvider:
        name = "openrouter"

        def __init__(self, *, api_key: str) -> None:
            assert api_key == "sk-runtime-secret"

        async def chat_with_metadata(self, *, messages: list[dict[str, str]], model: str):
            return AIProviderTextResult(
                content="Cloud narrative.",
                metadata=AIProviderMetadata(
                    provider_name="openrouter",
                    kind="cloud",
                    model=model,
                    estimated_cost=None,
                    actual_cost=0.0123,
                    fallback_used=False,
                ),
            )

    monkeypatch.setattr(
        "routers.ai.OpenRouterProvider",
        FakeOpenRouterProvider,
        raising=False,
    )

    fake_ibkr = MagicMock()
    fake_ibkr.history = AsyncMock(return_value={"data": []})
    fake_db = MagicMock()
    fake_db.get_setting = AsyncMock(return_value=None)
    ai = AiService(provider_registry=AIProviderRegistry({"ollama": FakeOllamaProvider()}))

    client = _client(
        ollama_status={
            "state": "not_installed",
            "ready": False,
            "selected_model": None,
            "error": "Ollama unavailable",
            "platform": "darwin",
        },
        ai=ai,
        ibkr=fake_ibkr,
        db=fake_db,
    )
    client.app.dependency_overrides[get_ai_settings] = lambda: _FakeCloudSettings()
    client.app.dependency_overrides[get_ai_keystore] = lambda: _FakeReadableKeyStore()
    client.app.dependency_overrides[get_ai_usage_ledger] = lambda: _FakeUsageLedger()

    resp = client.post(
        "/ai/analyze",
        json={
            "conid": 265598,
            "symbol": "AAPL",
            "timeframes": ["D"],
            "indicators": ["RSI"],
            "provider_name": "openrouter",
        },
    )

    assert resp.status_code == 200
    assert "AI is not ready" not in resp.json()["message"]
    assert resp.json()["provider"]["provider_name"] == "openrouter"


def test_analyze_blocks_over_per_call_cap_before_cloud_ai_call():
    from deps import get_ai_settings, get_ai_usage_ledger

    fake_ai = MagicMock()
    fake_ibkr = MagicMock()
    fake_ibkr.history = AsyncMock(return_value={"data": []})
    fake_db = MagicMock()
    fake_db.get_setting = AsyncMock(return_value=None)

    usage = _FakeUsageLedger()
    client = _client(ai=fake_ai, ibkr=fake_ibkr, db=fake_db)
    client.app.dependency_overrides[get_ai_settings] = lambda: _FakeLowCapCloudSettings()
    client.app.dependency_overrides[get_ai_usage_ledger] = lambda: usage

    resp = client.post(
        "/ai/analyze",
        json={
            "conid": 265598,
            "symbol": "AAPL",
            "timeframes": ["D"],
            "indicators": ["RSI"],
            "provider_name": "openrouter",
        },
    )

    assert resp.status_code == 402
    assert resp.json()["detail"] == {
        "error": "ai_cost_limit_exceeded",
        "message": "Estimated cloud AI cost exceeds the per-call cap.",
        "estimated_cost": 0.02,
        "per_call_cost_cap_usd": 0.01,
    }
    fake_ai.analyze.assert_not_called()
    assert usage.records == [
        {
            "provider_name": "openrouter",
            "model": "anthropic/claude-sonnet-4",
            "task_type": "analysis",
            "routing_mode": "cloud_manual",
            "input_tokens": None,
            "output_tokens": None,
            "estimated_cost": 0.02,
            "actual_cost": None,
            "status": "blocked",
            "provider_request_id": None,
            "error_code": "ai_cost_limit_exceeded",
        }
    ]


def test_analyze_stream_blocks_over_per_call_cap_before_cloud_ai_call():
    from deps import get_ai_settings, get_ai_usage_ledger

    fake_ai = MagicMock()
    fake_ibkr = MagicMock()
    fake_ibkr.history = AsyncMock(return_value={"data": []})
    fake_db = MagicMock()
    fake_db.get_setting = AsyncMock(return_value=None)

    usage = _FakeUsageLedger()
    client = _client(ai=fake_ai, ibkr=fake_ibkr, db=fake_db)
    client.app.dependency_overrides[get_ai_settings] = lambda: _FakeLowCapCloudSettings()
    client.app.dependency_overrides[get_ai_usage_ledger] = lambda: usage

    resp = client.post(
        "/ai/analyze/stream",
        json={
            "conid": 265598,
            "symbol": "AAPL",
            "timeframes": ["D"],
            "indicators": ["RSI"],
            "provider_name": "openrouter",
        },
    )

    assert resp.status_code == 402
    assert resp.json()["detail"]["error"] == "ai_cost_limit_exceeded"
    fake_ai.analyze_stream.assert_not_called()


def test_analyze_stream_done_event_contains_cloud_provider_metadata():
    from deps import get_ai_keystore, get_ai_settings, get_ai_usage_ledger

    class FakeAi:
        async def analyze_stream(self, **kwargs) -> AsyncIterator[dict]:
            assert kwargs["provider_name"] == "openrouter"
            assert kwargs["model"] == "anthropic/claude-sonnet-4"
            assert kwargs["fallback_model"] == "gemma4:26b"
            assert kwargs["allow_fallback"] is True
            yield {"type": "token", "content": "Cloud narrative."}
            yield {
                "type": "done",
                "session_id": "session-1",
                "signal": None,
                "message": "Cloud narrative.",
                "provider": {
                    "provider_name": "openrouter",
                    "kind": "cloud",
                    "model": "anthropic/claude-sonnet-4",
                    "estimated_cost": None,
                    "actual_cost": 0.0123,
                    "fallback_used": False,
                },
            }

    fake_ibkr = MagicMock()
    fake_ibkr.history = AsyncMock(return_value={"data": []})
    fake_db = MagicMock()
    fake_db.get_setting = AsyncMock(return_value=None)

    client = _client(ai=FakeAi(), ibkr=fake_ibkr, db=fake_db)
    usage = _FakeUsageLedger()
    client.app.dependency_overrides[get_ai_settings] = lambda: _FakeCloudSettings()
    client.app.dependency_overrides[get_ai_usage_ledger] = lambda: usage
    client.app.dependency_overrides[get_ai_keystore] = lambda: _FakeReadableKeyStore()

    with client.stream(
        "POST",
        "/ai/analyze/stream",
        json={
            "conid": 265598,
            "symbol": "AAPL",
            "timeframes": ["D"],
            "indicators": ["RSI"],
            "provider_name": "openrouter",
        },
    ) as resp:
        assert resp.status_code == 200
        frames = [
            json.loads(line.removeprefix("data: "))
            for line in resp.iter_lines()
            if line.startswith("data: ")
        ]

    assert frames[-1]["provider"] == {
        "provider_name": "openrouter",
        "kind": "cloud",
        "model": "anthropic/claude-sonnet-4",
        "estimated_cost": 0.02,
        "actual_cost": 0.0123,
        "fallback_used": False,
    }
    assert usage.records[-1] == {
        "provider_name": "openrouter",
        "model": "anthropic/claude-sonnet-4",
        "task_type": "analysis",
        "routing_mode": "cloud_manual",
        "input_tokens": None,
        "output_tokens": None,
        "estimated_cost": 0.02,
        "actual_cost": 0.0123,
        "status": "success",
        "provider_request_id": None,
        "error_code": None,
    }


def test_analyze_stream_maps_cloud_rate_limit_to_typed_sse_and_failed_usage(monkeypatch):
    from deps import get_ai_keystore, get_ai_settings, get_ai_usage_ledger
    from services.ai import AiService
    from services.ai_cloud_adapters import AIProviderRateLimitError
    from services.ai_providers import AIProviderRegistry

    class FakeOllamaProvider:
        name = "ollama"

        async def chat(self, **_kwargs) -> str:
            return "Local fallback."

        async def chat_structured(self, **_kwargs) -> dict:
            return {}

        async def chat_stream(self, **_kwargs):
            if False:
                yield ""

        async def warmup(self, **_kwargs) -> None:
            return None

        async def aclose(self) -> None:
            return None

    class FakeOpenRouterProvider:
        name = "openrouter"

        def __init__(self, *, api_key: str) -> None:
            assert api_key == "sk-runtime-secret"

        async def chat_with_metadata(self, *, messages: list[dict[str, str]], model: str):
            raise AIProviderRateLimitError("quota hit")

        async def aclose(self) -> None:
            return None

    monkeypatch.setattr(
        "routers.ai.OpenRouterProvider",
        FakeOpenRouterProvider,
        raising=False,
    )

    fake_ibkr = MagicMock()
    fake_ibkr.history = AsyncMock(return_value={"data": []})
    fake_db = MagicMock()
    fake_db.get_setting = AsyncMock(return_value=None)
    usage = _FakeUsageLedger()
    ai = AiService(provider_registry=AIProviderRegistry({"ollama": FakeOllamaProvider()}))
    client = _client(ai=ai, ibkr=fake_ibkr, db=fake_db)
    client.app.dependency_overrides[get_ai_settings] = (
        lambda: _FakeNoFallbackCloudSettings()
    )
    client.app.dependency_overrides[get_ai_keystore] = lambda: _FakeReadableKeyStore()
    client.app.dependency_overrides[get_ai_usage_ledger] = lambda: usage

    with client.stream(
        "POST",
        "/ai/analyze/stream",
        json={
            "conid": 265598,
            "symbol": "AAPL",
            "timeframes": ["D"],
            "indicators": ["RSI"],
            "provider_name": "openrouter",
        },
    ) as resp:
        assert resp.status_code == 200
        frames = [
            json.loads(line.removeprefix("data: "))
            for line in resp.iter_lines()
            if line.startswith("data: ")
        ]

    assert frames == [
        {
            "type": "error",
            "error": "ai_provider_rate_limit_error",
            "message": "Cloud AI provider rate limit was reached.",
            "provider_name": "openrouter",
        }
    ]
    assert usage.records[-1]["status"] == "failed"
    assert usage.records[-1]["error_code"] == "ai_provider_rate_limit_error"


def test_ai_usage_route_returns_monthly_spend_summary():
    from deps import get_ai_usage_ledger

    usage = _FakeUsageLedger(
        monthly_actual_cost_usd=3.25,
        monthly_estimated_cost_usd=5.0,
    )
    client = _client()
    client.app.dependency_overrides[get_ai_usage_ledger] = lambda: usage

    resp = client.get("/ai/usage")

    assert resp.status_code == 200
    assert resp.json() == {
        "monthly_actual_cost_usd": 3.25,
        "monthly_estimated_cost_usd": 5.0,
    }


def test_analyze_blocks_cloud_for_execution_sensitive_tasks():
    from deps import get_ai_settings

    fake_ai = MagicMock()
    fake_ibkr = MagicMock()
    fake_ibkr.history = AsyncMock(return_value={"data": []})
    fake_db = MagicMock()
    fake_db.get_setting = AsyncMock(return_value=None)

    client = _client(ai=fake_ai, ibkr=fake_ibkr, db=fake_db)
    client.app.dependency_overrides[get_ai_settings] = lambda: _FakeCloudSettings()

    resp = client.post(
        "/ai/analyze",
        json={
            "conid": 265598,
            "symbol": "AAPL",
            "timeframes": ["D"],
            "indicators": ["RSI"],
            "provider_name": "openrouter",
            "task_type": "execution_sensitive",
        },
    )

    assert resp.status_code == 400
    assert resp.json()["detail"] == {
        "error": "ai_cloud_blocked_for_task",
        "message": "Cloud AI is blocked for execution-sensitive tasks.",
    }
    fake_ai.analyze.assert_not_called()
