"""Tests for OllamaContextService."""
from unittest.mock import AsyncMock

import pytest

from services.ollama_context import OllamaContextService


class _StubLifecycle:
    def __init__(self, info: dict | None):
        self.info = info
        self.show_model = AsyncMock(return_value=info)


class TestOllamaContextService:
    @pytest.mark.asyncio
    async def test_extracts_llama_context_length(self):
        lc = _StubLifecycle({"llama.context_length": 8192})
        svc = OllamaContextService(lc)  # type: ignore[arg-type]
        max_ctx = await svc.get_model_max_context("gemma3:4b")
        assert max_ctx == 8192

    @pytest.mark.asyncio
    async def test_returns_none_when_info_missing(self):
        lc = _StubLifecycle(None)
        svc = OllamaContextService(lc)  # type: ignore[arg-type]
        assert await svc.get_model_max_context("missing") is None

    @pytest.mark.asyncio
    async def test_budget_clamps_to_70pct_of_model_max(self):
        lc = _StubLifecycle({"llama.context_length": 8192})
        svc = OllamaContextService(lc)  # type: ignore[arg-type]
        # Static tier for gemma3:4b is high (16384); model_max 8192 × 0.7 = 5734 wins.
        budget = await svc.get_budget_for_model("gemma3:4b")
        assert budget <= int(8192 * 0.7)

    @pytest.mark.asyncio
    async def test_budget_falls_back_to_static_when_no_model_info(self):
        lc = _StubLifecycle(None)
        svc = OllamaContextService(lc)  # type: ignore[arg-type]
        budget = await svc.get_budget_for_model("gemma3:4b")
        # Static tier must be returned without crashing.
        assert budget > 0

    @pytest.mark.asyncio
    async def test_caches_per_model(self):
        lc = _StubLifecycle({"llama.context_length": 8192})
        svc = OllamaContextService(lc)  # type: ignore[arg-type]
        await svc.get_model_max_context("gemma3:4b")
        await svc.get_model_max_context("gemma3:4b")
        assert lc.show_model.await_count == 1

    @pytest.mark.asyncio
    async def test_extracts_gemma_context_length_key(self):
        """Handles architecture-specific key prefix like gemma3.context_length."""
        lc = _StubLifecycle({"gemma3.context_length": 32768})
        svc = OllamaContextService(lc)  # type: ignore[arg-type]
        max_ctx = await svc.get_model_max_context("gemma3:12b")
        assert max_ctx == 32768

    @pytest.mark.asyncio
    async def test_static_budget_for_unknown_model(self):
        lc = _StubLifecycle(None)
        svc = OllamaContextService(lc)  # type: ignore[arg-type]
        budget = await svc.get_budget_for_model("some-unknown-model:7b")
        assert budget == 8192  # _DEFAULT_STATIC
