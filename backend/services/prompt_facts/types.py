"""Internal contract between fact builders and the prompt renderer.

PromptFact / PromptContextBlock are NOT HTTP request/response models —
they live in services/, not models/. They are pydantic for cheap
validation only (catches invalid polarity strings at builder time).
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel

Polarity = Literal["bullish", "bearish", "neutral", "caution"]


class PromptFact(BaseModel):
    """One relationship-aware fact for one indicator on one timeframe."""

    id: str           # "{timeframe}.{indicator}.{condition}"
    timeframe: str    # "1H" | "4H" | "D" | "W" | "M"
    indicator: str    # lowercase family: "fibonacci", "ema", "rsi", ...
    text: str         # human-readable; embeds load-bearing raw numbers
    polarity: Polarity
    strength: int     # 0-100
    priority: int     # static per fact type; modulated at sort time
    data: dict        # raw values that backed the decision


class PromptContextBlock(BaseModel):
    """Per-timeframe structured intermediate; truncation operates on this,
    then the renderer turns it into the final 'Verified Facts:' text.

    Field roles:
    - timeframe: bar size ("D", "W", "M", "4H", "1H")
    - tf_weight: numeric weight from _TF_WEIGHTS (M=5..1H=1) — used by
      truncate and renderer for sort order. Stored on the block so
      consumers don't need to re-look up.
    - facts: PromptFacts already sorted by the dispatcher.
    - last_close: numeric close price; renderer formats the header line
      from this.
    - chart_context: optional raw OHLCV / pattern text fallback (filled
      in by the orchestrator if budget allows; truncation may drop it).
    """

    timeframe: str
    tf_weight: int = 0
    facts: list[PromptFact]
    last_close: float = 0.0
    chart_context: Optional[str] = None
