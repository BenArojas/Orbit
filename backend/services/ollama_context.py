"""Per-model context budget service.

Reads model_info via OllamaLifecycle.show_model, extracts
context_length (a ceiling), and clamps the static tier-based budget
to 70% of the model's ceiling. Cached per-model for the process lifetime.
"""
from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from services.ollama import OllamaLifecycle

_HEADROOM = 0.7  # reserve 30% for output + history


# Static fallback tiers — mirror the prior _MODEL_BUDGETS table.
_STATIC_TIERS: list[tuple[str, int]] = [
    ("gemma3:1b", 4096),
    ("gemma3:4b", 16384),
    ("gemma3:12b", 32768),
    ("gemma3:27b", 32768),
    ("llama3.1", 16384),
    ("llama3.2", 16384),
    ("qwen2.5", 16384),
    ("phi3", 8192),
]
_DEFAULT_STATIC = 8192


def _static_budget_for_model(model: str) -> int:
    model_lower = model.lower()
    for prefix, budget in _STATIC_TIERS:
        if prefix in model_lower:
            return budget
    return _DEFAULT_STATIC


def _extract_context_length(info: dict) -> int | None:
    """Pull context_length out of /api/show response.

    Ollama returns keys like 'llama.context_length' or
    'gemma3.context_length' — search for any 'context_length' suffix.
    """
    for key, value in info.items():
        if isinstance(key, str) and key.endswith("context_length"):
            try:
                return int(value)
            except (TypeError, ValueError):
                continue
    return None


class OllamaContextService:
    def __init__(self, lifecycle: "OllamaLifecycle") -> None:
        self._lifecycle = lifecycle
        self._cache: dict[str, int | None] = {}
        self._lock = asyncio.Lock()

    async def get_model_max_context(self, model: str) -> int | None:
        async with self._lock:
            if model in self._cache:
                return self._cache[model]

        info = await self._lifecycle.show_model(model)
        max_ctx = _extract_context_length(info) if info else None

        async with self._lock:
            self._cache[model] = max_ctx
        return max_ctx

    async def get_budget_for_model(self, model: str) -> int:
        """Final budget = min(static_tier, model_max * 0.7).

        Falls back to static tier if model_info is unavailable.
        """
        static_tier = _static_budget_for_model(model)
        max_ctx = await self.get_model_max_context(model)
        if max_ctx is None or max_ctx <= 0:
            return static_tier
        clamp = int(max_ctx * _HEADROOM)
        return min(static_tier, clamp)
