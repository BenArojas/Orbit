"""Smoke tests for the PromptFact / PromptContextBlock contract."""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from services.prompt_facts.types import PromptFact, PromptContextBlock


def test_promptfact_accepts_valid_polarity():
    f = PromptFact(
        id="D.rsi.above_50_rising",
        timeframe="D",
        indicator="rsi",
        text="RSI 62.3, above 50 and rising 3 bars",
        polarity="bullish",
        strength=60,
        priority=10,
        data={"rsi": 62.3},
    )
    assert f.polarity == "bullish"


def test_promptfact_rejects_invalid_polarity():
    with pytest.raises(ValidationError):
        PromptFact(
            id="D.rsi.above_50_rising",
            timeframe="D",
            indicator="rsi",
            text="x",
            polarity="bullish (weakening)",  # not a Literal value
            strength=60,
            priority=10,
            data={},
        )


def test_promptcontextblock_holds_facts_and_metadata():
    block = PromptContextBlock(
        timeframe="D",
        tf_weight=3,
        facts=[],
        last_close=215.40,
        chart_context=None,
    )
    assert block.timeframe == "D"
    assert block.tf_weight == 3
    assert block.last_close == 215.40
    assert block.chart_context is None
