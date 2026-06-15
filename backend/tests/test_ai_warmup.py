"""
Tests for POST /ai/warmup endpoint and AiService.warmup() method.

Covers:
  - Ollama provider warmup sends a 1-token payload with keep_alive="20m"
  - Ollama provider warmup is non-fatal on ConnectError, TimeoutException, HTTPStatusError
  - POST /ai/warmup returns 204 when model is ready
  - POST /ai/warmup returns 204 (no-op) when Ollama is not ready
  - POST /ai/warmup returns 204 (no-op) when no model is selected
"""
from __future__ import annotations

import pytest
import httpx
from unittest.mock import AsyncMock, MagicMock, patch


# ── OllamaLLMProvider.warmup() ─────────────────────────────────


class TestOllamaProviderWarmup:
    @pytest.fixture
    def provider(self):
        """Create an Ollama provider with a mocked HTTP client."""
        from services.ai_providers import OllamaLLMProvider

        http = MagicMock()
        return OllamaLLMProvider(http_client=http)

    async def test_warmup_sends_correct_payload(self, provider):
        """warmup() POSTs to /api/chat with keep_alive=20m and num_predict=1."""
        mock_resp = MagicMock()
        mock_resp.raise_for_status = MagicMock()
        provider._http.post = AsyncMock(return_value=mock_resp)

        await provider.warmup(model="gemma3:27b")

        provider._http.post.assert_called_once()
        call_kwargs = provider._http.post.call_args
        payload = call_kwargs.kwargs.get("json") or call_kwargs.args[1]

        assert payload["model"] == "gemma3:27b"
        assert payload["keep_alive"] == "20m"
        assert payload["options"]["num_predict"] == 1
        assert payload["stream"] is False

    async def test_warmup_nonfatal_on_connect_error(self, provider):
        """ConnectError must not propagate — warmup is best-effort."""
        provider._http.post = AsyncMock(side_effect=httpx.ConnectError("refused"))

        # Should not raise
        await provider.warmup(model="gemma3:27b")

    async def test_warmup_nonfatal_on_timeout(self, provider):
        """TimeoutException must not propagate."""
        provider._http.post = AsyncMock(
            side_effect=httpx.TimeoutException("timeout")
        )
        await provider.warmup(model="gemma3:27b")

    async def test_warmup_nonfatal_on_http_status_error(self, provider):
        """HTTPStatusError must not propagate."""
        mock_resp = MagicMock(status_code=503)
        provider._http.post = AsyncMock(
            side_effect=httpx.HTTPStatusError("503", request=MagicMock(), response=mock_resp)
        )
        await provider.warmup(model="gemma3:27b")


# ── POST /ai/warmup endpoint ──────────────────────────────────


class TestWarmupEndpoint:
    def _make_app(self, ollama_status: dict, warmup_called: list):
        """Build a minimal FastAPI app with the ai router wired up."""
        from fastapi import FastAPI
        from fastapi.testclient import TestClient

        app = FastAPI()

        # Mock dependencies
        mock_ollama = MagicMock()
        mock_ollama.status.return_value = ollama_status

        mock_ai = MagicMock()
        mock_ai.warmup = AsyncMock(side_effect=lambda m: warmup_called.append(m))

        from routers.ai import router
        from deps import get_ollama, get_ai
        app.include_router(router)
        app.dependency_overrides[get_ollama] = lambda: mock_ollama
        app.dependency_overrides[get_ai] = lambda: mock_ai

        return TestClient(app)

    def test_warmup_returns_204_when_ready(self):
        called = []
        client = self._make_app(
            {"state": "ready", "ready": True, "selected_model": "gemma3:27b"},
            called,
        )
        resp = client.post("/ai/warmup")
        assert resp.status_code == 204
        assert called == ["gemma3:27b"]

    def test_warmup_returns_204_noop_when_not_ready(self):
        called = []
        client = self._make_app(
            {"state": "no_models", "ready": False, "selected_model": None},
            called,
        )
        resp = client.post("/ai/warmup")
        assert resp.status_code == 204
        assert called == []  # warmup not called — nothing to warm up

    def test_warmup_returns_204_noop_when_no_model_selected(self):
        called = []
        client = self._make_app(
            {"state": "running", "ready": False, "selected_model": None},
            called,
        )
        resp = client.post("/ai/warmup")
        assert resp.status_code == 204
        assert called == []
