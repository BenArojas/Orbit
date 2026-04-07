"""
Tests for the per-model token budget scaling (task 4.4).
"""
from __future__ import annotations

import pytest

from services.prompt_builder import (
    DEFAULT_CONTEXT_BUDGET,
    get_budget_for_model,
    truncate_context,
)


@pytest.mark.parametrize(
    "model, expected",
    [
        ("gemma3:e2b-instruct-q4_K_M", 1800),
        ("gemma3:e4b", 2800),
        ("llama3.1:8b", 3500),
        ("qwen2.5:14b", 4000),
        ("gemma3:27b", 5500),
        ("gemma3:31b", 7000),
        ("llama3.1:70b", 9500),
    ],
)
def test_budget_per_tier(model: str, expected: int):
    assert get_budget_for_model(model) == expected


def test_unknown_model_falls_back_to_default():
    assert get_budget_for_model("some-custom-fine-tune") == DEFAULT_CONTEXT_BUDGET


def test_none_model_falls_back_to_default():
    assert get_budget_for_model(None) == DEFAULT_CONTEXT_BUDGET


def test_case_insensitive_matching():
    assert get_budget_for_model("GEMMA3:E4B") == 2800


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
