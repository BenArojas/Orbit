"""
Tests for the per-model token budget scaling.

Covers:
  - _static_budget_for_model (ollama_context): static tier lookup
  - OllamaContextService.get_budget_for_model: clamp to 70% of model ceiling
  - truncate_context (prompt_builder): legacy string-level truncation still works
"""
from __future__ import annotations

import pytest

from services.ollama_context import (
    OllamaContextService,
    _static_budget_for_model,
    _DEFAULT_STATIC,
)
from services.prompt_builder import (
    DEFAULT_CONTEXT_BUDGET,
    truncate_context,
)


# ═══════════════════════════════════════════════════════════════
#  _static_budget_for_model — sync tier lookup
# ═══════════════════════════════════════════════════════════════


@pytest.mark.parametrize(
    "model, expected",
    [
        ("gemma3:1b-instruct-q4_K_M", 4096),
        ("gemma3:4b", 16384),
        ("gemma3:12b", 32768),
        ("gemma3:27b", 32768),
        ("llama3.1:8b", 16384),
        ("llama3.2:3b", 16384),
        ("qwen2.5:14b", 16384),
        ("phi3:mini", 8192),
    ],
)
def test_static_budget_per_tier(model: str, expected: int):
    assert _static_budget_for_model(model) == expected


def test_static_budget_unknown_model_falls_back_to_default():
    assert _static_budget_for_model("some-custom-fine-tune") == _DEFAULT_STATIC


def test_static_budget_case_insensitive():
    assert _static_budget_for_model("GEMMA3:27B") == 32768


# ═══════════════════════════════════════════════════════════════
#  OllamaContextService.get_budget_for_model — async, clamped
# ═══════════════════════════════════════════════════════════════


def _make_context_service(model_info: dict | None):
    """Build an OllamaContextService with a stubbed lifecycle."""
    from unittest.mock import AsyncMock, MagicMock

    lifecycle = MagicMock()
    lifecycle.show_model = AsyncMock(return_value=model_info)
    return OllamaContextService(lifecycle)


@pytest.mark.asyncio
async def test_context_service_clamps_to_70_pct_of_model_max():
    """Budget = min(static_tier, model_max * 0.7)."""
    # gemma3:27b static = 32768; model reports 65536 → clamp = 45875
    # min(32768, 45875) = 32768
    svc = _make_context_service({"llama.context_length": 65536})
    budget = await svc.get_budget_for_model("gemma3:27b")
    assert budget == 32768  # static is the binding constraint here


@pytest.mark.asyncio
async def test_context_service_uses_clamp_when_model_max_is_smaller():
    """When model's actual ceiling < static tier, clamp wins."""
    # llama3.1 static = 16384; model reports 4096 → clamp = int(4096 * 0.7) = 2867
    # min(16384, 2867) = 2867
    svc = _make_context_service({"llama.context_length": 4096})
    budget = await svc.get_budget_for_model("llama3.1:8b")
    assert budget == 2867


@pytest.mark.asyncio
async def test_context_service_fallback_when_ollama_unreachable():
    """No model_info → static tier used as fallback."""
    svc = _make_context_service(None)
    budget = await svc.get_budget_for_model("gemma3:27b")
    assert budget == 32768


# ═══════════════════════════════════════════════════════════════
#  truncate_context — legacy string-level truncation
# ═══════════════════════════════════════════════════════════════


def test_truncate_context_respects_budget():
    """truncate_context with a tight budget must shrink the input."""
    big_block = "\n\n=== AAPL — D Timeframe ===\n" + "x" * 10_000
    block2 = "\n\n=== AAPL — W Timeframe ===\n" + "y" * 5_000
    block3 = "\n\n=== AAPL — M Timeframe ===\n" + "z" * 2_000
    combined = (big_block + block2 + block3).lstrip()

    result = truncate_context(combined, budget_tokens=500)
    # At 3.5 chars/token, 500 tokens ≈ 1750 chars. Result should be much
    # smaller than the original and contain the truncation marker.
    assert len(result) < len(combined)
    assert "truncated" in result.lower()


def test_truncate_context_under_budget_is_passthrough():
    small = "=== AAPL — D Timeframe ===\nCurrent Price: $100"
    result = truncate_context(small, budget_tokens=DEFAULT_CONTEXT_BUDGET)
    assert result == small
