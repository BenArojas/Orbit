# AI Prompt Fact Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-05-24-ai-prompt-fact-layer-design.md`

**Goal:** Replace the freeform per-indicator prompt formatters with a deterministic fact layer that pre-computes relationship-aware facts (stack order, above/below, rising/falling, recent crosses, fib position) so the local LLM stops fabricating relationships from raw numbers.

**Architecture:** A new `backend/services/prompt_facts/` package houses one builder module per indicator family (`fibonacci.py`, `ema.py`, `rsi.py`, `macd.py`, `bbands.py`, `vwap.py`, `atr.py`, `stoch.py`, `obv.py`, `adx.py`, `volume.py`). Each builder turns indicator + candle inputs into typed `PromptFact` objects. A dispatcher (`__init__.py`) fans out per family and per timeframe. A renderer turns the structured `PromptContextBlock` intermediate into the final "Verified Facts:" prompt section. Truncation runs on the structured blocks (preserving high-value facts) before rendering. A new `OllamaContextService` queries `/api/show` for the model's max context as a *ceiling* on the existing static-tier budgets.

**Tech Stack:** Python 3.12, FastAPI, Pydantic v2, httpx, polars, ollama runtime, pytest, syrupy (new test dep), Tauri + React 19 + TS (one frontend file touched).

**Branch:** `feature/ai-prompt-context-facts` from `dev` (see `.claude/skills/parallax-git`).

---

## File Structure

### New files
```
backend/services/prompt_facts/
├── __init__.py          # build_prompt_facts dispatcher + sort + priority interaction
├── _common.py           # is_near, is_rising_n, is_falling_n, recent_cross, percentile_rank
├── types.py             # PromptFact, Polarity, PromptContextBlock
├── fibonacci.py
├── ema.py
├── rsi.py
├── macd.py
├── bbands.py
├── vwap.py
├── atr.py
├── stoch.py
├── obv.py
├── adx.py
└── volume.py

backend/services/ollama_context.py     # OllamaContextService — async budget lookup

backend/tests/test_prompt_facts_common.py
backend/tests/test_prompt_facts_fibonacci.py
backend/tests/test_prompt_facts_ema.py
backend/tests/test_prompt_facts_rsi.py
backend/tests/test_prompt_facts_macd.py
backend/tests/test_prompt_facts_bbands.py
backend/tests/test_prompt_facts_vwap.py
backend/tests/test_prompt_facts_atr.py
backend/tests/test_prompt_facts_stoch.py
backend/tests/test_prompt_facts_obv.py
backend/tests/test_prompt_facts_adx.py
backend/tests/test_prompt_facts_volume.py
backend/tests/test_prompt_facts_dispatcher.py
backend/tests/test_prompt_builder_facts.py    # syrupy-driven end-to-end render
backend/tests/test_ollama_context.py
backend/tests/test_truncate_by_value.py
backend/tests/conftest.py                     # shared fixture builders (only if missing)
```

### Modified files
```
backend/services/prompt_builder.py
backend/services/ai.py
backend/services/ollama.py                    # OllamaLifecycle.show_model
backend/routers/ai.py
backend/main.py                               # OllamaContextService wiring
backend/pyproject.toml                        # syrupy>=4.6.0
backend/uv.lock
backend/tests/test_ai_with_fibs.py            # full rewrite of assertions
backend/tests/test_prompt_budget.py           # imports + async
backend/tests/test_ai_timeout.py              # constructor / signature update
backend/tests/test_ai_warmup.py               # constructor / signature update (if instantiates AiService)
src/components/ai/AiConfigPanel.tsx           # add "ATR"
```

### Boundary rules (locked from spec)
- Builders **never** use `except Exception:`. Explicit `if` guards only.
- Fact IDs are `{tf}.{indicator}.{condition}` snake_case, indicator is lowercase family (`fibonacci`, `ema`, ...). Stable enum suffixes like `_0618` / `_9_21` allowed; tunable thresholds never appear in IDs.
- `Polarity` is one of `bullish | bearish | neutral | caution`. No parenthetical nuance — nuance goes in `text` / `data`.
- Truncation runs on `list[PromptContextBlock]` (structured), then renders.
- Budget lookup is `await OllamaContextService.get_budget_for_model(model)` — `/api/show` value is a ceiling, never raises the static tier.
- `AiService.analyze` / `analyze_stream` accept BOTH `indicators_display` (UI labels) and `indicator_names` (backend names). Display goes into the user message; names go into the system prompt and fact builders.

---

## Pre-Task Setup

### Task 0: Create branch and confirm working tree

**Files:**
- (none — git only)

- [ ] **Step 1: Cut feature branch from `dev`**

```bash
cd /Users/ofekarojas/Desktop/Projects/Parallax
git checkout dev
git pull --ff-only
git checkout -b feature/ai-prompt-context-facts
```

- [ ] **Step 2: Verify backend tests baseline pass**

```bash
cd backend
uv sync
uv run pytest -x -q
```

Expected: green. If anything fails before we change anything, stop and report — do not proceed.

- [ ] **Step 3: Verify frontend tests baseline pass**

```bash
cd /Users/ofekarojas/Desktop/Projects/Parallax
npm test -- --run
```

Expected: green.

---

## Task 1: Types — `PromptFact`, `Polarity`, `PromptContextBlock`

**Files:**
- Create: `backend/services/prompt_facts/__init__.py` (empty placeholder for now; real dispatcher in Task 15)
- Create: `backend/services/prompt_facts/types.py`
- Create: `backend/tests/test_prompt_facts_common.py` (just the type smoke tests for now; helper tests added in Task 2)

- [ ] **Step 1: Write the failing test**

`backend/tests/test_prompt_facts_common.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend
uv run pytest tests/test_prompt_facts_common.py -v
```

Expected: ImportError or ModuleNotFoundError on `services.prompt_facts.types`.

- [ ] **Step 3: Create empty package init**

`backend/services/prompt_facts/__init__.py`:

```python
"""prompt_facts — deterministic fact builders for AI prompt context."""
```

- [ ] **Step 4: Implement the types module**

`backend/services/prompt_facts/types.py`:

```python
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
```

- [ ] **Step 5: Run test to verify it passes**

```bash
uv run pytest tests/test_prompt_facts_common.py -v
```

Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/services/prompt_facts/__init__.py \
        backend/services/prompt_facts/types.py \
        backend/tests/test_prompt_facts_common.py
git commit -m "feat(ai): add PromptFact / PromptContextBlock contract"
```

---

## Task 2: Threshold helpers — `_common.py`

**Files:**
- Create: `backend/services/prompt_facts/_common.py`
- Modify: `backend/tests/test_prompt_facts_common.py` (append helper tests)

- [ ] **Step 1: Write the failing tests for `is_near`**

Append to `backend/tests/test_prompt_facts_common.py`:

```python
from services.prompt_facts._common import (
    is_near, is_rising_n, is_falling_n, recent_cross, percentile_rank,
)


class TestIsNear:
    def test_within_quarter_atr_returns_true(self):
        assert is_near(price=100.0, level=100.20, atr=1.00) is True   # 0.20 <= 0.25*1.0

    def test_outside_quarter_atr_returns_false(self):
        assert is_near(price=100.0, level=100.30, atr=1.00) is False  # 0.30 > 0.25*1.0

    def test_no_atr_uses_half_percent_fallback(self):
        assert is_near(price=100.0, level=100.49, atr=None) is True   # 0.49% <= 0.5%
        assert is_near(price=100.0, level=100.60, atr=None) is False  # 0.6% > 0.5%

    def test_zero_atr_falls_back_to_percent(self):
        assert is_near(price=100.0, level=100.49, atr=0.0) is True


class TestIsRisingFalling:
    def test_momentum_rising_majority_steps_positive(self):
        # values: ..., 10, 11, 12, 13 — 3 step diffs, all positive
        assert is_rising_n([10, 11, 12, 13], n=3, mode="momentum") is True

    def test_momentum_rising_noisy_majority_positive(self):
        # last 3 step diffs: +1, -0.5, +2 → net positive, 2/3 positive
        assert is_rising_n([10, 11, 10.5, 12.5], n=3, mode="momentum") is True

    def test_momentum_not_rising_when_net_negative(self):
        assert is_rising_n([10, 11, 10.5, 10.0], n=3, mode="momentum") is False

    def test_slow_mode_rising_needs_net_positive_over_n(self):
        assert is_rising_n([1, 2, 1.5, 2.0, 2.5, 3.0], n=5, mode="slow") is True

    def test_returns_false_when_too_few_values(self):
        assert is_rising_n([10, 11], n=3, mode="momentum") is False

    def test_handles_none_entries(self):
        assert is_rising_n([None, 10, 11, 12], n=3, mode="momentum") is True

    def test_falling_is_symmetric(self):
        assert is_falling_n([13, 12, 11, 10], n=3, mode="momentum") is True


class TestRecentCross:
    def test_up_cross_detected_within_daily_window(self):
        # last 5 daily bars: a was below b, then crosses above
        a = [9, 9.5, 10, 11, 12]
        b = [10, 10, 10, 10, 10]
        found, bars_ago = recent_cross(a, b, timeframe="D")
        assert found is True
        assert bars_ago in (1, 2)   # cross between index 1 and 2

    def test_no_cross_returns_false(self):
        a = [9, 9, 9, 9, 9]
        b = [10, 10, 10, 10, 10]
        found, bars_ago = recent_cross(a, b, timeframe="D")
        assert found is False
        assert bars_ago == -1

    def test_hourly_uses_60_underlying_bar_window(self):
        # cross 50 bars ago should still be detected on 1H
        a = [9] * 50 + [11] + [11] * 14    # cross at index 50, total 65 bars
        b = [10] * 65
        found, _ = recent_cross(a, b, timeframe="1H")
        assert found is True


class TestPercentileRank:
    def test_returns_0_when_lowest(self):
        assert percentile_rank(1.0, history=[1, 2, 3, 4, 5]) == pytest.approx(0.0, abs=0.05)

    def test_returns_high_when_top(self):
        assert percentile_rank(5.0, history=[1, 2, 3, 4, 5]) >= 0.8

    def test_respects_lookback(self):
        # only last 3 entries counted; current value 0.5 → lowest of [3,4,5]
        assert percentile_rank(0.5, history=[1, 2, 3, 4, 5], lookback=3) == pytest.approx(0.0, abs=0.05)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
uv run pytest tests/test_prompt_facts_common.py -v
```

Expected: ImportError on `services.prompt_facts._common`.

- [ ] **Step 3: Implement the helpers**

`backend/services/prompt_facts/_common.py`:

```python
"""Shared threshold helpers used by every fact builder.

Imported via `from services.prompt_facts._common import is_near, ...`.
Builders MUST NOT inline these thresholds — keep them centralized so
the v2 learning algorithm can tune them in one place.
"""
from __future__ import annotations

from typing import Literal, Optional


def is_near(price: float, level: float, atr: Optional[float] = None) -> bool:
    """ATR-aware 'is price near this level' check.

    Primary rule: within 0.25 * ATR.
    Fallback (when ATR is missing or zero): within 0.5% of price.
    """
    if atr is not None and atr > 0:
        return abs(price - level) <= 0.25 * atr
    if price == 0:
        return False
    return abs(price - level) / price <= 0.005


_RisingMode = Literal["momentum", "slow"]


def _clean(values: list[Optional[float]]) -> list[float]:
    return [v for v in values if v is not None]


def is_rising_n(
    values: list[Optional[float]],
    n: int = 3,
    mode: _RisingMode = "momentum",
) -> bool:
    """True if `values` has been rising over the last `n` step-diffs.

    momentum mode (default for RSI / MACD hist / Stoch): N=3, requires net
    slope > 0 AND >= ceil(n/2) of the step-diffs same sign as the slope.
    Tolerates one noisy bar.

    slow mode (ADX, OBV slope, BBand-width percentile): looser — just
    net slope > 0 over n bars.
    """
    clean = _clean(values)
    if len(clean) < n:
        return False
    window = clean[-(n + 1):] if len(clean) >= n + 1 else clean
    net = window[-1] - window[0]
    if mode == "slow":
        return net > 0
    diffs = [window[i + 1] - window[i] for i in range(min(n, len(window) - 1))]
    same_sign = sum(1 for d in diffs if d > 0)
    return net > 0 and same_sign >= (n + 1) // 2


def is_falling_n(
    values: list[Optional[float]],
    n: int = 3,
    mode: _RisingMode = "momentum",
) -> bool:
    """Symmetric counterpart to is_rising_n."""
    clean = _clean(values)
    if len(clean) < n:
        return False
    window = clean[-(n + 1):] if len(clean) >= n + 1 else clean
    net = window[-1] - window[0]
    if mode == "slow":
        return net < 0
    diffs = [window[i + 1] - window[i] for i in range(min(n, len(window) - 1))]
    same_sign = sum(1 for d in diffs if d < 0)
    return net < 0 and same_sign >= (n + 1) // 2


# Underlying-bar lookback per displayed timeframe (see spec §6.3).
# 1H / 4H are not true 1H/4H candles — see AI_TIMEFRAME_MAP in routers/ai.py.
_RECENCY_WINDOWS: dict[str, int] = {
    "1H": 60,
    "4H": 48,
    "D":   5,
    "W":   5,
    "M":   5,
}


def recent_cross(
    values_a: list[Optional[float]],
    values_b: list[Optional[float]],
    timeframe: str,
) -> tuple[bool, int]:
    """Did `values_a` cross `values_b` within the timeframe's recency window?

    Returns (True, bars_ago) on cross, (False, -1) otherwise.
    bars_ago counts back from the most recent bar (most recent bar is 0).
    """
    window = _RECENCY_WINDOWS.get(timeframe, 5)
    # Align lengths and clean Nones
    n = min(len(values_a), len(values_b))
    if n < 2:
        return False, -1
    a = values_a[-n:]
    b = values_b[-n:]
    start = max(1, n - window)
    for i in range(n - 1, start - 1, -1):
        a_now, a_prev = a[i], a[i - 1]
        b_now, b_prev = b[i], b[i - 1]
        if None in (a_now, a_prev, b_now, b_prev):
            continue
        # Cross occurs when sign of (a - b) flips between i-1 and i.
        # Treat zero as crossing: prev <= 0 and now > 0, or prev >= 0 and now < 0.
        prev_diff = a_prev - b_prev
        now_diff = a_now - b_now
        if (prev_diff <= 0 and now_diff > 0) or (prev_diff >= 0 and now_diff < 0):
            return True, (n - 1 - i)
    return False, -1


def percentile_rank(
    value: float,
    history: list[Optional[float]],
    lookback: int = 100,
) -> float:
    """Percentile of `value` against the last `lookback` non-None entries.

    Returns a float in [0, 1]. 0.0 means value is at or below the minimum;
    1.0 means value is at or above the maximum.
    """
    clean = _clean(history)
    if not clean:
        return 0.0
    sample = clean[-lookback:]
    below = sum(1 for v in sample if v < value)
    return below / len(sample)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
uv run pytest tests/test_prompt_facts_common.py -v
```

Expected: all passed (3 from Task 1 + the new helper tests).

- [ ] **Step 5: Commit**

```bash
git add backend/services/prompt_facts/_common.py \
        backend/tests/test_prompt_facts_common.py
git commit -m "feat(ai): add threshold helpers (is_near, is_rising_n, recent_cross, percentile_rank)"
```

---

## Task 3: Test infrastructure — syrupy + shared fixture builders

**Files:**
- Modify: `backend/pyproject.toml`
- Modify: `backend/uv.lock` (regenerated)
- Create or modify: `backend/tests/conftest.py`

- [ ] **Step 1: Add syrupy to dev deps**

Edit `backend/pyproject.toml` — add `syrupy>=4.6.0` to the `dev` list under `[dependency-groups]`:

```toml
[dependency-groups]
dev = [
    "pytest>=8.3.0",
    "pytest-asyncio>=0.24.0",
    "syrupy>=4.6.0",
]
```

- [ ] **Step 2: Sync deps**

```bash
cd backend
uv sync
```

Expected: `uv.lock` updated, syrupy installed. Verify:

```bash
uv run python -c "import syrupy; print(syrupy.__version__)"
```

- [ ] **Step 3: Check whether conftest.py already exists**

```bash
ls backend/tests/conftest.py 2>/dev/null || echo "missing"
```

If missing → create it. If present → append the helpers below.

- [ ] **Step 4: Add fixture builders for IndicatorResult / IndicatorValue / CandleData**

Append (or create) `backend/tests/conftest.py`:

```python
"""Shared fixture builders used across prompt_facts tests."""
from __future__ import annotations

from typing import Optional

from models import CandleData, IndicatorResult, IndicatorValue


def make_candle(
    close: float = 100.0,
    *,
    open: Optional[float] = None,
    high: Optional[float] = None,
    low: Optional[float] = None,
    volume: float = 1_000_000.0,
    time: int = 1_700_000_000,
) -> CandleData:
    return CandleData(
        time=time,
        open=open if open is not None else close - 0.5,
        high=high if high is not None else close + 1.0,
        low=low if low is not None else close - 1.0,
        close=close,
        volume=volume,
    )


def make_indicator(
    name: str,
    values: list[dict],
    *,
    type_: str = "oscillator",
    params: Optional[dict] = None,
    start_time: int = 1_700_000_000,
    bar_seconds: int = 86_400,
) -> IndicatorResult:
    """`values` is a list of partial dicts; each becomes one IndicatorValue.

    Example: make_indicator("rsi", [{"value": 55}, {"value": 60}, {"value": 62}])
    """
    iv_list = []
    for i, v in enumerate(values):
        iv_list.append(IndicatorValue(time=start_time + i * bar_seconds, **v))
    return IndicatorResult(
        name=name,
        type=type_,
        values=iv_list,
        params=params or {},
    )
```

- [ ] **Step 5: Smoke test the fixture helpers**

```bash
uv run pytest tests/ -q --collect-only 2>&1 | head -20
```

Expected: pytest collects without errors.

- [ ] **Step 6: Commit**

```bash
git add backend/pyproject.toml backend/uv.lock backend/tests/conftest.py
git commit -m "test(ai): add syrupy snapshot dep + shared fixture builders"
```

---

## Task 4: Fibonacci facts builder

**Files:**
- Create: `backend/services/prompt_facts/fibonacci.py`
- Create: `backend/tests/test_prompt_facts_fibonacci.py`

Replaces both `_format_fibonacci` (consumes `FibonacciResult`) and `_format_fibs` (consumes `list[FibonacciSnapshot]`). One builder, internal adapter normalizes both sources to a common shape.

### Internal adapter shape

```python
# NormalizedFib (not exported) — common interface used internally:
#   direction: "up" | "down"
#   swing_high: float
#   swing_low: float
#   is_nested: bool
#   parent_score: Optional[float]
#   convergence_zones: list[dict]  (only auto-fibs carry these; empty for snapshots)
```

### Fact IDs (from spec §7.1)

`position_inside_swing`, `position_above_swing`, `position_below_swing`,
`in_golden_pocket`, `near_golden_pocket`, `price_near_{ratio}` (`0382 / 0500 / 0618 / 0650 / 0716`),
`away_from_levels`, `target_extension_{ratio}` (`1272 / 1500 / 1618`),
`nested_inside_parent`, `convergence_cross_tf`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_prompt_facts_fibonacci.py`:

```python
"""Fibonacci fact builder tests — the canonical 'no false fact' suite."""
from __future__ import annotations

import pytest

from models import FibonacciCandidate, FibonacciLevel, FibonacciResult, FibonacciSnapshot
from services.prompt_facts.fibonacci import build_facts


def _fib_result(
    *,
    direction: str = "up",
    swing_low: float = 145.20,
    swing_high: float = 210.50,
    levels: list[FibonacciLevel] | None = None,
    is_nested: bool = False,
    convergence_zones: list[dict] | None = None,
) -> FibonacciResult:
    """Minimal FibonacciResult for tests. Levels list passed in so tests
    can craft specific golden-pocket / near-level scenarios."""
    return FibonacciResult(
        tool_mode="retracement",
        swing_high=swing_high,
        swing_low=swing_low,
        swing_high_time=1_700_000_000,
        swing_low_time=1_699_900_000,
        direction=direction,
        levels=levels or [],
        extensions=[],
        score=80.0,
        swing_clarity=0.85,
        timeframe_clarity="clean",
        candidates=[],
        convergence_zones=convergence_zones or [],
        is_nested=is_nested,
        reasoning="test",
    )


class TestTsmExtensionCase:
    """The canonical bug: price past swing high → extension territory,
    must NOT emit any 'price near 0.5 retracement' facts."""

    def test_extension_emits_position_above_swing(self):
        fib = _fib_result(direction="up", swing_low=145.20, swing_high=210.50)
        facts = build_facts(fib, last_close=215.40, atr=4.10, timeframe="D")
        ids = {f.id for f in facts}
        assert "D.fibonacci.position_above_swing" in ids

    def test_extension_does_not_emit_price_near_05(self):
        fib = _fib_result(direction="up", swing_low=145.20, swing_high=210.50)
        facts = build_facts(fib, last_close=215.40, atr=4.10, timeframe="D")
        ids = {f.id for f in facts}
        # The original bug fabricated D.fibonacci.price_near_0500
        for ratio in ("0382", "0500", "0618", "0650", "0716"):
            assert f"D.fibonacci.price_near_{ratio}" not in ids

    def test_extension_skips_inside_swing_fact(self):
        fib = _fib_result(direction="up", swing_low=145.20, swing_high=210.50)
        facts = build_facts(fib, last_close=215.40, atr=4.10, timeframe="D")
        ids = {f.id for f in facts}
        assert "D.fibonacci.position_inside_swing" not in ids


class TestInsideSwing:
    def test_inside_swing_with_golden_pocket(self):
        # GP for an UP swing 100→200 spans 162 (0.618 from high = 162) to 145 (0.716 from high)
        # Actually for UP: retracement from high — level at ratio = high - (high-low)*ratio
        # ratio 0.618 → 200 - 100*0.618 = 138.2
        # ratio 0.716 → 200 - 100*0.716 = 128.4
        # ratio 0.650 → 200 - 100*0.650 = 135.0
        # GP spans 128.4 ↔ 138.2; price 133.0 is inside.
        fib = _fib_result(
            direction="up", swing_low=100.0, swing_high=200.0,
            levels=[
                FibonacciLevel(level=0.618, price=138.2, label="0.618", golden_pocket=True),
                FibonacciLevel(level=0.650, price=135.0, label="0.65",  golden_pocket=True),
                FibonacciLevel(level=0.716, price=128.4, label="0.716", golden_pocket=True),
            ],
        )
        facts = build_facts(fib, last_close=133.0, atr=2.0, timeframe="D")
        ids = {f.id for f in facts}
        assert "D.fibonacci.in_golden_pocket" in ids
        assert "D.fibonacci.position_inside_swing" in ids

    def test_inside_swing_near_levels_emits_price_near_only_for_close_ones(self):
        # ATR=2; quarter ATR = 0.5. Price 138.4 is 0.2 from 138.2 (NEAR 0.618).
        # Price is also 3.4 from 135.0 (NOT near 0.65) and 10.0 from 128.4 (NOT near 0.716).
        fib = _fib_result(
            direction="up", swing_low=100.0, swing_high=200.0,
            levels=[
                FibonacciLevel(level=0.618, price=138.2, label="0.618", golden_pocket=True),
                FibonacciLevel(level=0.650, price=135.0, label="0.65",  golden_pocket=True),
                FibonacciLevel(level=0.716, price=128.4, label="0.716", golden_pocket=True),
            ],
        )
        facts = build_facts(fib, last_close=138.4, atr=2.0, timeframe="D")
        ids = {f.id for f in facts}
        assert "D.fibonacci.price_near_0618" in ids
        assert "D.fibonacci.price_near_0650" not in ids
        assert "D.fibonacci.price_near_0716" not in ids

    def test_away_from_levels_when_no_level_in_play(self):
        # All levels far from 180.0; quarter ATR = 0.5; nothing within 0.5.
        fib = _fib_result(
            direction="up", swing_low=100.0, swing_high=200.0,
            levels=[
                FibonacciLevel(level=0.382, price=161.8, label="0.382"),
                FibonacciLevel(level=0.500, price=150.0, label="0.5"),
                FibonacciLevel(level=0.618, price=138.2, label="0.618", golden_pocket=True),
            ],
        )
        facts = build_facts(fib, last_close=180.0, atr=2.0, timeframe="D")
        ids = {f.id for f in facts}
        assert "D.fibonacci.away_from_levels" in ids
        for ratio in ("0382", "0500", "0618"):
            assert f"D.fibonacci.price_near_{ratio}" not in ids


class TestDownSwing:
    def test_below_swing_emits_position_below_swing(self):
        fib = _fib_result(direction="down", swing_low=120.0, swing_high=200.0)
        facts = build_facts(fib, last_close=115.0, atr=2.0, timeframe="D")
        ids = {f.id for f in facts}
        assert "D.fibonacci.position_below_swing" in ids


class TestNestingAndConvergence:
    def test_nested_emits_caution_fact(self):
        fib = _fib_result(is_nested=True)
        facts = build_facts(fib, last_close=170.0, atr=2.0, timeframe="D")
        ids = {f.id for f in facts}
        assert "D.fibonacci.nested_inside_parent" in ids
        nested = next(f for f in facts if f.id == "D.fibonacci.nested_inside_parent")
        assert nested.polarity == "caution"

    def test_convergence_emits_fact(self):
        fib = _fib_result(convergence_zones=[{"price": 150.0, "timeframes": ["D", "W"]}])
        facts = build_facts(fib, last_close=170.0, atr=2.0, timeframe="D")
        ids = {f.id for f in facts}
        assert "D.fibonacci.convergence_cross_tf" in ids


class TestSnapshotInput:
    def test_snapshot_is_normalized_same_as_result(self):
        snap = FibonacciSnapshot(
            source="manual",
            swing_high=210.50,
            swing_low=145.20,
            swing_high_time=1_700_000_000,
            swing_low_time=1_699_900_000,
            direction="up",
            is_primary=True,
        )
        facts = build_facts(snap, last_close=215.40, atr=4.10, timeframe="D")
        ids = {f.id for f in facts}
        assert "D.fibonacci.position_above_swing" in ids


class TestGuards:
    def test_returns_empty_when_input_none(self):
        assert build_facts(None, last_close=100.0, atr=1.0, timeframe="D") == []

    def test_returns_empty_when_swings_degenerate(self):
        fib = _fib_result(swing_low=100.0, swing_high=100.0)
        assert build_facts(fib, last_close=100.0, atr=1.0, timeframe="D") == []
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
uv run pytest tests/test_prompt_facts_fibonacci.py -v
```

Expected: ImportError on `services.prompt_facts.fibonacci`.

- [ ] **Step 3: Implement the builder**

`backend/services/prompt_facts/fibonacci.py`:

```python
"""Fibonacci fact builder.

Handles both FibonacciResult (backend auto-fibs) and FibonacciSnapshot
(frontend-provided active fibs) via an internal NormalizedFib adapter.

The position logic is the deterministic fix for the original TSM
extension bug: if price is past the swing in the trend direction, we
emit position_above_swing / position_below_swing and SKIP all retracement
level near-checks — those levels aren't in play.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Union

from models import FibonacciLevel, FibonacciResult, FibonacciSnapshot
from services.indicators import (
    FIB_RETRACEMENT_LEVELS,
    GOLDEN_POCKET_LEVELS,
    IndicatorService,
)
from services.prompt_facts._common import is_near
from services.prompt_facts.types import PromptFact

# Ratios reported as price_near_<ratio> facts when computable.
# Spelled with no decimal point so the ID stays a valid identifier.
_RATIO_SUFFIX = {
    0.382: "0382",
    0.500: "0500",
    0.618: "0618",
    0.650: "0650",
    0.716: "0716",
}
_GP_BOUNDARIES = (0.618, 0.716)   # spec §7.1; matches GOLDEN_POCKET_LEVELS
_TARGET_EXTENSIONS = {1.272: "1272", 1.500: "1500", 1.618: "1618"}


@dataclass
class _Norm:
    direction: str
    swing_low: float
    swing_high: float
    is_nested: bool
    parent_score: Optional[float]
    convergence_zones: list[dict]
    retracement_levels: list[FibonacciLevel]


def _normalize(
    fib: Union[FibonacciResult, FibonacciSnapshot],
) -> Optional[_Norm]:
    if fib is None:
        return None
    if isinstance(fib, FibonacciResult):
        return _Norm(
            direction=fib.direction,
            swing_low=fib.swing_low,
            swing_high=fib.swing_high,
            is_nested=fib.is_nested,
            parent_score=None,
            convergence_zones=list(fib.convergence_zones or []),
            retracement_levels=list(fib.levels),
        )
    # FibonacciSnapshot — synthesize levels from the swing.
    levels = IndicatorService._build_levels(
        swing_low=fib.swing_low,
        swing_high=fib.swing_high,
        direction=fib.direction,
        ratios=FIB_RETRACEMENT_LEVELS,
        kind="retracement",
    )
    return _Norm(
        direction=fib.direction,
        swing_low=fib.swing_low,
        swing_high=fib.swing_high,
        is_nested=False,
        parent_score=None,
        convergence_zones=[],
        retracement_levels=levels,
    )


def _gp_prices(norm: _Norm) -> dict[float, float]:
    """Compute the price for each GP-boundary ratio in this swing."""
    out: dict[float, float] = {}
    span = norm.swing_high - norm.swing_low
    for ratio in (0.618, 0.650, 0.716):
        if norm.direction == "up":
            out[ratio] = norm.swing_high - span * ratio
        else:
            out[ratio] = norm.swing_low + span * ratio
    return out


def _make_fact(
    *,
    tf: str,
    condition: str,
    text: str,
    polarity: str,
    strength: int,
    priority: int,
    data: dict,
) -> PromptFact:
    return PromptFact(
        id=f"{tf}.fibonacci.{condition}",
        timeframe=tf,
        indicator="fibonacci",
        text=text,
        polarity=polarity,
        strength=strength,
        priority=priority,
        data=data,
    )


def build_facts(
    fib: Union[FibonacciResult, FibonacciSnapshot, None],
    *,
    last_close: float,
    atr: Optional[float],
    timeframe: str,
) -> list[PromptFact]:
    """Build all fibonacci facts for one timeframe.

    Returns [] if input is None, swings are degenerate, or last_close is
    not positive.
    """
    norm = _normalize(fib)
    if norm is None:
        return []
    if norm.swing_high - norm.swing_low <= 0:
        return []
    if last_close <= 0:
        return []

    facts: list[PromptFact] = []

    # ── Position (the original bug fix) ─────────────────────────
    if norm.direction == "up" and last_close > norm.swing_high:
        pct_above = (last_close - norm.swing_high) / norm.swing_high * 100
        facts.append(_make_fact(
            tf=timeframe, condition="position_above_swing",
            text=(
                f"Price ${last_close:.2f} is {pct_above:+.1f}% above the swing high "
                f"${norm.swing_high:.2f} — extension territory, retracement levels not in play."
            ),
            polarity="bullish", strength=70, priority=95,
            data={"pct_above_swing_high": pct_above, "swing_high": norm.swing_high},
        ))
        return _finalize(facts, norm, timeframe)

    if norm.direction == "down" and last_close < norm.swing_low:
        pct_below = (norm.swing_low - last_close) / norm.swing_low * 100
        facts.append(_make_fact(
            tf=timeframe, condition="position_below_swing",
            text=(
                f"Price ${last_close:.2f} is {pct_below:+.1f}% below the swing low "
                f"${norm.swing_low:.2f} — extension territory, retracement levels not in play."
            ),
            polarity="bearish", strength=70, priority=95,
            data={"pct_below_swing_low": pct_below, "swing_low": norm.swing_low},
        ))
        return _finalize(facts, norm, timeframe)

    # Inside the swing
    span = norm.swing_high - norm.swing_low
    pct_into = (
        (last_close - norm.swing_low) / span * 100
        if norm.direction == "up"
        else (norm.swing_high - last_close) / span * 100
    )
    facts.append(_make_fact(
        tf=timeframe, condition="position_inside_swing",
        text=(
            f"Price ${last_close:.2f} sits at {pct_into:.0f}% into the "
            f"${norm.swing_low:.2f}–${norm.swing_high:.2f} swing ({norm.direction.upper()})."
        ),
        polarity="neutral", strength=40, priority=80,
        data={"pct_into_swing": pct_into},
    ))

    # ── Golden pocket ───────────────────────────────────────────
    gp = _gp_prices(norm)
    gp_lo, gp_hi = sorted((gp[0.618], gp[0.716]))
    inside_gp = gp_lo <= last_close <= gp_hi
    if inside_gp:
        polarity = "bullish" if norm.direction == "up" else "bearish"
        facts.append(_make_fact(
            tf=timeframe, condition="in_golden_pocket",
            text=(
                f"Price ${last_close:.2f} is inside the golden pocket "
                f"(${gp_lo:.2f}–${gp_hi:.2f}, ratios 0.618–0.716)."
            ),
            polarity=polarity, strength=80, priority=90,
            data={
                "level_0618": gp[0.618],
                "level_0650": gp[0.650],
                "level_0716": gp[0.716],
            },
        ))
    else:
        # near a GP boundary?
        nearest = min(_GP_BOUNDARIES, key=lambda r: abs(last_close - gp[r]))
        if is_near(last_close, gp[nearest], atr):
            distance_atr = abs(last_close - gp[nearest]) / atr if atr else None
            facts.append(_make_fact(
                tf=timeframe, condition="near_golden_pocket",
                text=(
                    f"Price ${last_close:.2f} is near the {nearest:.3f} GP boundary "
                    f"at ${gp[nearest]:.2f}."
                ),
                polarity="neutral", strength=55, priority=85,
                data={"distance_atr": distance_atr, "nearest_boundary_ratio": nearest},
            ))

    # ── price_near_<ratio> for individual retracement levels ────
    any_near = False
    for level in norm.retracement_levels:
        suffix = _RATIO_SUFFIX.get(round(level.level, 3))
        if suffix is None:
            continue
        if is_near(last_close, level.price, atr):
            any_near = True
            facts.append(_make_fact(
                tf=timeframe, condition=f"price_near_{suffix}",
                text=(
                    f"Price ${last_close:.2f} is near the {level.label} retracement "
                    f"at ${level.price:.2f}."
                ),
                polarity="neutral", strength=60, priority=70,
                data={"level_price": level.price, "ratio": level.level},
            ))

    if not any_near and not inside_gp:
        # nothing in play
        nearest_above = min(
            (lv.price for lv in norm.retracement_levels if lv.price > last_close),
            default=None,
        )
        nearest_below = max(
            (lv.price for lv in norm.retracement_levels if lv.price < last_close),
            default=None,
        )
        facts.append(_make_fact(
            tf=timeframe, condition="away_from_levels",
            text=(
                f"No retracement level within striking distance of "
                f"${last_close:.2f} (ATR-aware threshold)."
            ),
            polarity="neutral", strength=30, priority=40,
            data={"nearest_above": nearest_above, "nearest_below": nearest_below},
        ))

    return _finalize(facts, norm, timeframe)


def _finalize(
    facts: list[PromptFact],
    norm: _Norm,
    timeframe: str,
) -> list[PromptFact]:
    if norm.is_nested:
        facts.append(_make_fact(
            tf=timeframe, condition="nested_inside_parent",
            text="This swing is nested inside a higher-scoring parent fib.",
            polarity="caution", strength=35, priority=60,
            data={"parent_score": norm.parent_score},
        ))
    if norm.convergence_zones:
        for zone in norm.convergence_zones:
            price = zone.get("price")
            tfs = zone.get("timeframes", [])
            facts.append(_make_fact(
                tf=timeframe, condition="convergence_cross_tf",
                text=(
                    f"Cross-TF fib convergence near ${price} across {', '.join(tfs)}."
                ),
                polarity="bullish" if norm.direction == "up" else "bearish",
                strength=75, priority=88,
                data={"convergence_price": price, "timeframes": tfs},
            ))
    return facts
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
uv run pytest tests/test_prompt_facts_fibonacci.py -v
```

Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add backend/services/prompt_facts/fibonacci.py \
        backend/tests/test_prompt_facts_fibonacci.py
git commit -m "feat(ai): fibonacci fact builder — fixes TSM extension bug"
```

---

## Task 5: EMA facts builder

**Files:**
- Create: `backend/services/prompt_facts/ema.py`
- Create: `backend/tests/test_prompt_facts_ema.py`

EMA family receives multiple `IndicatorResult` objects (one per period: `ema_9`, `ema_21`, `ema_50`, `ema_200`). Builder takes a dict keyed by period.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_prompt_facts_ema.py`:

```python
from __future__ import annotations

import pytest

from models import IndicatorResult, IndicatorValue
from services.prompt_facts.ema import build_facts


def _ema(period: int, last_val: float) -> IndicatorResult:
    return IndicatorResult(
        name=f"ema_{period}",
        type="overlay",
        values=[
            IndicatorValue(time=1_700_000_000 + i * 86_400, value=last_val - (10 - i) * 0.1)
            for i in range(11)
        ],
        params={"period": period},
    )


class TestStackOrder:
    def test_bullish_stack_when_9_above_21_above_50_above_200(self):
        emas = {9: _ema(9, 110), 21: _ema(21, 105), 50: _ema(50, 100), 200: _ema(200, 90)}
        facts = build_facts(emas, last_close=112.0, atr=1.0, timeframe="D")
        ids = {f.id for f in facts}
        assert "D.ema.stack_bullish" in ids
        assert "D.ema.price_above_all" in ids

    def test_bearish_stack_when_inverted(self):
        emas = {9: _ema(9, 90), 21: _ema(21, 100), 50: _ema(50, 110), 200: _ema(200, 120)}
        facts = build_facts(emas, last_close=85.0, atr=1.0, timeframe="D")
        ids = {f.id for f in facts}
        assert "D.ema.stack_bearish" in ids
        assert "D.ema.price_below_all" in ids

    def test_mixed_stack_when_not_ordered(self):
        emas = {9: _ema(9, 110), 21: _ema(21, 100), 50: _ema(50, 105), 200: _ema(200, 90)}
        facts = build_facts(emas, last_close=108.0, atr=1.0, timeframe="D")
        ids = {f.id for f in facts}
        assert "D.ema.stack_mixed" in ids

    def test_incomplete_when_period_missing(self):
        emas = {9: _ema(9, 110), 21: _ema(21, 100)}    # no 50/200
        facts = build_facts(emas, last_close=108.0, atr=1.0, timeframe="D")
        ids = {f.id for f in facts}
        assert "D.ema.stack_incomplete" in ids


class TestNearAndCross:
    def test_price_near_ema_emits_per_period(self):
        # ATR 1.0, quarter ATR 0.25. Price 110.10 is 0.10 from EMA9 (110.00) → NEAR.
        emas = {9: _ema(9, 110), 21: _ema(21, 105), 50: _ema(50, 100), 200: _ema(200, 90)}
        facts = build_facts(emas, last_close=110.10, atr=1.0, timeframe="D")
        ids = {f.id for f in facts}
        assert "D.ema.price_near_9" in ids
        assert "D.ema.price_near_21" not in ids


class TestGuards:
    def test_empty_dict_returns_empty(self):
        assert build_facts({}, last_close=100.0, atr=1.0, timeframe="D") == []

    def test_none_values_returns_empty(self):
        ir = IndicatorResult(name="ema_9", type="overlay", values=[
            IndicatorValue(time=1_700_000_000, value=None),
        ], params={})
        assert build_facts({9: ir}, last_close=100.0, atr=1.0, timeframe="D") == []
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
uv run pytest tests/test_prompt_facts_ema.py -v
```

Expected: ImportError.

- [ ] **Step 3: Implement the builder**

`backend/services/prompt_facts/ema.py`:

```python
"""EMA facts — stack order, price-vs-all-EMAs, per-period near checks, crosses."""
from __future__ import annotations

from typing import Optional

from models import IndicatorResult
from services.prompt_facts._common import is_near, recent_cross
from services.prompt_facts.types import PromptFact


def _last_val(ir: IndicatorResult) -> Optional[float]:
    if not ir.values:
        return None
    return ir.values[-1].value


def _make(tf: str, condition: str, text: str, polarity: str,
          strength: int, priority: int, data: dict) -> PromptFact:
    return PromptFact(
        id=f"{tf}.ema.{condition}", timeframe=tf, indicator="ema",
        text=text, polarity=polarity, strength=strength,
        priority=priority, data=data,
    )


def build_facts(
    emas: dict[int, IndicatorResult],
    *,
    last_close: float,
    atr: Optional[float],
    timeframe: str,
) -> list[PromptFact]:
    if not emas:
        return []
    values: dict[int, float] = {}
    for period, ir in emas.items():
        v = _last_val(ir)
        if v is None:
            continue
        values[period] = v
    if not values:
        return []

    required = {9, 21, 50, 200}
    have = set(values.keys())
    facts: list[PromptFact] = []

    # per-period distance table for fact data
    per_period = [
        {"period": p, "value": values[p],
         "distance_pct": (last_close - values[p]) / values[p] * 100 if values[p] else 0.0}
        for p in sorted(values.keys())
    ]

    # ── Stack classification ────────────────────────────────────
    if not required.issubset(have):
        facts.append(_make(
            timeframe, "stack_incomplete",
            text=f"EMA stack incomplete — have periods {sorted(have)}, need {sorted(required)}.",
            polarity="neutral", strength=25, priority=70,
            data={"periods": per_period, "missing": sorted(required - have)},
        ))
    else:
        ordered_desc = [values[p] for p in (9, 21, 50, 200)]
        if all(ordered_desc[i] > ordered_desc[i + 1] for i in range(3)):
            facts.append(_make(
                timeframe, "stack_bullish",
                text=(
                    f"EMA stack bullish: 9 (${values[9]:.2f}) > 21 (${values[21]:.2f}) "
                    f"> 50 (${values[50]:.2f}) > 200 (${values[200]:.2f})."
                ),
                polarity="bullish", strength=85, priority=92,
                data={"periods": per_period},
            ))
        elif all(ordered_desc[i] < ordered_desc[i + 1] for i in range(3)):
            facts.append(_make(
                timeframe, "stack_bearish",
                text=(
                    f"EMA stack bearish: 9 (${values[9]:.2f}) < 21 (${values[21]:.2f}) "
                    f"< 50 (${values[50]:.2f}) < 200 (${values[200]:.2f})."
                ),
                polarity="bearish", strength=85, priority=92,
                data={"periods": per_period},
            ))
        else:
            facts.append(_make(
                timeframe, "stack_mixed",
                text=(
                    f"EMA stack mixed — periods not in monotone order "
                    f"(9 ${values[9]:.2f}, 21 ${values[21]:.2f}, "
                    f"50 ${values[50]:.2f}, 200 ${values[200]:.2f})."
                ),
                polarity="caution", strength=40, priority=75,
                data={"periods": per_period},
            ))

    # ── Price vs all EMAs ───────────────────────────────────────
    if all(last_close > v for v in values.values()):
        facts.append(_make(
            timeframe, "price_above_all",
            text=f"Price ${last_close:.2f} is above every available EMA.",
            polarity="bullish", strength=70, priority=85,
            data={"periods": per_period},
        ))
    elif all(last_close < v for v in values.values()):
        facts.append(_make(
            timeframe, "price_below_all",
            text=f"Price ${last_close:.2f} is below every available EMA.",
            polarity="bearish", strength=70, priority=85,
            data={"periods": per_period},
        ))

    # ── Per-period near checks ──────────────────────────────────
    for period, v in values.items():
        if is_near(last_close, v, atr):
            facts.append(_make(
                timeframe, f"price_near_{period}",
                text=f"Price ${last_close:.2f} is at the EMA-{period} (${v:.2f}).",
                polarity="neutral", strength=55, priority=72,
                data={"period": period, "value": v},
            ))

    # ── Cross detection (golden / death between adjacent EMAs) ──
    cross_pairs = [(9, 21), (21, 50), (50, 200)]
    for short, long in cross_pairs:
        if short not in emas or long not in emas:
            continue
        a = [iv.value for iv in emas[short].values]
        b = [iv.value for iv in emas[long].values]
        found, bars_ago = recent_cross(a, b, timeframe=timeframe)
        if not found:
            continue
        s_now = values[short]
        l_now = values[long]
        polarity = "bullish" if s_now > l_now else "bearish"
        facts.append(_make(
            timeframe, f"cross_{short}_{long}_recent",
            text=(
                f"EMA-{short} crossed EMA-{long} {bars_ago} bar(s) ago "
                f"({'golden' if polarity == 'bullish' else 'death'} cross)."
            ),
            polarity=polarity, strength=75, priority=88,
            data={"short": short, "long": long, "bars_ago": bars_ago},
        ))

    return facts
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
uv run pytest tests/test_prompt_facts_ema.py -v
```

- [ ] **Step 5: Commit**

```bash
git add backend/services/prompt_facts/ema.py backend/tests/test_prompt_facts_ema.py
git commit -m "feat(ai): EMA fact builder — stack + price-vs-all + crosses"
```

---

## Task 6: RSI facts builder

**Files:**
- Create: `backend/services/prompt_facts/rsi.py`
- Create: `backend/tests/test_prompt_facts_rsi.py`

- [ ] **Step 1: Write the failing tests**

```python
from __future__ import annotations

import pytest

from models import IndicatorResult, IndicatorValue
from services.prompt_facts.rsi import build_facts


def _rsi(series: list[float]) -> IndicatorResult:
    return IndicatorResult(
        name="rsi", type="oscillator",
        values=[IndicatorValue(time=1_700_000_000 + i * 86400, value=v) for i, v in enumerate(series)],
        params={"period": 14},
    )


class TestRsi:
    def test_above_50_rising(self):
        facts = build_facts(_rsi([52, 55, 58, 62]), timeframe="D")
        ids = {f.id for f in facts}
        assert "D.rsi.above_50_rising" in ids
        f = next(x for x in facts if x.id == "D.rsi.above_50_rising")
        assert f.polarity == "bullish"

    def test_below_50_falling(self):
        facts = build_facts(_rsi([48, 45, 42, 38]), timeframe="D")
        ids = {f.id for f in facts}
        assert "D.rsi.below_50_falling" in ids

    def test_above_50_falling_is_neutral(self):
        facts = build_facts(_rsi([70, 65, 60, 55]), timeframe="D")
        f = next(x for x in facts if x.id == "D.rsi.above_50_falling")
        assert f.polarity == "neutral"

    def test_overbought_is_caution(self):
        facts = build_facts(_rsi([70, 72, 73, 74]), timeframe="D")
        f = next(x for x in facts if x.id == "D.rsi.overbought")
        assert f.polarity == "caution"

    def test_oversold_is_caution(self):
        facts = build_facts(_rsi([30, 28, 26, 24]), timeframe="D")
        f = next(x for x in facts if x.id == "D.rsi.oversold")
        assert f.polarity == "caution"

    def test_returns_empty_when_no_values(self):
        ir = IndicatorResult(name="rsi", type="oscillator", values=[], params={})
        assert build_facts(ir, timeframe="D") == []
```

- [ ] **Step 2: Run — verify fail**

```bash
uv run pytest tests/test_prompt_facts_rsi.py -v
```

- [ ] **Step 3: Implement**

```python
"""RSI facts — above/below 50 with momentum, OB/OS extremes, recent crosses."""
from __future__ import annotations

from typing import Optional

from models import IndicatorResult
from services.prompt_facts._common import is_falling_n, is_rising_n, recent_cross
from services.prompt_facts.types import PromptFact


def _make(tf: str, condition: str, text: str, polarity: str,
          strength: int, priority: int, data: dict) -> PromptFact:
    return PromptFact(
        id=f"{tf}.rsi.{condition}", timeframe=tf, indicator="rsi",
        text=text, polarity=polarity, strength=strength,
        priority=priority, data=data,
    )


def build_facts(ind: Optional[IndicatorResult], *, timeframe: str) -> list[PromptFact]:
    if ind is None or not ind.values:
        return []
    series = [iv.value for iv in ind.values]
    clean = [v for v in series if v is not None]
    if not clean:
        return []
    rsi = clean[-1]
    facts: list[PromptFact] = []

    rising = is_rising_n(series, n=3, mode="momentum")
    falling = is_falling_n(series, n=3, mode="momentum")

    if rsi > 50 and rising:
        facts.append(_make(
            timeframe, "above_50_rising",
            f"RSI {rsi:.1f}, above 50 and rising 3 bars.",
            polarity="bullish", strength=60, priority=80,
            data={"rsi": rsi},
        ))
    elif rsi > 50 and falling:
        facts.append(_make(
            timeframe, "above_50_falling",
            f"RSI {rsi:.1f}, above 50 but falling 3 bars.",
            polarity="neutral", strength=45, priority=75,
            data={"rsi": rsi},
        ))
    elif rsi < 50 and falling:
        facts.append(_make(
            timeframe, "below_50_falling",
            f"RSI {rsi:.1f}, below 50 and falling 3 bars.",
            polarity="bearish", strength=60, priority=80,
            data={"rsi": rsi},
        ))
    elif rsi < 50 and rising:
        facts.append(_make(
            timeframe, "below_50_rising",
            f"RSI {rsi:.1f}, below 50 but rising 3 bars.",
            polarity="neutral", strength=45, priority=75,
            data={"rsi": rsi},
        ))

    if rsi > 70:
        facts.append(_make(
            timeframe, "overbought",
            f"RSI {rsi:.1f} above 70 — overbought.",
            polarity="caution", strength=55, priority=78,
            data={"rsi": rsi},
        ))
    if rsi < 30:
        facts.append(_make(
            timeframe, "oversold",
            f"RSI {rsi:.1f} below 30 — oversold.",
            polarity="caution", strength=55, priority=78,
            data={"rsi": rsi},
        ))

    # Recent crosses 30 / 50 / 70
    constants = {"30_recent": 30.0, "50_recent": 50.0, "70_recent": 70.0}
    polarity_for: dict[str, str] = {"30_recent": "caution", "70_recent": "caution"}
    for cond_suffix, threshold in constants.items():
        ref = [threshold] * len(series)
        found, bars_ago = recent_cross(series, ref, timeframe=timeframe)
        if not found:
            continue
        if cond_suffix == "50_recent":
            polarity = "bullish" if rsi > 50 else "bearish"
        else:
            polarity = polarity_for[cond_suffix]
        facts.append(_make(
            timeframe, f"cross_{cond_suffix}",
            f"RSI crossed {threshold:.0f} {bars_ago} bar(s) ago.",
            polarity=polarity, strength=50, priority=70,
            data={"threshold": threshold, "bars_ago": bars_ago,
                  "direction": "up" if rsi > threshold else "down"},
        ))

    return facts
```

- [ ] **Step 4: Run — verify pass**

```bash
uv run pytest tests/test_prompt_facts_rsi.py -v
```

- [ ] **Step 5: Commit**

```bash
git add backend/services/prompt_facts/rsi.py backend/tests/test_prompt_facts_rsi.py
git commit -m "feat(ai): RSI fact builder — above/below 50 momentum + OB/OS"
```

---

## Task 7: MACD facts builder

**Files:**
- Create: `backend/services/prompt_facts/macd.py`
- Create: `backend/tests/test_prompt_facts_macd.py`

Emits two facts per analysis: one for the **line state** (line vs signal × vs zero), one for the **histogram state** (sign × 3-bar direction). Plus a recent cross fact when applicable.

- [ ] **Step 1: Write the failing tests**

```python
from __future__ import annotations

import pytest

from models import IndicatorResult, IndicatorValue
from services.prompt_facts.macd import build_facts


def _macd(line: list[float], signal: list[float], hist: list[float]) -> IndicatorResult:
    n = min(len(line), len(signal), len(hist))
    vals = [
        IndicatorValue(time=1_700_000_000 + i * 86400,
                       value=line[i], signal=signal[i], histogram=hist[i])
        for i in range(n)
    ]
    return IndicatorResult(name="macd", type="oscillator", values=vals,
                           params={"fast": 12, "slow": 26, "signal": 9})


class TestMacd:
    def test_line_bullish_impulse(self):
        # line > signal, line > 0
        facts = build_facts(_macd([0.5]*4, [0.2]*4, [0.3]*4), timeframe="D")
        f = next(x for x in facts if x.id == "D.macd.line_bullish_impulse")
        assert f.polarity == "bullish"

    def test_line_bearish_improving_is_neutral(self):
        # line > signal, line < 0
        facts = build_facts(_macd([-0.2]*4, [-0.5]*4, [0.3]*4), timeframe="D")
        f = next(x for x in facts if x.id == "D.macd.line_bearish_improving")
        assert f.polarity == "neutral"

    def test_hist_above_rising(self):
        facts = build_facts(_macd([0.5]*4, [0.4]*4, [0.10, 0.15, 0.20, 0.25]), timeframe="D")
        ids = {f.id for f in facts}
        assert "D.macd.hist_above_rising" in ids

    def test_hist_skips_when_near_zero(self):
        facts = build_facts(_macd([0.0]*4, [0.0]*4, [0.0, 0.0, 0.0, 0.00005]), timeframe="D")
        ids = {f.id for f in facts}
        assert not any("hist_" in i for i in ids)

    def test_recent_cross_emits(self):
        # line crosses signal up between bars 2 and 3
        facts = build_facts(_macd([-0.1, -0.05, 0.0, 0.10],
                                  [0.1, 0.1, 0.05, 0.05],
                                  [-0.2, -0.15, -0.05, 0.05]),
                            timeframe="D")
        ids = {f.id for f in facts}
        assert "D.macd.cross_recent" in ids
        f = next(x for x in facts if x.id == "D.macd.cross_recent")
        assert f.data["direction"] == "up"

    def test_empty_returns_empty(self):
        ir = IndicatorResult(name="macd", type="oscillator", values=[], params={})
        assert build_facts(ir, timeframe="D") == []
```

- [ ] **Step 2: Run — verify fail**

```bash
uv run pytest tests/test_prompt_facts_macd.py -v
```

- [ ] **Step 3: Implement**

```python
"""MACD facts — line state (4-quadrant), histogram state (4-quadrant), recent cross."""
from __future__ import annotations

from typing import Optional

from models import IndicatorResult
from services.prompt_facts._common import is_falling_n, is_rising_n, recent_cross
from services.prompt_facts.types import PromptFact

_HIST_EPSILON = 1e-4


def _make(tf: str, condition: str, text: str, polarity: str,
          strength: int, priority: int, data: dict) -> PromptFact:
    return PromptFact(
        id=f"{tf}.macd.{condition}", timeframe=tf, indicator="macd",
        text=text, polarity=polarity, strength=strength,
        priority=priority, data=data,
    )


def build_facts(ind: Optional[IndicatorResult], *, timeframe: str) -> list[PromptFact]:
    if ind is None or not ind.values:
        return []
    line_series = [iv.value for iv in ind.values]
    sig_series = [iv.signal for iv in ind.values]
    hist_series = [iv.histogram for iv in ind.values]
    if not line_series or line_series[-1] is None or sig_series[-1] is None:
        return []
    line = line_series[-1]
    sig = sig_series[-1]
    hist = hist_series[-1] if hist_series[-1] is not None else 0.0

    facts: list[PromptFact] = []

    # ── Line state ──────────────────────────────────────────────
    line_above_sig = line > sig
    line_above_zero = line > 0
    line_data = {"line": line, "signal": sig, "hist": hist}
    if line_above_sig and line_above_zero:
        facts.append(_make(
            timeframe, "line_bullish_impulse",
            f"MACD line {line:.3f} above signal {sig:.3f}, both above zero.",
            polarity="bullish", strength=75, priority=85, data=line_data,
        ))
    elif line_above_sig and not line_above_zero:
        facts.append(_make(
            timeframe, "line_bearish_improving",
            f"MACD line {line:.3f} above signal {sig:.3f} but still below zero.",
            polarity="neutral", strength=50, priority=72, data=line_data,
        ))
    elif (not line_above_sig) and line_above_zero:
        facts.append(_make(
            timeframe, "line_bullish_weakening",
            f"MACD line {line:.3f} below signal {sig:.3f}, still above zero.",
            polarity="neutral", strength=45, priority=72, data=line_data,
        ))
    else:
        facts.append(_make(
            timeframe, "line_bearish_impulse",
            f"MACD line {line:.3f} below signal {sig:.3f}, both below zero.",
            polarity="bearish", strength=75, priority=85, data=line_data,
        ))

    # ── Histogram state (skip near zero) ────────────────────────
    if abs(hist) >= _HIST_EPSILON:
        rising = is_rising_n(hist_series, n=3, mode="momentum")
        falling = is_falling_n(hist_series, n=3, mode="momentum")
        if hist > 0 and rising:
            facts.append(_make(
                timeframe, "hist_above_rising",
                f"MACD histogram {hist:+.4f}, above zero and rising 3 bars.",
                polarity="bullish", strength=70, priority=82, data={"hist": hist},
            ))
        elif hist > 0 and falling:
            facts.append(_make(
                timeframe, "hist_above_falling",
                f"MACD histogram {hist:+.4f}, above zero but falling 3 bars.",
                polarity="neutral", strength=45, priority=70, data={"hist": hist},
            ))
        elif hist < 0 and rising:
            facts.append(_make(
                timeframe, "hist_below_rising",
                f"MACD histogram {hist:+.4f}, below zero but rising 3 bars.",
                polarity="neutral", strength=50, priority=70, data={"hist": hist},
            ))
        elif hist < 0 and falling:
            facts.append(_make(
                timeframe, "hist_below_falling",
                f"MACD histogram {hist:+.4f}, below zero and falling 3 bars.",
                polarity="bearish", strength=70, priority=82, data={"hist": hist},
            ))

    # ── Recent line/signal cross ────────────────────────────────
    found, bars_ago = recent_cross(line_series, sig_series, timeframe=timeframe)
    if found:
        direction = "up" if line > sig else "down"
        facts.append(_make(
            timeframe, "cross_recent",
            f"MACD line crossed signal {bars_ago} bar(s) ago ({direction}).",
            polarity="bullish" if direction == "up" else "bearish",
            strength=72, priority=84,
            data={"bars_ago": bars_ago, "direction": direction},
        ))

    return facts
```

- [ ] **Step 4: Run — verify pass**

```bash
uv run pytest tests/test_prompt_facts_macd.py -v
```

- [ ] **Step 5: Commit**

```bash
git add backend/services/prompt_facts/macd.py backend/tests/test_prompt_facts_macd.py
git commit -m "feat(ai): MACD fact builder — line/hist quadrants + recent cross"
```

---

## Task 8: Bollinger Bands facts builder

**Files:**
- Create: `backend/services/prompt_facts/bbands.py`
- Create: `backend/tests/test_prompt_facts_bbands.py`

- [ ] **Step 1: Write the failing tests**

```python
from __future__ import annotations

import pytest

from models import IndicatorResult, IndicatorValue
from services.prompt_facts.bbands import build_facts


def _bb(rows: list[tuple[float, float, float]]) -> IndicatorResult:
    """rows: list of (middle, upper, lower)."""
    vals = [
        IndicatorValue(time=1_700_000_000 + i * 86400, value=m, upper=u, lower=l)
        for i, (m, u, l) in enumerate(rows)
    ]
    return IndicatorResult(name="bbands", type="overlay", values=vals,
                           params={"period": 20, "stddev": 2})


class TestBbands:
    def test_outside_upper_is_caution(self):
        ir = _bb([(100, 105, 95)] * 30)
        facts = build_facts(ir, last_close=107.0, candle_closes=[107.0],
                            timeframe="D")
        f = next(x for x in facts if x.id == "D.bbands.outside_upper")
        assert f.polarity == "caution"

    def test_upper_band_walk_bullish(self):
        # 3+ recent closes in upper third (close > middle + (upper-middle)*0.667)
        ir = _bb([(100, 110, 90)] * 30)
        closes = [104, 106, 107, 108, 109]
        facts = build_facts(ir, last_close=109.0, candle_closes=closes, timeframe="D")
        ids = {f.id for f in facts}
        assert "D.bbands.upper_band_walk" in ids

    def test_squeeze_when_band_width_below_25th_percentile(self):
        # 99 wide rows then 1 narrow row → narrow is 1st percentile
        wide = [(100, 120, 80) for _ in range(99)]
        narrow = [(100, 101, 99)]
        ir = _bb(wide + narrow)
        facts = build_facts(ir, last_close=100.0, candle_closes=[100.0], timeframe="D")
        ids = {f.id for f in facts}
        assert "D.bbands.squeeze" in ids


class TestGuards:
    def test_empty_returns_empty(self):
        ir = IndicatorResult(name="bbands", type="overlay", values=[], params={})
        assert build_facts(ir, last_close=100.0, candle_closes=[], timeframe="D") == []
```

- [ ] **Step 2: Run — verify fail**

```bash
uv run pytest tests/test_prompt_facts_bbands.py -v
```

- [ ] **Step 3: Implement**

```python
"""Bollinger Bands facts — squeeze, band walks, outside-band closes, %B."""
from __future__ import annotations

from typing import Optional

from models import IndicatorResult
from services.prompt_facts._common import percentile_rank
from services.prompt_facts.types import PromptFact


def _make(tf: str, condition: str, text: str, polarity: str,
          strength: int, priority: int, data: dict) -> PromptFact:
    return PromptFact(
        id=f"{tf}.bbands.{condition}", timeframe=tf, indicator="bbands",
        text=text, polarity=polarity, strength=strength,
        priority=priority, data=data,
    )


def build_facts(
    ind: Optional[IndicatorResult],
    *,
    last_close: float,
    candle_closes: list[float],
    timeframe: str,
) -> list[PromptFact]:
    if ind is None or not ind.values:
        return []
    last = ind.values[-1]
    if last.value is None or last.upper is None or last.lower is None:
        return []
    upper, lower, mid = last.upper, last.lower, last.value
    width = upper - lower
    if width <= 0:
        return []
    facts: list[PromptFact] = []

    # ── Squeeze (band-width percentile rank) ────────────────────
    widths = [
        iv.upper - iv.lower
        for iv in ind.values
        if iv.upper is not None and iv.lower is not None
    ]
    if len(widths) >= 20:
        rank = percentile_rank(width, widths, lookback=100)
        if rank <= 0.25:
            facts.append(_make(
                timeframe, "squeeze",
                f"Band width at {rank * 100:.0f}th percentile of last 100 bars — squeeze.",
                polarity="neutral", strength=65, priority=82,
                data={"width": width, "percentile": rank},
            ))

    # ── Outside band closes ─────────────────────────────────────
    if last_close > upper:
        facts.append(_make(
            timeframe, "outside_upper",
            f"Last close ${last_close:.2f} above upper band ${upper:.2f}.",
            polarity="caution", strength=55, priority=78,
            data={"upper": upper, "close": last_close},
        ))
    elif last_close < lower:
        facts.append(_make(
            timeframe, "outside_lower",
            f"Last close ${last_close:.2f} below lower band ${lower:.2f}.",
            polarity="caution", strength=55, priority=78,
            data={"lower": lower, "close": last_close},
        ))

    # ── Band walks (3+ recent closes in upper/lower third) ──────
    if candle_closes:
        upper_thresh = mid + (upper - mid) * 0.667
        lower_thresh = mid - (mid - lower) * 0.667
        recent = candle_closes[-5:]
        in_upper = sum(1 for c in recent if c > upper_thresh)
        in_lower = sum(1 for c in recent if c < lower_thresh)
        if in_upper >= 3:
            facts.append(_make(
                timeframe, "upper_band_walk",
                f"{in_upper} of last {len(recent)} closes in upper third of band.",
                polarity="bullish", strength=60, priority=80,
                data={"closes_in_upper": in_upper, "window": len(recent)},
            ))
        elif in_lower >= 3:
            facts.append(_make(
                timeframe, "lower_band_walk",
                f"{in_lower} of last {len(recent)} closes in lower third of band.",
                polarity="bearish", strength=60, priority=80,
                data={"closes_in_lower": in_lower, "window": len(recent)},
            ))

    # ── %B state ────────────────────────────────────────────────
    percent_b = (last_close - lower) / width
    if percent_b < 0:
        state, polarity, condition = "under_0", "caution", "percent_b_under_0"
    elif percent_b <= 0.20:
        state, polarity, condition = "0_20", "bearish", "percent_b_0_20"
    elif percent_b >= 1.0:
        state, polarity, condition = "over_100", "caution", "percent_b_over_100"
    elif percent_b >= 0.80:
        state, polarity, condition = "80_100", "bullish", "percent_b_80_100"
    else:
        state, polarity, condition = None, None, None
    if state is not None:
        facts.append(_make(
            timeframe, condition,
            f"%B = {percent_b:.2f} (state: {state}).",
            polarity=polarity, strength=40, priority=65,
            data={"percent_b": percent_b, "state": state},
        ))

    return facts
```

- [ ] **Step 4: Run — verify pass**

```bash
uv run pytest tests/test_prompt_facts_bbands.py -v
```

- [ ] **Step 5: Commit**

```bash
git add backend/services/prompt_facts/bbands.py backend/tests/test_prompt_facts_bbands.py
git commit -m "feat(ai): Bollinger Bands fact builder — squeeze + walks + %B"
```

---

## Task 9: VWAP facts builder

**Files:**
- Create: `backend/services/prompt_facts/vwap.py`
- Create: `backend/tests/test_prompt_facts_vwap.py`

- [ ] **Step 1: Write the failing tests**

```python
from __future__ import annotations

import pytest

from models import IndicatorResult, IndicatorValue
from services.prompt_facts.vwap import build_facts


def _vwap(series: list[float]) -> IndicatorResult:
    return IndicatorResult(
        name="vwap", type="overlay",
        values=[IndicatorValue(time=1_700_000_000 + i * 86400, value=v) for i, v in enumerate(series)],
        params={},
    )


class TestVwap:
    def test_price_above_vwap(self):
        facts = build_facts(_vwap([99, 99, 100]), last_close=101.0, timeframe="D")
        f = next(x for x in facts if x.id == "D.vwap.price_above")
        assert f.polarity == "bullish"

    def test_price_below_vwap(self):
        facts = build_facts(_vwap([100, 100, 100]), last_close=98.0, timeframe="D")
        ids = {f.id for f in facts}
        assert "D.vwap.price_below" in ids

    def test_reclaim_recent(self):
        # series: vwap stays at 100, price column was below then above — cross detected via candle closes
        vwap_series = [100, 100, 100, 100, 100]
        candle_closes = [98, 98, 99, 100, 101]
        facts = build_facts(_vwap(vwap_series), last_close=101.0, timeframe="D",
                            candle_closes=candle_closes)
        ids = {f.id for f in facts}
        assert "D.vwap.reclaim_recent" in ids

    def test_distance_far_emits_caution(self):
        facts = build_facts(_vwap([100]), last_close=102.0, timeframe="D")
        f = next(x for x in facts if x.id == "D.vwap.distance_far")
        assert f.polarity == "caution"

    def test_empty_returns_empty(self):
        ir = IndicatorResult(name="vwap", type="overlay", values=[], params={})
        assert build_facts(ir, last_close=100.0, timeframe="D") == []
```

- [ ] **Step 2: Run — verify fail**

```bash
uv run pytest tests/test_prompt_facts_vwap.py -v
```

- [ ] **Step 3: Implement**

```python
"""VWAP facts — above/below, reclaim/loss within recency, distance-far caution."""
from __future__ import annotations

from typing import Optional

from models import IndicatorResult
from services.prompt_facts._common import recent_cross
from services.prompt_facts.types import PromptFact


def _make(tf: str, condition: str, text: str, polarity: str,
          strength: int, priority: int, data: dict) -> PromptFact:
    return PromptFact(
        id=f"{tf}.vwap.{condition}", timeframe=tf, indicator="vwap",
        text=text, polarity=polarity, strength=strength,
        priority=priority, data=data,
    )


def build_facts(
    ind: Optional[IndicatorResult],
    *,
    last_close: float,
    timeframe: str,
    candle_closes: Optional[list[float]] = None,
) -> list[PromptFact]:
    if ind is None or not ind.values:
        return []
    vwap = ind.values[-1].value
    if vwap is None or vwap <= 0:
        return []
    facts: list[PromptFact] = []

    if last_close > vwap:
        facts.append(_make(
            timeframe, "price_above",
            f"Price ${last_close:.2f} above VWAP ${vwap:.2f}.",
            polarity="bullish", strength=55, priority=78,
            data={"vwap": vwap, "close": last_close},
        ))
    elif last_close < vwap:
        facts.append(_make(
            timeframe, "price_below",
            f"Price ${last_close:.2f} below VWAP ${vwap:.2f}.",
            polarity="bearish", strength=55, priority=78,
            data={"vwap": vwap, "close": last_close},
        ))

    # Recent reclaim/loss — cross between candle closes and VWAP series.
    if candle_closes:
        vwap_series = [iv.value for iv in ind.values]
        n = min(len(candle_closes), len(vwap_series))
        if n >= 2:
            found, bars_ago = recent_cross(
                candle_closes[-n:], vwap_series[-n:], timeframe=timeframe,
            )
            if found:
                direction = "up" if last_close > vwap else "down"
                cond = "reclaim_recent" if direction == "up" else "loss_recent"
                facts.append(_make(
                    timeframe, cond,
                    f"Price crossed VWAP {bars_ago} bar(s) ago ({direction}).",
                    polarity="bullish" if direction == "up" else "bearish",
                    strength=65, priority=82,
                    data={"bars_ago": bars_ago, "direction": direction},
                ))

    distance_pct = abs(last_close - vwap) / vwap * 100
    if distance_pct > 1.5:
        facts.append(_make(
            timeframe, "distance_far",
            f"Price {distance_pct:.1f}% away from VWAP ${vwap:.2f}.",
            polarity="caution", strength=40, priority=68,
            data={"distance_pct": distance_pct},
        ))

    return facts
```

- [ ] **Step 4: Run — verify pass**

```bash
uv run pytest tests/test_prompt_facts_vwap.py -v
```

- [ ] **Step 5: Commit**

```bash
git add backend/services/prompt_facts/vwap.py backend/tests/test_prompt_facts_vwap.py
git commit -m "feat(ai): VWAP fact builder — above/below + reclaim/loss + distance-far"
```

---

### Task 10: ATR Fact Builder

**Files:**
- Create: `backend/services/prompt_facts/atr.py`
- Create: `backend/tests/test_prompt_facts_atr.py`

ATR emits up to 3 facts when present: `expanding`, `contracting`, `stop_distances` (always emits if ATR available, informational only).

- [ ] **Step 1: Write failing tests**

```python
# backend/tests/test_prompt_facts_atr.py
"""Tests for ATR prompt facts."""
from models import IndicatorValue, IndicatorResult
from services.prompt_facts.atr import build_atr_facts


def _atr(values: list[float]) -> IndicatorResult:
    return IndicatorResult(
        name="atr", type="value",
        values=[IndicatorValue(time=1_700_000_000 + i * 86400, value=v) for i, v in enumerate(values)],
        params={"period": 14},
    )


class TestAtrFacts:
    def test_emits_stop_distances_when_atr_present(self):
        atr = _atr([1.0, 1.0, 1.0, 1.0, 1.0, 1.0])
        facts = build_atr_facts(symbol="AAPL", timeframe="D", atr=atr, last_close=100.0)

        ids = [f.id for f in facts]
        assert "D.atr.stop_distances" in ids

    def test_expanding_when_recent_atr_rising(self):
        atr = _atr([1.0, 1.1, 1.2, 1.3, 1.4, 1.5])
        facts = build_atr_facts(symbol="AAPL", timeframe="D", atr=atr, last_close=100.0)
        ids = [f.id for f in facts]
        assert "D.atr.expanding" in ids
        assert "D.atr.contracting" not in ids

    def test_contracting_when_recent_atr_falling(self):
        atr = _atr([2.0, 1.8, 1.6, 1.4, 1.2, 1.0])
        facts = build_atr_facts(symbol="AAPL", timeframe="D", atr=atr, last_close=100.0)
        ids = [f.id for f in facts]
        assert "D.atr.contracting" in ids
        assert "D.atr.expanding" not in ids

    def test_empty_atr_returns_no_facts(self):
        atr = IndicatorResult(name="atr", type="value", values=[], params={"period": 14})
        facts = build_atr_facts(symbol="AAPL", timeframe="D", atr=atr, last_close=100.0)
        assert facts == []
```

- [ ] **Step 2: Run — verify fail**

```bash
uv run pytest tests/test_prompt_facts_atr.py -v
```

Expected: ImportError.

- [ ] **Step 3: Implement**

```python
# backend/services/prompt_facts/atr.py
"""ATR prompt fact builder."""
from __future__ import annotations

from models import IndicatorResult, PromptFact
from services.prompt_facts._common import is_rising_n, is_falling_n


def _make(tf: str, condition: str, text: str, *, polarity: str, strength: int, priority: int, data: dict) -> PromptFact:
    return PromptFact(
        id=f"{tf}.atr.{condition}",
        timeframe=tf, indicator="atr",
        text=text, polarity=polarity,
        strength=strength, priority=priority, data=data,
    )


def build_atr_facts(*, symbol: str, timeframe: str, atr: IndicatorResult, last_close: float) -> list[PromptFact]:
    if not atr.values:
        return []

    last_atr = atr.values[-1].value
    if last_atr is None or last_atr <= 0:
        return []

    facts: list[PromptFact] = []

    atr_pct = last_atr / last_close * 100 if last_close else 0.0
    facts.append(_make(
        timeframe, "stop_distances",
        f"ATR {last_atr:.2f} ({atr_pct:.1f}% of price). Suggested stops: 1.5x=${last_atr*1.5:.2f}, 2x=${last_atr*2.0:.2f}.",
        polarity="neutral", strength=50, priority=60,
        data={"atr": last_atr, "atr_pct": atr_pct, "stop_1_5x": last_atr * 1.5, "stop_2_0x": last_atr * 2.0},
    ))

    series = [iv.value for iv in atr.values if iv.value is not None]
    if len(series) >= 5:
        if is_rising_n(series, n=5, mode="slow"):
            facts.append(_make(
                timeframe, "expanding",
                "Volatility expanding — ATR rising over last 5 bars.",
                polarity="caution", strength=50, priority=72,
                data={"atr_5_ago": series[-5], "atr_current": last_atr},
            ))
        elif is_falling_n(series, n=5, mode="slow"):
            facts.append(_make(
                timeframe, "contracting",
                "Volatility contracting — ATR falling over last 5 bars.",
                polarity="neutral", strength=45, priority=68,
                data={"atr_5_ago": series[-5], "atr_current": last_atr},
            ))

    return facts
```

- [ ] **Step 4: Run — verify pass**

```bash
uv run pytest tests/test_prompt_facts_atr.py -v
```

- [ ] **Step 5: Commit**

```bash
git add backend/services/prompt_facts/atr.py backend/tests/test_prompt_facts_atr.py
git commit -m "feat(ai): ATR fact builder — stop distances + expanding/contracting"
```

---

### Task 11: Stochastic Fact Builder

**Files:**
- Create: `backend/services/prompt_facts/stoch.py`
- Create: `backend/tests/test_prompt_facts_stoch.py`

Per spec §7.6 — Stochastic IDs: `k_above_d`, `k_below_d`, `cross_recent`, `overbought_exit` (caution), `oversold_exit` (bullish).

- [ ] **Step 1: Write failing tests**

```python
# backend/tests/test_prompt_facts_stoch.py
"""Tests for Stochastic prompt facts."""
from models import IndicatorValue, IndicatorResult
from services.prompt_facts.stoch import build_stoch_facts


def _stoch(pairs: list[tuple[float, float]]) -> IndicatorResult:
    """pairs of (k, d)."""
    return IndicatorResult(
        name="stoch", type="oscillator",
        values=[
            IndicatorValue(time=1_700_000_000 + i * 86400, value=k, signal=d)
            for i, (k, d) in enumerate(pairs)
        ],
        params={"k_period": 14, "d_period": 3, "smooth_k": 3},
    )


class TestStochFacts:
    def test_k_above_d(self):
        stoch = _stoch([(40, 38), (45, 40), (50, 42), (55, 45)])
        facts = build_stoch_facts(symbol="AAPL", timeframe="D", stoch=stoch)
        ids = [f.id for f in facts]
        assert "D.stoch.k_above_d" in ids

    def test_k_below_d(self):
        stoch = _stoch([(60, 62), (55, 60), (50, 58), (45, 55)])
        facts = build_stoch_facts(symbol="AAPL", timeframe="D", stoch=stoch)
        ids = [f.id for f in facts]
        assert "D.stoch.k_below_d" in ids

    def test_recent_cross_emits_signal(self):
        # %K crossed above %D between bars 2 and 3
        stoch = _stoch([(40, 50), (42, 50), (52, 50), (60, 52)])
        facts = build_stoch_facts(symbol="AAPL", timeframe="D", stoch=stoch)
        ids = [f.id for f in facts]
        assert "D.stoch.cross_recent" in ids

    def test_overbought_exit_caution(self):
        # was above 80, now back below
        stoch = _stoch([(78, 75), (82, 78), (85, 82), (78, 82)])
        facts = build_stoch_facts(symbol="AAPL", timeframe="D", stoch=stoch)
        ids = [f.id for f in facts]
        # k_above_d should NOT be present (k=78 < d=82) but cross/exit may be
        assert any(f.id == "D.stoch.overbought_exit" for f in facts)
        ex = next(f for f in facts if f.id == "D.stoch.overbought_exit")
        assert ex.polarity == "caution"

    def test_oversold_exit_bullish(self):
        # was below 20, now back above
        stoch = _stoch([(22, 25), (18, 22), (15, 18), (22, 18)])
        facts = build_stoch_facts(symbol="AAPL", timeframe="D", stoch=stoch)
        ex = next((f for f in facts if f.id == "D.stoch.oversold_exit"), None)
        assert ex is not None
        assert ex.polarity == "bullish"
```

- [ ] **Step 2: Run — verify fail**

```bash
uv run pytest tests/test_prompt_facts_stoch.py -v
```

- [ ] **Step 3: Implement**

```python
# backend/services/prompt_facts/stoch.py
"""Stochastic prompt fact builder."""
from __future__ import annotations

from models import IndicatorResult, PromptFact
from services.prompt_facts._common import recent_cross


def _make(tf: str, condition: str, text: str, *, polarity: str, strength: int, priority: int, data: dict) -> PromptFact:
    return PromptFact(
        id=f"{tf}.stoch.{condition}",
        timeframe=tf, indicator="stoch",
        text=text, polarity=polarity,
        strength=strength, priority=priority, data=data,
    )


def build_stoch_facts(*, symbol: str, timeframe: str, stoch: IndicatorResult) -> list[PromptFact]:
    if not stoch.values:
        return []

    last = stoch.values[-1]
    if last.value is None or last.signal is None:
        return []

    facts: list[PromptFact] = []
    k = last.value
    d = last.signal

    if k > d:
        facts.append(_make(
            timeframe, "k_above_d",
            f"Stochastic %K {k:.1f} above %D {d:.1f}.",
            polarity="bullish", strength=55, priority=72,
            data={"k": k, "d": d},
        ))
    elif k < d:
        facts.append(_make(
            timeframe, "k_below_d",
            f"Stochastic %K {k:.1f} below %D {d:.1f}.",
            polarity="bearish", strength=55, priority=72,
            data={"k": k, "d": d},
        ))

    k_series = [iv.value for iv in stoch.values if iv.value is not None]
    d_series = [iv.signal for iv in stoch.values if iv.signal is not None]
    n = min(len(k_series), len(d_series))
    if n >= 2:
        found, bars_ago = recent_cross(k_series[-n:], d_series[-n:], timeframe=timeframe)
        if found:
            facts.append(_make(
                timeframe, "cross_recent",
                f"Stochastic %K crossed %D {bars_ago} bar(s) ago.",
                polarity="bullish" if k > d else "bearish",
                strength=70, priority=85,
                data={"bars_ago": bars_ago},
            ))

    # OB/OS exit: previous was beyond threshold, current is back inside.
    if len(k_series) >= 2:
        prev_k = k_series[-2]
        if prev_k >= 80 and k < 80:
            facts.append(_make(
                timeframe, "overbought_exit",
                f"Stochastic exited overbought (%K {prev_k:.1f} → {k:.1f}).",
                polarity="caution", strength=65, priority=84,
                data={"prev_k": prev_k, "k": k},
            ))
        elif prev_k <= 20 and k > 20:
            facts.append(_make(
                timeframe, "oversold_exit",
                f"Stochastic exited oversold (%K {prev_k:.1f} → {k:.1f}).",
                polarity="bullish", strength=65, priority=84,
                data={"prev_k": prev_k, "k": k},
            ))

    return facts
```

- [ ] **Step 4: Run — verify pass**

```bash
uv run pytest tests/test_prompt_facts_stoch.py -v
```

- [ ] **Step 5: Commit**

```bash
git add backend/services/prompt_facts/stoch.py backend/tests/test_prompt_facts_stoch.py
git commit -m "feat(ai): Stochastic fact builder — K/D state + cross + OB/OS exit"
```

---

### Task 12: OBV Fact Builder

**Files:**
- Create: `backend/services/prompt_facts/obv.py`
- Create: `backend/tests/test_prompt_facts_obv.py`

Per spec §7.10 — OBV IDs: `rising`, `falling`, `divergence_bullish`, `divergence_bearish`.

- [ ] **Step 1: Write failing tests**

```python
# backend/tests/test_prompt_facts_obv.py
"""Tests for OBV prompt facts."""
from models import IndicatorValue, IndicatorResult, CandleData
from services.prompt_facts.obv import build_obv_facts


def _obv(values: list[float]) -> IndicatorResult:
    return IndicatorResult(
        name="obv", type="line",
        values=[IndicatorValue(time=1_700_000_000 + i * 86400, value=v) for i, v in enumerate(values)],
        params={},
    )


def _candles(closes: list[float]) -> list[CandleData]:
    return [
        CandleData(time=1_700_000_000 + i * 86400, open=c - 0.5, high=c + 1.0, low=c - 1.0, close=c, volume=1_000_000)
        for i, c in enumerate(closes)
    ]


class TestObvFacts:
    def test_rising_obv(self):
        candles = _candles([100, 101, 102, 103, 104, 105])
        obv = _obv([1000, 1100, 1200, 1300, 1400, 1500])
        facts = build_obv_facts(symbol="AAPL", timeframe="D", obv=obv, candles=candles)
        ids = [f.id for f in facts]
        assert "D.obv.rising" in ids

    def test_falling_obv(self):
        candles = _candles([105, 104, 103, 102, 101, 100])
        obv = _obv([1500, 1400, 1300, 1200, 1100, 1000])
        facts = build_obv_facts(symbol="AAPL", timeframe="D", obv=obv, candles=candles)
        ids = [f.id for f in facts]
        assert "D.obv.falling" in ids

    def test_bearish_divergence_price_up_obv_down(self):
        candles = _candles([100, 101, 102, 103, 104, 105])  # price up
        obv = _obv([1500, 1450, 1400, 1350, 1300, 1250])    # OBV down
        facts = build_obv_facts(symbol="AAPL", timeframe="D", obv=obv, candles=candles)
        ids = [f.id for f in facts]
        assert "D.obv.divergence_bearish" in ids

    def test_bullish_divergence_price_down_obv_up(self):
        candles = _candles([105, 104, 103, 102, 101, 100])  # price down
        obv = _obv([1000, 1100, 1200, 1300, 1400, 1500])    # OBV up
        facts = build_obv_facts(symbol="AAPL", timeframe="D", obv=obv, candles=candles)
        ids = [f.id for f in facts]
        assert "D.obv.divergence_bullish" in ids
```

- [ ] **Step 2: Run — verify fail**

```bash
uv run pytest tests/test_prompt_facts_obv.py -v
```

- [ ] **Step 3: Implement**

```python
# backend/services/prompt_facts/obv.py
"""OBV prompt fact builder."""
from __future__ import annotations

from models import CandleData, IndicatorResult, PromptFact


def _make(tf: str, condition: str, text: str, *, polarity: str, strength: int, priority: int, data: dict) -> PromptFact:
    return PromptFact(
        id=f"{tf}.obv.{condition}",
        timeframe=tf, indicator="obv",
        text=text, polarity=polarity,
        strength=strength, priority=priority, data=data,
    )


def _net_change(series: list[float], lookback: int) -> float:
    if len(series) < lookback + 1:
        return 0.0
    return series[-1] - series[-lookback - 1]


def build_obv_facts(
    *, symbol: str, timeframe: str, obv: IndicatorResult, candles: list[CandleData]
) -> list[PromptFact]:
    series = [iv.value for iv in obv.values if iv.value is not None]
    if len(series) < 6:
        return []

    facts: list[PromptFact] = []
    lookback = 5
    obv_change = _net_change(series, lookback)

    # Trend
    if obv_change > 0:
        facts.append(_make(
            timeframe, "rising",
            f"OBV rising over last {lookback} bars (accumulation).",
            polarity="bullish", strength=55, priority=70,
            data={"lookback": lookback, "obv_change": obv_change},
        ))
    elif obv_change < 0:
        facts.append(_make(
            timeframe, "falling",
            f"OBV falling over last {lookback} bars (distribution).",
            polarity="bearish", strength=55, priority=70,
            data={"lookback": lookback, "obv_change": obv_change},
        ))

    # Divergence
    closes = [c.close for c in candles]
    if len(closes) >= lookback + 1:
        price_change = closes[-1] - closes[-lookback - 1]
        if price_change > 0 and obv_change < 0:
            facts.append(_make(
                timeframe, "divergence_bearish",
                f"Bearish divergence — price up but OBV down over last {lookback} bars.",
                polarity="caution", strength=75, priority=88,
                data={"price_change": price_change, "obv_change": obv_change},
            ))
        elif price_change < 0 and obv_change > 0:
            facts.append(_make(
                timeframe, "divergence_bullish",
                f"Bullish divergence — price down but OBV up over last {lookback} bars.",
                polarity="bullish", strength=75, priority=88,
                data={"price_change": price_change, "obv_change": obv_change},
            ))

    return facts
```

- [ ] **Step 4: Run — verify pass**

```bash
uv run pytest tests/test_prompt_facts_obv.py -v
```

- [ ] **Step 5: Commit**

```bash
git add backend/services/prompt_facts/obv.py backend/tests/test_prompt_facts_obv.py
git commit -m "feat(ai): OBV fact builder — rising/falling + price/OBV divergence"
```

---

### Task 13: ADX Fact Builder

**Files:**
- Create: `backend/services/prompt_facts/adx.py`
- Create: `backend/tests/test_prompt_facts_adx.py`

Per spec §7.9 — ADX IDs: `strong_rising` (neutral — strength only, NOT direction), `strong_falling` (caution), `weak` (neutral). Spec rule: never label ADX bullish/bearish. v2 adds +DI/-DI.

- [ ] **Step 1: Write failing tests**

```python
# backend/tests/test_prompt_facts_adx.py
"""Tests for ADX prompt facts."""
from models import IndicatorValue, IndicatorResult
from services.prompt_facts.adx import build_adx_facts


def _adx(values: list[float]) -> IndicatorResult:
    return IndicatorResult(
        name="adx", type="value",
        values=[IndicatorValue(time=1_700_000_000 + i * 86400, value=v) for i, v in enumerate(values)],
        params={"period": 14},
    )


class TestAdxFacts:
    def test_strong_rising_neutral_polarity(self):
        # ADX above 25 and rising
        adx = _adx([22, 24, 26, 28, 30, 32])
        facts = build_adx_facts(symbol="AAPL", timeframe="D", adx=adx)
        f = next((x for x in facts if x.id == "D.adx.strong_rising"), None)
        assert f is not None
        assert f.polarity == "neutral"  # ADX measures strength, not direction

    def test_strong_falling_caution_polarity(self):
        # ADX above 25 but falling — trend weakening
        adx = _adx([35, 33, 31, 29, 27, 26])
        facts = build_adx_facts(symbol="AAPL", timeframe="D", adx=adx)
        f = next((x for x in facts if x.id == "D.adx.strong_falling"), None)
        assert f is not None
        assert f.polarity == "caution"

    def test_weak_when_below_20(self):
        adx = _adx([15, 14, 13, 14, 15, 16])
        facts = build_adx_facts(symbol="AAPL", timeframe="D", adx=adx)
        ids = [f.id for f in facts]
        assert "D.adx.weak" in ids
```

- [ ] **Step 2: Run — verify fail**

```bash
uv run pytest tests/test_prompt_facts_adx.py -v
```

- [ ] **Step 3: Implement**

```python
# backend/services/prompt_facts/adx.py
"""ADX prompt fact builder.

ADX measures trend STRENGTH only, never direction.
Never emits bullish/bearish polarity — only neutral or caution.
v2 adds +DI/-DI for direction.
"""
from __future__ import annotations

from models import IndicatorResult, PromptFact
from services.prompt_facts._common import is_rising_n, is_falling_n


def _make(tf: str, condition: str, text: str, *, polarity: str, strength: int, priority: int, data: dict) -> PromptFact:
    return PromptFact(
        id=f"{tf}.adx.{condition}",
        timeframe=tf, indicator="adx",
        text=text, polarity=polarity,
        strength=strength, priority=priority, data=data,
    )


def build_adx_facts(*, symbol: str, timeframe: str, adx: IndicatorResult) -> list[PromptFact]:
    series = [iv.value for iv in adx.values if iv.value is not None]
    if not series:
        return []

    last = series[-1]
    facts: list[PromptFact] = []

    if last >= 25 and len(series) >= 5:
        if is_rising_n(series, n=5, mode="slow"):
            facts.append(_make(
                timeframe, "strong_rising",
                f"ADX {last:.1f} above 25 and rising — strong trend (direction unspecified).",
                polarity="neutral", strength=60, priority=72,
                data={"adx": last},
            ))
        elif is_falling_n(series, n=5, mode="slow"):
            facts.append(_make(
                timeframe, "strong_falling",
                f"ADX {last:.1f} above 25 but falling — trend weakening.",
                polarity="caution", strength=55, priority=70,
                data={"adx": last},
            ))

    if last < 20:
        facts.append(_make(
            timeframe, "weak",
            f"ADX {last:.1f} below 20 — weak/no trend.",
            polarity="neutral", strength=45, priority=62,
            data={"adx": last},
        ))

    return facts
```

- [ ] **Step 4: Run — verify pass**

```bash
uv run pytest tests/test_prompt_facts_adx.py -v
```

- [ ] **Step 5: Commit**

```bash
git add backend/services/prompt_facts/adx.py backend/tests/test_prompt_facts_adx.py
git commit -m "feat(ai): ADX fact builder — strength only, never bullish/bearish"
```

---

### Task 14: Volume Fact Builder

**Files:**
- Create: `backend/services/prompt_facts/volume.py`
- Create: `backend/tests/test_prompt_facts_volume.py`

Per spec §7.11 — Volume IDs are DECOUPLED: `surge_up`, `surge_down`, `dry_up`. The candle direction is determined from the underlying close vs open. Volume MA computed from history.

- [ ] **Step 1: Write failing tests**

```python
# backend/tests/test_prompt_facts_volume.py
"""Tests for Volume prompt facts."""
from models import CandleData
from services.prompt_facts.volume import build_volume_facts


def _candle(close: float, open_: float, vol: float, time: int = 1_700_000_000) -> CandleData:
    return CandleData(
        time=time, open=open_, high=max(open_, close) + 1,
        low=min(open_, close) - 1, close=close, volume=vol,
    )


def _history(closes_opens_vols: list[tuple[float, float, float]]) -> list[CandleData]:
    return [_candle(c, o, v, time=1_700_000_000 + i * 86400) for i, (c, o, v) in enumerate(closes_opens_vols)]


class TestVolumeFacts:
    def test_surge_up_on_up_candle_with_high_volume(self):
        # 20 bars history at vol=1M, last candle is up + vol=2M
        hist = [(100.0 + i * 0.1, 100.0 + i * 0.1 - 0.5, 1_000_000.0) for i in range(20)]
        hist.append((105.0, 100.0, 2_000_000.0))  # up + 2x volume
        facts = build_volume_facts(symbol="AAPL", timeframe="D", candles=_history(hist))
        ids = [f.id for f in facts]
        assert "D.volume.surge_up" in ids

    def test_surge_down_on_down_candle_with_high_volume(self):
        hist = [(100.0, 99.5, 1_000_000.0) for _ in range(20)]
        hist.append((95.0, 100.0, 2_000_000.0))  # down + 2x volume
        facts = build_volume_facts(symbol="AAPL", timeframe="D", candles=_history(hist))
        ids = [f.id for f in facts]
        assert "D.volume.surge_down" in ids

    def test_dry_up_when_volume_well_below_average(self):
        hist = [(100.0, 99.5, 1_000_000.0) for _ in range(20)]
        hist.append((100.5, 100.0, 300_000.0))  # 0.3x avg
        facts = build_volume_facts(symbol="AAPL", timeframe="D", candles=_history(hist))
        ids = [f.id for f in facts]
        assert "D.volume.dry_up" in ids

    def test_no_facts_when_insufficient_history(self):
        hist = [(100.0, 99.5, 1_000_000.0) for _ in range(5)]
        facts = build_volume_facts(symbol="AAPL", timeframe="D", candles=_history(hist))
        assert facts == []
```

- [ ] **Step 2: Run — verify fail**

```bash
uv run pytest tests/test_prompt_facts_volume.py -v
```

- [ ] **Step 3: Implement**

```python
# backend/services/prompt_facts/volume.py
"""Volume prompt fact builder.

Decoupled IDs:
  - surge_up    — up candle on >=1.5x avg volume
  - surge_down  — down candle on >=1.5x avg volume
  - dry_up      — any candle on <=0.5x avg volume
"""
from __future__ import annotations

from models import CandleData, PromptFact

SURGE_MULT = 1.5
DRY_MULT = 0.5
MA_WINDOW = 20


def _make(tf: str, condition: str, text: str, *, polarity: str, strength: int, priority: int, data: dict) -> PromptFact:
    return PromptFact(
        id=f"{tf}.volume.{condition}",
        timeframe=tf, indicator="volume",
        text=text, polarity=polarity,
        strength=strength, priority=priority, data=data,
    )


def build_volume_facts(*, symbol: str, timeframe: str, candles: list[CandleData]) -> list[PromptFact]:
    if len(candles) < MA_WINDOW + 1:
        return []

    last = candles[-1]
    prior_vols = [c.volume for c in candles[-MA_WINDOW - 1 : -1]]
    avg = sum(prior_vols) / len(prior_vols)
    if avg <= 0:
        return []

    ratio = last.volume / avg
    facts: list[PromptFact] = []

    if ratio >= SURGE_MULT:
        is_up = last.close > last.open
        is_down = last.close < last.open
        if is_up:
            facts.append(_make(
                timeframe, "surge_up",
                f"Up candle on {ratio:.1f}x average volume.",
                polarity="bullish", strength=60, priority=80,
                data={"ratio": ratio, "volume": last.volume, "avg": avg},
            ))
        elif is_down:
            facts.append(_make(
                timeframe, "surge_down",
                f"Down candle on {ratio:.1f}x average volume.",
                polarity="bearish", strength=60, priority=80,
                data={"ratio": ratio, "volume": last.volume, "avg": avg},
            ))

    if ratio <= DRY_MULT:
        facts.append(_make(
            timeframe, "dry_up",
            f"Volume {ratio:.2f}x average — low conviction.",
            polarity="caution", strength=45, priority=65,
            data={"ratio": ratio, "volume": last.volume, "avg": avg},
        ))

    return facts
```

- [ ] **Step 4: Run — verify pass**

```bash
uv run pytest tests/test_prompt_facts_volume.py -v
```

- [ ] **Step 5: Commit**

```bash
git add backend/services/prompt_facts/volume.py backend/tests/test_prompt_facts_volume.py
git commit -m "feat(ai): Volume fact builder — surge_up/surge_down/dry_up"
```

---

### Task 15: Dispatcher — `build_prompt_facts`

**Files:**
- Create: `backend/services/prompt_facts/__init__.py`
- Create: `backend/tests/test_prompt_facts_dispatcher.py`

Per spec §6 — Dispatcher routes per-indicator slice and returns one `PromptContextBlock` per timeframe. Sort within each block: `(priority desc, tf_weight desc, strength desc, recency desc)`. Priority gets +20 boost if the indicator is in the request's `indicator_priority` list.

**TF weights (spec §6):** `M=5, W=4, D=3, "4H"=2, "1H"=1`.

- [ ] **Step 1: Write failing tests**

```python
# backend/tests/test_prompt_facts_dispatcher.py
"""Tests for build_prompt_facts dispatcher."""
from models import CandleData, IndicatorValue, IndicatorResult
from services.prompt_facts import build_prompt_facts


def _candles(closes: list[float]) -> list[CandleData]:
    return [
        CandleData(time=1_700_000_000 + i * 86400, open=c - 0.5, high=c + 1, low=c - 1, close=c, volume=1_000_000)
        for i, c in enumerate(closes)
    ]


def _ema(period: int, values: list[float]) -> IndicatorResult:
    return IndicatorResult(
        name="ema", type="overlay",
        values=[IndicatorValue(time=1_700_000_000 + i * 86400, value=v) for i, v in enumerate(values)],
        params={"period": period},
    )


class TestDispatcher:
    def test_returns_one_block_per_timeframe(self):
        candles = _candles([100, 101, 102, 103, 104, 105, 106, 107, 108, 109])
        tf_data = {
            "D": {"candles": candles, "indicators": [_ema(9, [99.0] * 10)]},
            "W": {"candles": candles, "indicators": [_ema(9, [99.0] * 10)]},
        }
        blocks = build_prompt_facts(symbol="AAPL", timeframe_data=tf_data, indicator_priority=[])
        assert len(blocks) == 2
        tfs = {b.timeframe for b in blocks}
        assert tfs == {"D", "W"}

    def test_priority_boost_for_listed_indicators(self):
        candles = _candles([100.0] * 25)
        tf_data = {
            "D": {
                "candles": candles,
                "indicators": [_ema(9, [99.0] * 25)],
            }
        }
        blocks = build_prompt_facts(symbol="AAPL", timeframe_data=tf_data, indicator_priority=["ema"])
        ema_facts = [f for b in blocks for f in b.facts if f.indicator == "ema"]
        assert ema_facts
        # All ema facts get +20 priority boost
        assert all(f.priority >= 70 for f in ema_facts)

    def test_facts_sorted_by_priority_desc(self):
        candles = _candles([100.0] * 25)
        tf_data = {
            "D": {
                "candles": candles,
                "indicators": [_ema(9, [99.0] * 25)],
            }
        }
        blocks = build_prompt_facts(symbol="AAPL", timeframe_data=tf_data, indicator_priority=[])
        for block in blocks:
            priorities = [f.priority for f in block.facts]
            assert priorities == sorted(priorities, reverse=True)

    def test_empty_data_returns_empty(self):
        blocks = build_prompt_facts(symbol="AAPL", timeframe_data={}, indicator_priority=[])
        assert blocks == []
```

- [ ] **Step 2: Run — verify fail**

```bash
uv run pytest tests/test_prompt_facts_dispatcher.py -v
```

- [ ] **Step 3: Implement**

```python
# backend/services/prompt_facts/__init__.py
"""Prompt facts dispatcher.

Routes per-timeframe indicator data to family builders and returns
a list of PromptContextBlock — one per timeframe — with facts sorted by:
  (priority desc, tf_weight desc, strength desc, recency desc).

Per-indicator priority boost: +20 for indicators in indicator_priority.
"""
from __future__ import annotations

from typing import Any

from models import CandleData, FibonacciResult, FibonacciSnapshot, IndicatorResult, PromptContextBlock, PromptFact
from services.prompt_facts.adx import build_adx_facts
from services.prompt_facts.atr import build_atr_facts
from services.prompt_facts.bbands import build_bbands_facts
from services.prompt_facts.ema import build_ema_facts
from services.prompt_facts.fibonacci import build_fibonacci_facts
from services.prompt_facts.macd import build_macd_facts
from services.prompt_facts.obv import build_obv_facts
from services.prompt_facts.rsi import build_rsi_facts
from services.prompt_facts.stoch import build_stoch_facts
from services.prompt_facts.volume import build_volume_facts
from services.prompt_facts.vwap import build_vwap_facts

_TF_WEIGHTS = {"M": 5, "W": 4, "D": 3, "4H": 2, "1H": 1}
_PRIORITY_BOOST = 20


def _tf_weight(tf: str) -> int:
    return _TF_WEIGHTS.get(tf, 1)


def _group_indicators(indicators: list[IndicatorResult]) -> dict[str, list[IndicatorResult]]:
    by_name: dict[str, list[IndicatorResult]] = {}
    for ind in indicators:
        by_name.setdefault(ind.name, []).append(ind)
    return by_name


def _build_for_tf(
    *,
    symbol: str,
    timeframe: str,
    candles: list[CandleData],
    indicators: list[IndicatorResult],
    fibs: list[FibonacciResult | FibonacciSnapshot],
    raw_fibonacci: Any,
    indicator_priority: list[str],
) -> list[PromptFact]:
    facts: list[PromptFact] = []
    last_close = candles[-1].close if candles else 0.0
    by_name = _group_indicators(indicators)

    # Fibonacci — primary fib or auto-result
    fib_source: FibonacciResult | FibonacciSnapshot | None = None
    if fibs:
        primaries = [f for f in fibs if getattr(f, "is_primary", False)]
        fib_source = primaries[0] if primaries else fibs[0]
    elif raw_fibonacci is not None:
        fib_source = raw_fibonacci

    if fib_source is not None:
        facts.extend(build_fibonacci_facts(
            symbol=symbol, timeframe=timeframe, fib=fib_source, last_close=last_close,
        ))

    if "ema" in by_name:
        facts.extend(build_ema_facts(
            symbol=symbol, timeframe=timeframe, emas=by_name["ema"], last_close=last_close,
        ))

    if "rsi" in by_name and by_name["rsi"]:
        facts.extend(build_rsi_facts(
            symbol=symbol, timeframe=timeframe, rsi=by_name["rsi"][0],
        ))

    if "macd" in by_name and by_name["macd"]:
        facts.extend(build_macd_facts(
            symbol=symbol, timeframe=timeframe, macd=by_name["macd"][0],
        ))

    if "bbands" in by_name and by_name["bbands"]:
        facts.extend(build_bbands_facts(
            symbol=symbol, timeframe=timeframe, bbands=by_name["bbands"][0], last_close=last_close,
        ))

    if "vwap" in by_name and by_name["vwap"]:
        facts.extend(build_vwap_facts(
            symbol=symbol, timeframe=timeframe, vwap=by_name["vwap"][0], candles=candles,
        ))

    if "atr" in by_name and by_name["atr"]:
        facts.extend(build_atr_facts(
            symbol=symbol, timeframe=timeframe, atr=by_name["atr"][0], last_close=last_close,
        ))

    if "stoch" in by_name and by_name["stoch"]:
        facts.extend(build_stoch_facts(
            symbol=symbol, timeframe=timeframe, stoch=by_name["stoch"][0],
        ))

    if "obv" in by_name and by_name["obv"]:
        facts.extend(build_obv_facts(
            symbol=symbol, timeframe=timeframe, obv=by_name["obv"][0], candles=candles,
        ))

    if "adx" in by_name and by_name["adx"]:
        facts.extend(build_adx_facts(
            symbol=symbol, timeframe=timeframe, adx=by_name["adx"][0],
        ))

    facts.extend(build_volume_facts(symbol=symbol, timeframe=timeframe, candles=candles))

    # Priority boost
    boosted = set(indicator_priority or [])
    if boosted:
        for f in facts:
            if f.indicator in boosted:
                f.priority += _PRIORITY_BOOST

    return facts


def build_prompt_facts(
    *,
    symbol: str,
    timeframe_data: dict[str, dict[str, Any]],
    indicator_priority: list[str],
) -> list[PromptContextBlock]:
    """Build PromptContextBlocks for each timeframe.

    `timeframe_data[tf]` shape (from routers.ai._fetch_timeframe_data):
      {
        "candles": list[CandleData],
        "indicators": list[IndicatorResult],
        "fibs": list[FibonacciSnapshot],   # optional, may be []
        "fibonacci": FibonacciResult | None,  # auto-computed (if no snapshot)
      }
    """
    blocks: list[PromptContextBlock] = []
    for tf, data in timeframe_data.items():
        candles = data.get("candles") or []
        indicators = data.get("indicators") or []
        fibs = data.get("fibs") or []
        raw_fib = data.get("fibonacci")

        facts = _build_for_tf(
            symbol=symbol,
            timeframe=tf,
            candles=candles,
            indicators=indicators,
            fibs=fibs,
            raw_fibonacci=raw_fib,
            indicator_priority=indicator_priority,
        )
        if not facts and not candles:
            continue

        weight = _tf_weight(tf)
        # Sort: priority desc, tf_weight desc (constant within block), strength desc, recency desc
        n = len(facts)
        facts_sorted = sorted(
            list(enumerate(facts)),
            key=lambda pair: (-pair[1].priority, -weight, -pair[1].strength, -(n - pair[0])),
        )
        ordered = [pair[1] for pair in facts_sorted]
        blocks.append(PromptContextBlock(
            timeframe=tf,
            tf_weight=weight,
            facts=ordered,
            last_close=candles[-1].close if candles else 0.0,
        ))

    # Highest TF weight first across blocks.
    blocks.sort(key=lambda b: -b.tf_weight)
    return blocks
```

- [ ] **Step 4: Run — verify pass**

```bash
uv run pytest tests/test_prompt_facts_dispatcher.py -v
```

- [ ] **Step 5: Commit**

```bash
git add backend/services/prompt_facts/__init__.py backend/tests/test_prompt_facts_dispatcher.py
git commit -m "feat(ai): prompt facts dispatcher with priority boost + canonical sort"
```

---

### Task 16: Renderer — Blocks → Prompt Text

**Files:**
- Create: `backend/services/prompt_facts/render.py`
- Create: `backend/tests/test_prompt_facts_render.py`

Per spec §4 — renderer produces two sections per block: `Verified Facts:` (non-caution) and `Cautions:` (polarity=caution). Byte-stable labels, canonical TF order (M, W, D, 4H, 1H).

- [ ] **Step 1: Write failing tests**

```python
# backend/tests/test_prompt_facts_render.py
"""Tests for prompt facts renderer."""
from models import PromptContextBlock, PromptFact
from services.prompt_facts.render import render_prompt_facts


def _fact(id_: str, text: str, polarity: str = "bullish") -> PromptFact:
    return PromptFact(
        id=id_, timeframe=id_.split(".")[0],
        indicator=id_.split(".")[1], text=text,
        polarity=polarity, strength=60, priority=80, data={},
    )


class TestRenderer:
    def test_renders_verified_facts_section(self):
        block = PromptContextBlock(
            timeframe="D", tf_weight=3,
            facts=[
                _fact("D.ema.stack_bullish", "EMA stack bullish."),
                _fact("D.rsi.above_50_rising", "RSI above 50 and rising."),
            ],
            last_close=100.0,
        )
        out = render_prompt_facts([block])
        assert "Verified Facts" in out
        assert "EMA stack bullish." in out
        assert "RSI above 50 and rising." in out

    def test_renders_cautions_section_separately(self):
        block = PromptContextBlock(
            timeframe="D", tf_weight=3,
            facts=[
                _fact("D.ema.stack_bullish", "EMA stack bullish.", "bullish"),
                _fact("D.rsi.overbought", "RSI overbought.", "caution"),
            ],
            last_close=100.0,
        )
        out = render_prompt_facts([block])
        assert "Cautions" in out
        # Caution text must appear under Cautions section
        cautions_idx = out.index("Cautions")
        assert "RSI overbought." in out[cautions_idx:]

    def test_orders_blocks_highest_tf_first(self):
        b_d = PromptContextBlock(timeframe="D", tf_weight=3, facts=[_fact("D.ema.stack_bullish", "D fact.")], last_close=100.0)
        b_w = PromptContextBlock(timeframe="W", tf_weight=4, facts=[_fact("W.ema.stack_bullish", "W fact.")], last_close=100.0)
        b_m = PromptContextBlock(timeframe="M", tf_weight=5, facts=[_fact("M.ema.stack_bullish", "M fact.")], last_close=100.0)
        out = render_prompt_facts([b_d, b_w, b_m])  # any order in
        m_idx = out.index("M fact.")
        w_idx = out.index("W fact.")
        d_idx = out.index("D fact.")
        assert m_idx < w_idx < d_idx

    def test_includes_fact_ids_inline(self):
        block = PromptContextBlock(
            timeframe="D", tf_weight=3,
            facts=[_fact("D.ema.stack_bullish", "EMA stack bullish.")],
            last_close=100.0,
        )
        out = render_prompt_facts([block])
        assert "D.ema.stack_bullish" in out

    def test_empty_blocks_renders_nothing(self):
        assert render_prompt_facts([]) == ""
```

- [ ] **Step 2: Run — verify fail**

```bash
uv run pytest tests/test_prompt_facts_render.py -v
```

- [ ] **Step 3: Implement**

```python
# backend/services/prompt_facts/render.py
"""Renderer: PromptContextBlock list -> deterministic prompt text."""
from __future__ import annotations

from models import PromptContextBlock, PromptFact

_TF_ORDER = ["M", "W", "D", "4H", "1H"]


def _tf_sort_key(tf: str) -> int:
    try:
        return _TF_ORDER.index(tf)
    except ValueError:
        return len(_TF_ORDER)


def _fact_line(f: PromptFact) -> str:
    # "[D.ema.stack_bullish] EMA stack bullish."
    return f"  [{f.id}] {f.text}"


def render_prompt_facts(blocks: list[PromptContextBlock]) -> str:
    if not blocks:
        return ""

    ordered = sorted(blocks, key=lambda b: _tf_sort_key(b.timeframe))
    sections: list[str] = []

    for block in ordered:
        verified = [f for f in block.facts if f.polarity != "caution"]
        cautions = [f for f in block.facts if f.polarity == "caution"]

        sections.append(f"=== {block.timeframe} (close=${block.last_close:.2f}) ===")
        if verified:
            sections.append("Verified Facts:")
            sections.extend(_fact_line(f) for f in verified)
        if cautions:
            sections.append("Cautions:")
            sections.extend(_fact_line(f) for f in cautions)
        sections.append("")  # blank line between blocks

    return "\n".join(sections).rstrip()
```

- [ ] **Step 4: Run — verify pass**

```bash
uv run pytest tests/test_prompt_facts_render.py -v
```

- [ ] **Step 5: Commit**

```bash
git add backend/services/prompt_facts/render.py backend/tests/test_prompt_facts_render.py
git commit -m "feat(ai): renderer — facts to deterministic prompt text"
```

---

### Task 17: Truncate by Value

**Files:**
- Create: `backend/services/prompt_facts/truncate.py`
- Create: `backend/tests/test_prompt_facts_truncate.py`

Per spec §9 — operates on `list[PromptContextBlock]`. Drop order:
1. Drop `chart_context` (last-N candles) — handled outside fact list.
2. Drop neutral facts by score (priority × tf_weight × strength), lowest first.
3. Drop entire lowest-tf blocks.

Protect: highest-TF non-neutral facts + all caution facts.

- [ ] **Step 1: Write failing tests**

```python
# backend/tests/test_prompt_facts_truncate.py
"""Tests for truncate_by_value."""
from models import PromptContextBlock, PromptFact
from services.prompt_facts.truncate import truncate_by_value


def _fact(id_: str, polarity: str = "bullish", priority: int = 70, strength: int = 60) -> PromptFact:
    return PromptFact(
        id=id_, timeframe=id_.split(".")[0],
        indicator=id_.split(".")[1], text=f"Fact for {id_}",
        polarity=polarity, strength=strength, priority=priority, data={},
    )


def _approx_tokens(blocks: list[PromptContextBlock]) -> int:
    """Rough token estimate: text length // 4."""
    total = 0
    for b in blocks:
        for f in b.facts:
            total += len(f.text) // 4
    return total


class TestTruncate:
    def test_no_op_when_within_budget(self):
        blocks = [
            PromptContextBlock(timeframe="D", tf_weight=3, facts=[_fact("D.ema.stack_bullish")], last_close=100.0),
        ]
        out = truncate_by_value(blocks, budget_tokens=10_000)
        assert len(out) == 1
        assert len(out[0].facts) == 1

    def test_protects_cautions_always(self):
        blocks = [
            PromptContextBlock(
                timeframe="D", tf_weight=3,
                facts=[_fact(f"D.ema.f{i}", polarity="neutral", priority=10, strength=10) for i in range(20)]
                       + [_fact("D.rsi.overbought", polarity="caution", priority=50, strength=50)],
                last_close=100.0,
            ),
        ]
        out = truncate_by_value(blocks, budget_tokens=10)
        all_facts = [f for b in out for f in b.facts]
        assert any(f.id == "D.rsi.overbought" for f in all_facts)

    def test_drops_neutral_before_directional(self):
        blocks = [
            PromptContextBlock(
                timeframe="D", tf_weight=3,
                facts=[
                    _fact("D.ema.stack_bullish", polarity="bullish", priority=90, strength=80),
                    _fact("D.atr.stop_distances", polarity="neutral", priority=40, strength=30),
                ],
                last_close=100.0,
            ),
        ]
        out = truncate_by_value(blocks, budget_tokens=5)
        remaining = [f.id for b in out for f in b.facts]
        assert "D.ema.stack_bullish" in remaining
        assert "D.atr.stop_distances" not in remaining

    def test_drops_lowest_tf_block_last(self):
        blocks = [
            PromptContextBlock(
                timeframe="M", tf_weight=5,
                facts=[_fact("M.ema.stack_bullish", priority=80, strength=70)],
                last_close=100.0,
            ),
            PromptContextBlock(
                timeframe="1H", tf_weight=1,
                facts=[_fact("1H.ema.stack_bullish", priority=80, strength=70)],
                last_close=100.0,
            ),
        ]
        out = truncate_by_value(blocks, budget_tokens=3)
        tfs = {b.timeframe for b in out}
        assert "M" in tfs
        # 1H should be dropped first
        if "1H" not in tfs:
            assert True
```

- [ ] **Step 2: Run — verify fail**

```bash
uv run pytest tests/test_prompt_facts_truncate.py -v
```

- [ ] **Step 3: Implement**

```python
# backend/services/prompt_facts/truncate.py
"""Truncate-by-value: drop low-signal facts to fit token budget.

Drop order:
  1. Neutral facts by score asc (priority × tf_weight × strength)
  2. Whole lowest-tf blocks
Protect:
  - All polarity=caution facts
  - Highest-TF non-neutral facts
"""
from __future__ import annotations

from models import PromptContextBlock, PromptFact

# Conservative tokens-per-fact estimate: text + id + leading marker.
_TOKENS_PER_FACT = 30


def _estimate_tokens(blocks: list[PromptContextBlock]) -> int:
    return sum(len(b.facts) * _TOKENS_PER_FACT + 10 for b in blocks)


def _fact_score(f: PromptFact, tf_weight: int) -> int:
    return f.priority * tf_weight * max(f.strength, 1)


def truncate_by_value(
    blocks: list[PromptContextBlock], budget_tokens: int
) -> list[PromptContextBlock]:
    if _estimate_tokens(blocks) <= budget_tokens:
        return blocks

    # Work on shallow copies so we can mutate facts lists.
    working: list[PromptContextBlock] = [
        PromptContextBlock(
            timeframe=b.timeframe, tf_weight=b.tf_weight,
            facts=list(b.facts), last_close=b.last_close,
        )
        for b in blocks
    ]

    # Identify highest tf_weight present.
    max_weight = max((b.tf_weight for b in working), default=0)

    # Phase 1: drop neutral facts, lowest score first, but never touch
    # caution facts or highest-tf non-neutral facts.
    candidates: list[tuple[int, int, int]] = []  # (block_idx, fact_idx, score)
    for bi, b in enumerate(working):
        for fi, f in enumerate(b.facts):
            if f.polarity == "caution":
                continue
            if b.tf_weight == max_weight and f.polarity != "neutral":
                continue
            score = _fact_score(f, b.tf_weight)
            candidates.append((bi, fi, score))

    candidates.sort(key=lambda t: t[2])  # asc — lowest first

    to_drop: set[tuple[int, int]] = set()
    for bi, fi, _ in candidates:
        if _estimate_tokens_skip(working, to_drop) <= budget_tokens:
            break
        to_drop.add((bi, fi))

    for bi, b in enumerate(working):
        b.facts = [f for fi, f in enumerate(b.facts) if (bi, fi) not in to_drop]

    # Phase 2: drop whole blocks, lowest tf_weight first.
    if _estimate_tokens(working) > budget_tokens:
        working.sort(key=lambda b: b.tf_weight)
        while working and _estimate_tokens(working) > budget_tokens:
            # Skip blocks whose only facts are cautions — try next.
            droppable = next(
                (i for i, b in enumerate(working) if not any(f.polarity == "caution" for f in b.facts)),
                None,
            )
            if droppable is None:
                break
            working.pop(droppable)
        # Restore canonical order: highest tf_weight first.
        working.sort(key=lambda b: -b.tf_weight)

    return working


def _estimate_tokens_skip(blocks: list[PromptContextBlock], skip: set[tuple[int, int]]) -> int:
    total = 0
    for bi, b in enumerate(blocks):
        kept = sum(1 for fi, _ in enumerate(b.facts) if (bi, fi) not in skip)
        total += kept * _TOKENS_PER_FACT + 10
    return total
```

- [ ] **Step 4: Run — verify pass**

```bash
uv run pytest tests/test_prompt_facts_truncate.py -v
```

- [ ] **Step 5: Commit**

```bash
git add backend/services/prompt_facts/truncate.py backend/tests/test_prompt_facts_truncate.py
git commit -m "feat(ai): truncate-by-value with caution/high-tf protection"
```

---

### Task 18: `OllamaLifecycle.show_model`

**Files:**
- Modify: `backend/services/ollama.py`
- Modify: `backend/tests/test_ollama.py` (extend existing test file)

Per spec §10 — POST `/api/show` with `{"model": model}`, return parsed `model_info` dict. Async. Handles 404 and offline gracefully.

- [ ] **Step 1: Write failing test**

Append to `backend/tests/test_ollama.py`:

```python
class TestShowModel:
    @pytest.mark.asyncio
    async def test_show_returns_model_info_dict(self):
        from services.ollama import OllamaLifecycle

        lifecycle = OllamaLifecycle()
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "model_info": {"llama.context_length": 8192, "general.architecture": "llama"},
        }

        async_post = AsyncMock(return_value=mock_response)
        with patch("services.ollama.httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__.return_value.post = async_post
            info = await lifecycle.show_model("gemma3:4b")

        assert info is not None
        assert info.get("llama.context_length") == 8192

    @pytest.mark.asyncio
    async def test_show_returns_none_on_offline(self):
        from services.ollama import OllamaLifecycle
        import httpx

        lifecycle = OllamaLifecycle()
        async_post = AsyncMock(side_effect=httpx.ConnectError("offline"))
        with patch("services.ollama.httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__.return_value.post = async_post
            info = await lifecycle.show_model("missing:tag")

        assert info is None
```

- [ ] **Step 2: Run — verify fail**

```bash
uv run pytest tests/test_ollama.py::TestShowModel -v
```

- [ ] **Step 3: Implement**

Add to `backend/services/ollama.py` (inside `OllamaLifecycle` class):

```python
async def show_model(self, model: str) -> dict[str, Any] | None:
    """Fetch model metadata via /api/show. Returns model_info dict or None.

    The payload key must be "model" (per Ollama docs). Returns None on
    network failure, 404, or missing model_info.
    """
    import httpx
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(
                f"{self.base_url}/api/show",
                json={"model": model},
            )
        if resp.status_code != 200:
            return None
        body = resp.json()
        return body.get("model_info")
    except (httpx.ConnectError, httpx.TimeoutException, httpx.HTTPError):
        return None
```

- [ ] **Step 4: Run — verify pass**

```bash
uv run pytest tests/test_ollama.py::TestShowModel -v
```

- [ ] **Step 5: Commit**

```bash
git add backend/services/ollama.py backend/tests/test_ollama.py
git commit -m "feat(ollama): show_model — fetch model metadata via /api/show"
```

---

### Task 19: `OllamaContextService`

**Files:**
- Create: `backend/services/ollama_context.py`
- Create: `backend/tests/test_ollama_context.py`

Per spec §10 — context_length is a CEILING not an allocation. Budget = `min(static_tier, model_max × 0.7)` where 0.7 leaves headroom for output. Async, cached per-model.

- [ ] **Step 1: Write failing tests**

```python
# backend/tests/test_ollama_context.py
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
        # Static tier for gemma3:4b is high (e.g. 16384); model_max 8192 × 0.7 = 5734 wins.
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
```

- [ ] **Step 2: Run — verify fail**

```bash
uv run pytest tests/test_ollama_context.py -v
```

- [ ] **Step 3: Implement**

```python
# backend/services/ollama_context.py
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
```

- [ ] **Step 4: Run — verify pass**

```bash
uv run pytest tests/test_ollama_context.py -v
```

- [ ] **Step 5: Commit**

```bash
git add backend/services/ollama_context.py backend/tests/test_ollama_context.py
git commit -m "feat(ollama): OllamaContextService — per-model budget with ceiling clamp"
```

---

### Task 20: `AiService` Surgery

**Files:**
- Modify: `backend/services/ai.py`
- Modify: `backend/tests/test_ai_timeout.py`
- Modify: `backend/tests/test_ai_warmup.py`

Three changes:
1. Constructor accepts `OllamaContextService`.
2. `_prepare_analysis_session` becomes `async`.
3. `analyze` and `analyze_stream` accept `indicators_display: list[str]` + `indicator_names: list[str]` (resolved backend names).

- [ ] **Step 1: Inspect current signatures**

Read `backend/services/ai.py` lines 260-700 and `backend/tests/test_ai_timeout.py` to map out exact callsites.

- [ ] **Step 2: Update constructor**

Replace:

```python
class AiService:
    def __init__(self) -> None:
        ...
```

with:

```python
class AiService:
    def __init__(self, context_service: "OllamaContextService" | None = None) -> None:
        self._context_service = context_service
        ...
```

Add the TYPE_CHECKING import:

```python
from typing import TYPE_CHECKING
if TYPE_CHECKING:
    from services.ollama_context import OllamaContextService
```

- [ ] **Step 3: Update `_prepare_analysis_session` to async**

Locate the method (currently around `ai.py:487`). Change signature:

```python
async def _prepare_analysis_session(
    self,
    *,
    symbol: str,
    timeframe_data: dict[str, dict[str, Any]],
    indicators_display: list[str],
    indicator_names: list[str],
    indicator_priority: list[str],
    model: str,
) -> _AnalysisSession:
```

Inside the body:

```python
if self._context_service is not None:
    budget_tokens = await self._context_service.get_budget_for_model(model)
else:
    budget_tokens = _static_budget_for_model(model)
```

And pass both name lists to `build_indicator_context` (after Task 21 refactors it).

- [ ] **Step 4: Update `analyze` and `analyze_stream`**

Replace parameter `indicators_requested: list[str]` with both:

```python
async def analyze(
    self,
    *,
    symbol: str,
    timeframe_data: dict[str, dict[str, Any]],
    indicators_display: list[str],
    indicator_names: list[str],
    indicator_priority: list[str] | None = None,
    model: str | None = None,
) -> AnalysisResult:
    ...
    session = await self._prepare_analysis_session(
        symbol=symbol,
        timeframe_data=timeframe_data,
        indicators_display=indicators_display,
        indicator_names=indicator_names,
        indicator_priority=indicator_priority or [],
        model=resolved_model,
    )
```

Mirror in `analyze_stream`.

- [ ] **Step 5: Update tests**

`backend/tests/test_ai_timeout.py` — update `AiService()` instantiations and analyze call sites:

```python
ai = AiService(context_service=None)
result = await ai.analyze(
    symbol="AAPL",
    timeframe_data={"D": {...}},
    indicators_display=["RSI"],
    indicator_names=["rsi"],
)
```

Do the same for `test_ai_warmup.py`.

- [ ] **Step 6: Run — verify pass**

```bash
uv run pytest tests/test_ai_timeout.py tests/test_ai_warmup.py -v
```

- [ ] **Step 7: Commit**

```bash
git add backend/services/ai.py backend/tests/test_ai_timeout.py backend/tests/test_ai_warmup.py
git commit -m "refactor(ai): AiService — async budget + display/backend name separation"
```

---

### Task 21: Rewrite `prompt_builder.py` Around Facts

**Files:**
- Modify: `backend/services/prompt_builder.py`
- Create: `backend/tests/test_prompt_builder_facts.py`

Major surgery on the prompt builder. After this task, the builder is a thin orchestrator: dispatcher → truncate → render.

**Deletions from `prompt_builder.py`:**
- `_format_rsi`, `_format_macd`, `_format_ema`, `_format_bbands`, `_format_vwap`, `_format_atr`, `_format_stoch`, `_format_obv`, `_format_adx`, `_format_volume`, `_format_fibonacci`, `_format_fibs` (lines 242-362+)
- `INDICATOR_FORMATTERS` dict
- `_sort_indicators` (use canonical order in renderer instead)
- `_MODEL_BUDGETS` list (moved to ollama_context.py)
- `get_budget_for_model` (moved to OllamaContextService — kept locally as `_static_budget_for_model` synchronous fallback)

**Edits to `prompt_builder.py`:**

1. Remove this line from `_SYSTEM_BASE`:

   > "you do NOT need to include JSON in your narrative response"

   The signal block now comes from the structured extraction path. Replace it with:

   > "Reference verified facts by their bracketed ID (e.g., [D.ema.stack_bullish]) when citing evidence."

2. Replace `INDICATOR_HINTS` iteration order. The dict can stay (display-name keys), but emit hints in canonical order:

   ```python
   _CANONICAL_HINT_ORDER = (
       "Fibonacci Retracement", "EMA Stack", "RSI", "MACD",
       "Volume", "Bollinger Bands", "VWAP", "ATR",
       "Stochastic", "OBV", "ADX",
   )

   def _emit_hints(display_names: list[str]) -> str:
       requested = set(display_names)
       lines = [INDICATOR_HINTS[k] for k in _CANONICAL_HINT_ORDER if k in requested and k in INDICATOR_HINTS]
       return "\n".join(lines)
   ```

3. Replace `build_indicator_context` body:

   ```python
   def build_indicator_context(
       *,
       symbol: str,
       timeframe: str,
       candles: list[CandleData],
       indicators: list[IndicatorResult],
       fibs: list[FibonacciSnapshot] | None = None,
       raw_fibonacci: FibonacciResult | None = None,
       indicator_priority: list[str] | None = None,
       budget_tokens: int = 8192,
   ) -> str:
       """Build the prompt context section for a single timeframe."""
       tf_data = {
           timeframe: {
               "candles": candles,
               "indicators": indicators,
               "fibs": fibs or [],
               "fibonacci": raw_fibonacci,
           }
       }
       blocks = build_prompt_facts(
           symbol=symbol,
           timeframe_data=tf_data,
           indicator_priority=indicator_priority or [],
       )
       blocks = truncate_by_value(blocks, budget_tokens=budget_tokens)
       return render_prompt_facts(blocks)
   ```

4. Add a multi-timeframe orchestrator (used by `AiService._prepare_analysis_session`):

   ```python
   def build_full_prompt_context(
       *,
       symbol: str,
       timeframe_data: dict[str, dict[str, Any]],
       indicator_priority: list[str],
       budget_tokens: int,
   ) -> str:
       blocks = build_prompt_facts(
           symbol=symbol,
           timeframe_data=timeframe_data,
           indicator_priority=indicator_priority,
       )
       blocks = truncate_by_value(blocks, budget_tokens=budget_tokens)
       return render_prompt_facts(blocks)
   ```

5. Rename the system-prompt builder signature:

   ```python
   def build_system_prompt(
       *,
       indicators_display: list[str],
       indicator_names: list[str],
   ) -> str:
       hints = _emit_hints(indicators_display)
       provided_text = ", ".join(indicators_display)
       return f"{_SYSTEM_BASE}\n\nIndicators provided: {provided_text}\n\n{hints}".rstrip()
   ```

- [ ] **Step 1: Write failing tests**

```python
# backend/tests/test_prompt_builder_facts.py
"""Tests for the fact-layer-based prompt builder."""
from models import CandleData, IndicatorValue, IndicatorResult
from services.prompt_builder import build_indicator_context, build_system_prompt


def _candles(closes: list[float]) -> list[CandleData]:
    return [
        CandleData(time=1_700_000_000 + i * 86400, open=c - 0.5, high=c + 1, low=c - 1, close=c, volume=1_000_000)
        for i, c in enumerate(closes)
    ]


def _ema(period: int, values: list[float]) -> IndicatorResult:
    return IndicatorResult(
        name="ema", type="overlay",
        values=[IndicatorValue(time=1_700_000_000 + i * 86400, value=v) for i, v in enumerate(values)],
        params={"period": period},
    )


class TestBuildIndicatorContextFromFacts:
    def test_renders_fact_ids_inline(self):
        candles = _candles([100.0 + i * 0.5 for i in range(25)])
        ema9 = _ema(9, [99.0 + i * 0.5 for i in range(25)])
        ema21 = _ema(21, [98.0 + i * 0.4 for i in range(25)])

        out = build_indicator_context(
            symbol="AAPL", timeframe="D",
            candles=candles, indicators=[ema9, ema21],
        )
        assert "D.ema." in out
        assert "Verified Facts" in out

    def test_does_not_emit_legacy_format_sections(self):
        candles = _candles([100.0] * 25)
        out = build_indicator_context(
            symbol="AAPL", timeframe="D",
            candles=candles, indicators=[],
        )
        # Legacy "Primary fib"/"Locked fib #1"/"Source: MANUAL" labels must NOT appear.
        assert "Primary fib" not in out
        assert "Locked fib #" not in out
        assert "Source: MANUAL" not in out


class TestBuildSystemPrompt:
    def test_emits_canonical_hint_order(self):
        out = build_system_prompt(
            indicators_display=["RSI", "Fibonacci Retracement", "EMA Stack"],
            indicator_names=["rsi", "fibonacci", "ema"],
        )
        # Fibonacci hint must appear before EMA hint must appear before RSI hint
        f_idx = out.index("Fibonacci Retracement")
        e_idx = out.index("EMA Stack")
        r_idx = out.index("RSI")
        assert f_idx < e_idx < r_idx

    def test_indicators_provided_uses_display_names(self):
        out = build_system_prompt(
            indicators_display=["EMA Stack"],
            indicator_names=["ema"],
        )
        assert "EMA Stack" in out
        # backend name should not appear in the user-facing list
        provided_line = next(
            line for line in out.splitlines() if line.startswith("Indicators provided")
        )
        assert "ema" not in provided_line

    def test_no_contradictory_json_instruction(self):
        out = build_system_prompt(indicators_display=["RSI"], indicator_names=["rsi"])
        assert "you do NOT need to include JSON" not in out
        assert "you do not need to include JSON" not in out
```

- [ ] **Step 2: Run — verify fail**

```bash
uv run pytest tests/test_prompt_builder_facts.py -v
```

- [ ] **Step 3: Implement — perform the deletions and edits described above**

Run a grep first to find all `_format_` references that must be deleted:

```bash
grep -n "_format_\|INDICATOR_FORMATTERS\|_sort_indicators\|_MODEL_BUDGETS\|get_budget_for_model" backend/services/prompt_builder.py
```

Then perform each edit using the Edit tool. Imports to add at top:

```python
from services.prompt_facts import build_prompt_facts
from services.prompt_facts.render import render_prompt_facts
from services.prompt_facts.truncate import truncate_by_value
```

- [ ] **Step 4: Run — verify pass**

```bash
uv run pytest tests/test_prompt_builder_facts.py -v
uv run pytest tests/test_prompt_builder.py -v  # legacy tests — some may need to be removed/rewritten
```

- [ ] **Step 5: Commit**

```bash
git add backend/services/prompt_builder.py backend/tests/test_prompt_builder_facts.py
git commit -m "refactor(ai): prompt_builder — thin orchestrator over fact layer"
```

---

### Task 22: Router Update — Pass Both Name Lists

**Files:**
- Modify: `backend/routers/ai.py`

Update the call site at `routers/ai.py:445`. The router already calls `_resolve_indicators(request.indicators)` at line 418, so both lists are available.

- [ ] **Step 1: Edit the call site**

Find:

```python
ai.analyze(... indicators_requested=request.indicators ...)
```

Replace with:

```python
ai.analyze(
    ...,
    indicators_display=request.indicators,
    indicator_names=resolved_indicators,
    indicator_priority=request.indicator_priority or [],
)
```

Mirror for `analyze_stream` if it has its own call site.

- [ ] **Step 2: Run integration tests**

```bash
uv run pytest tests/test_ai_router.py tests/test_ai_with_fibs.py -v
```

(test_ai_with_fibs.py will be rewritten in Task 25 — failures here are expected if it still references the old format.)

- [ ] **Step 3: Commit**

```bash
git add backend/routers/ai.py
git commit -m "feat(ai): router passes display + resolved indicator names separately"
```

---

### Task 23: `main.py` Wiring

**Files:**
- Modify: `backend/main.py`

Inject `OllamaContextService` into `AiService`. Lifecycle is constructed at line 103; AiService at line 120.

- [ ] **Step 1: Edit `main.py`**

Add import:

```python
from services.ollama_context import OllamaContextService
```

Change the wiring around line 120:

```python
ollama = OllamaLifecycle()
ollama_context = OllamaContextService(ollama)
ai = AiService(context_service=ollama_context)
```

- [ ] **Step 2: Smoke test the app start**

```bash
uv run python -c "import main; print('imports ok')"
```

- [ ] **Step 3: Commit**

```bash
git add backend/main.py
git commit -m "feat(ai): wire OllamaContextService into AiService at app start"
```

---

### Task 24: Frontend — Add ATR to Indicator Picker

**Files:**
- Modify: `src/components/ai/AiConfigPanel.tsx`
- Modify: `src/lib/api.ts` (only if `AiIndicator` union is defined there)

Backend supports ATR but the frontend has never exposed it. Add to the picker so users can include it.

- [ ] **Step 1: Read the current picker file**

```bash
# Inspect lines 1-60 first
```

Then locate the `AiIndicator` type union and the `INDICATORS` array (currently lines 22-41).

- [ ] **Step 2: Add ATR to the union**

```ts
export type AiIndicator =
  | "RSI"
  | "MACD"
  | "EMA Stack"
  | "Fibonacci Retracement"
  | "Volume"
  | "Bollinger Bands"
  | "VWAP"
  | "ATR"
  | "Stochastic"
  | "OBV"
  | "ADX";
```

- [ ] **Step 3: Add ATR to the INDICATORS array**

Insert `{ id: "ATR", label: "ATR" }` between `VWAP` and `Stochastic` to match canonical order.

- [ ] **Step 4: Verify by running the frontend type-check**

```bash
pnpm tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/components/ai/AiConfigPanel.tsx src/lib/api.ts
git commit -m "feat(ai-ui): add ATR to indicator picker"
```

---

### Task 25: Rewrite `test_ai_with_fibs.py`

**Files:**
- Modify: `backend/tests/test_ai_with_fibs.py`

The existing test asserts on legacy strings that no longer exist: `"Primary fib"`, `"Locked fib #1"`, `"Source: MANUAL"`, `"Source: LOCKED"`. Replace with fact-ID assertions.

- [ ] **Step 1: Edit the `TestPromptBuilderWithFibs` class**

Replace the existing test:

```python
class TestPromptBuilderWithFibs:
    def test_prompt_includes_primary_fib_facts(self):
        context = build_indicator_context(
            symbol="AAPL",
            timeframe="D",
            candles=[make_candle(close=110.0)],
            indicators=[],
            fibs=[
                make_snapshot(source="manual", is_primary=True, score=84.0,
                              swing_low=100.0, swing_high=120.0),
            ],
        )
        # Fact IDs from the fib builder must appear in rendered output.
        assert "D.fibonacci." in context
        # Position fact for price=110 inside 100-120 swing
        assert any(
            tag in context
            for tag in [
                "D.fibonacci.position_inside_swing",
                "D.fibonacci.near_0500",
                "D.fibonacci.near_0618",
            ]
        )

    def test_locked_fib_only_appears_when_no_primary(self):
        # Per spec §7.1 — fibonacci builder takes the primary or first fib.
        # A locked-only setup should still emit facts.
        context = build_indicator_context(
            symbol="AAPL",
            timeframe="D",
            candles=[make_candle(close=110.0)],
            indicators=[],
            fibs=[make_snapshot(source="locked", swing_low=90.0, swing_high=130.0)],
        )
        assert "D.fibonacci." in context
```

- [ ] **Step 2: Run — verify pass**

```bash
uv run pytest tests/test_ai_with_fibs.py -v
```

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_ai_with_fibs.py
git commit -m "test(ai): rewrite fib prompt tests to assert on fact IDs"
```

---

### Task 26: Update `test_prompt_budget.py`, `test_ai_timeout.py`, `test_ai_warmup.py`

**Files:**
- Modify: `backend/tests/test_prompt_budget.py`
- Modify: `backend/tests/test_ai_timeout.py`
- Modify: `backend/tests/test_ai_warmup.py`

After Task 19/20 the budget moved to `OllamaContextService` and is async. The legacy test patches `get_budget_for_model` on `prompt_builder` — that import target no longer exists.

- [ ] **Step 1: Update `test_prompt_budget.py`**

Replace:

```python
from services.prompt_builder import get_budget_for_model
```

with:

```python
import pytest
from services.ollama_context import OllamaContextService, _static_budget_for_model
```

Convert any tests that directly called `get_budget_for_model("gemma3:4b")` into:

```python
def test_static_tier_for_gemma3_4b():
    assert _static_budget_for_model("gemma3:4b") == 16384


@pytest.mark.asyncio
async def test_get_budget_clamps_to_70pct_of_model_max():
    class _LC:
        async def show_model(self, model):
            return {"llama.context_length": 4096}
    svc = OllamaContextService(_LC())
    budget = await svc.get_budget_for_model("gemma3:4b")
    assert budget == int(4096 * 0.7)
```

- [ ] **Step 2: Update `test_ai_timeout.py` and `test_ai_warmup.py`**

Replace any `indicators_requested=...` kwarg with the two new ones:

```python
await ai.analyze(
    symbol="AAPL",
    timeframe_data={"D": {...}},
    indicators_display=["RSI"],
    indicator_names=["rsi"],
)
```

Construct `AiService(context_service=None)` where it was `AiService()` previously.

- [ ] **Step 3: Run — verify pass**

```bash
uv run pytest tests/test_prompt_budget.py tests/test_ai_timeout.py tests/test_ai_warmup.py -v
```

- [ ] **Step 4: Commit**

```bash
git add backend/tests/test_prompt_budget.py backend/tests/test_ai_timeout.py backend/tests/test_ai_warmup.py
git commit -m "test(ai): update budget + analyze tests for new async service shape"
```

---

### Task 27: Eval Harness — Fixture-Based Regression Tests

**Files:**
- Create: `backend/tests/fixtures/prompt_facts/__init__.py`
- Create: `backend/tests/fixtures/prompt_facts/tsm_extension.py`
- Create: `backend/tests/fixtures/prompt_facts/aapl_in_swing.py`
- Create: `backend/tests/fixtures/prompt_facts/nvda_ema_stack.py`
- Create: `backend/tests/test_prompt_facts_eval.py`

Per spec §14 — fixed scenarios with snapshot assertions and "no false fact" guards. Uses syrupy installed in Task 3.

- [ ] **Step 1: Build the TSM extension fixture (the canonical regression case)**

```python
# backend/tests/fixtures/prompt_facts/tsm_extension.py
"""TSM: price above swing high → extension territory.

This is the bug case: previous prompt called this "testing 0.5 retracement".
With facts: must emit D.fibonacci.position_above_swing AND must NOT emit
any 'near 0.500' fact.
"""
from models import CandleData, FibonacciSnapshot


def make_tsm_candles() -> list[CandleData]:
    return [
        CandleData(time=1_700_000_000 + i * 86400,
                   open=200.0 + i, high=205.0 + i, low=198.0 + i,
                   close=200.0 + i, volume=10_000_000)
        for i in range(30)
    ] + [
        CandleData(time=1_700_000_000 + 30 * 86400,
                   open=210.0, high=216.0, low=209.0, close=215.40, volume=12_000_000),
    ]


def make_tsm_primary_fib() -> FibonacciSnapshot:
    return FibonacciSnapshot(
        source="auto",
        swing_high=210.50, swing_low=195.20,
        swing_high_time=1_700_000_000 + 25 * 86400,
        swing_low_time=1_700_000_000 + 5 * 86400,
        direction="up", score=82.0, is_primary=True, timeframe="D", note=None,
    )
```

- [ ] **Step 2: Build AAPL in-swing and NVDA stack fixtures**

```python
# backend/tests/fixtures/prompt_facts/aapl_in_swing.py
from models import CandleData, FibonacciSnapshot


def make_aapl_candles() -> list[CandleData]:
    closes = [180.0 + i * 0.3 for i in range(30)]  # 180 → ~189
    return [
        CandleData(time=1_700_000_000 + i * 86400, open=c - 0.5, high=c + 1, low=c - 1, close=c, volume=5_000_000)
        for i, c in enumerate(closes)
    ]


def make_aapl_primary_fib() -> FibonacciSnapshot:
    # price ~189 inside swing 175-200
    return FibonacciSnapshot(
        source="auto", swing_high=200.0, swing_low=175.0,
        swing_high_time=1_700_000_000 + 28 * 86400,
        swing_low_time=1_700_000_000 + 2 * 86400,
        direction="up", score=78.0, is_primary=True, timeframe="D", note=None,
    )
```

```python
# backend/tests/fixtures/prompt_facts/nvda_ema_stack.py
from models import CandleData, IndicatorResult, IndicatorValue


def make_nvda_candles() -> list[CandleData]:
    return [
        CandleData(time=1_700_000_000 + i * 86400,
                   open=140.0 + i * 0.4, high=142.0 + i * 0.4,
                   low=139.0 + i * 0.4, close=141.0 + i * 0.4, volume=20_000_000)
        for i in range(30)
    ]


def make_nvda_emas() -> list[IndicatorResult]:
    def _e(period: int, base: float) -> IndicatorResult:
        return IndicatorResult(
            name="ema", type="overlay",
            values=[IndicatorValue(time=1_700_000_000 + i * 86400, value=base + i * 0.3) for i in range(30)],
            params={"period": period},
        )
    # 9 > 21 > 50 > 200 — bullish stack
    return [_e(9, 145.0), _e(21, 142.0), _e(50, 138.0), _e(200, 130.0)]
```

```python
# backend/tests/fixtures/prompt_facts/__init__.py
"""Fixture exports for prompt-facts eval harness."""
```

- [ ] **Step 3: Write the eval harness test**

```python
# backend/tests/test_prompt_facts_eval.py
"""Eval harness: snapshot rendered prompts + 'no false fact' assertions.

These tests are the regression suite for the original TSM bug:
  - Previous behavior: price $215.40 above swing high $210.50 →
    LLM said "testing 0.5 retracement" — FABRICATION.
  - Fact layer: emits D.fibonacci.position_above_swing.
"""
import pytest

from services.prompt_facts import build_prompt_facts
from services.prompt_facts.render import render_prompt_facts

from tests.fixtures.prompt_facts.tsm_extension import make_tsm_candles, make_tsm_primary_fib
from tests.fixtures.prompt_facts.aapl_in_swing import make_aapl_candles, make_aapl_primary_fib
from tests.fixtures.prompt_facts.nvda_ema_stack import make_nvda_candles, make_nvda_emas


class TestTsmExtensionRegression:
    def test_emits_position_above_swing(self):
        tf_data = {"D": {
            "candles": make_tsm_candles(),
            "indicators": [],
            "fibs": [make_tsm_primary_fib()],
            "fibonacci": None,
        }}
        blocks = build_prompt_facts(symbol="TSM", timeframe_data=tf_data, indicator_priority=[])
        rendered = render_prompt_facts(blocks)
        assert "D.fibonacci.position_above_swing" in rendered

    def test_no_false_retracement_fact_in_extension(self):
        tf_data = {"D": {
            "candles": make_tsm_candles(),
            "indicators": [],
            "fibs": [make_tsm_primary_fib()],
            "fibonacci": None,
        }}
        blocks = build_prompt_facts(symbol="TSM", timeframe_data=tf_data, indicator_priority=[])
        rendered = render_prompt_facts(blocks).lower()
        # The canonical bug: must NOT claim price is testing/near 0.5
        assert "near_0500" not in rendered
        assert "near 0.500" not in rendered
        assert "near 0.5 retracement" not in rendered

    def test_tsm_snapshot(self, snapshot):
        tf_data = {"D": {
            "candles": make_tsm_candles(),
            "indicators": [],
            "fibs": [make_tsm_primary_fib()],
            "fibonacci": None,
        }}
        blocks = build_prompt_facts(symbol="TSM", timeframe_data=tf_data, indicator_priority=[])
        rendered = render_prompt_facts(blocks)
        assert rendered == snapshot


class TestAaplInSwing:
    def test_emits_inside_swing_position(self):
        tf_data = {"D": {
            "candles": make_aapl_candles(),
            "indicators": [],
            "fibs": [make_aapl_primary_fib()],
            "fibonacci": None,
        }}
        blocks = build_prompt_facts(symbol="AAPL", timeframe_data=tf_data, indicator_priority=[])
        rendered = render_prompt_facts(blocks)
        assert "D.fibonacci.position_inside_swing" in rendered

    def test_aapl_snapshot(self, snapshot):
        tf_data = {"D": {
            "candles": make_aapl_candles(),
            "indicators": [],
            "fibs": [make_aapl_primary_fib()],
            "fibonacci": None,
        }}
        blocks = build_prompt_facts(symbol="AAPL", timeframe_data=tf_data, indicator_priority=[])
        rendered = render_prompt_facts(blocks)
        assert rendered == snapshot


class TestNvdaEmaStack:
    def test_emits_bullish_stack(self):
        tf_data = {"D": {
            "candles": make_nvda_candles(),
            "indicators": make_nvda_emas(),
            "fibs": [],
            "fibonacci": None,
        }}
        blocks = build_prompt_facts(symbol="NVDA", timeframe_data=tf_data, indicator_priority=["ema"])
        rendered = render_prompt_facts(blocks)
        assert "D.ema.stack_bullish" in rendered

    def test_nvda_snapshot(self, snapshot):
        tf_data = {"D": {
            "candles": make_nvda_candles(),
            "indicators": make_nvda_emas(),
            "fibs": [],
            "fibonacci": None,
        }}
        blocks = build_prompt_facts(symbol="NVDA", timeframe_data=tf_data, indicator_priority=["ema"])
        rendered = render_prompt_facts(blocks)
        assert rendered == snapshot
```

- [ ] **Step 4: Run snapshot tests — generate ambient snapshots**

```bash
uv run pytest tests/test_prompt_facts_eval.py --snapshot-update -v
```

Then run again without `--snapshot-update` to confirm they pass:

```bash
uv run pytest tests/test_prompt_facts_eval.py -v
```

- [ ] **Step 5: Inspect snapshots manually**

```bash
cat backend/tests/__snapshots__/test_prompt_facts_eval.ambr | head -100
```

Verify the TSM snapshot contains `position_above_swing` and does NOT contain `near_0500`. Reject and fix if anything looks wrong.

- [ ] **Step 6: Commit**

```bash
git add backend/tests/fixtures/prompt_facts/ backend/tests/test_prompt_facts_eval.py backend/tests/__snapshots__/test_prompt_facts_eval.ambr
git commit -m "test(ai): eval harness — TSM/AAPL/NVDA fixtures + snapshot regression"
```

---

### Task 28: Final Integration Pass

**Files:** none new — wraps up the plan.

- [ ] **Step 1: Run the full backend test suite**

```bash
cd backend && uv run pytest -v
```

Expected: all tests pass. Triage any failures task-by-task.

- [ ] **Step 2: Run the frontend type-check**

```bash
cd /Users/ofekarojas/Desktop/Projects/Parallax && pnpm tsc --noEmit
```

- [ ] **Step 3: Manual smoke — start the backend**

```bash
cd backend && uv run uvicorn main:app --reload --port 8000
```

Hit `GET /health` then `POST /ai/analyze` with a small payload:

```bash
curl -s -X POST http://localhost:8000/ai/analyze \
  -H 'Content-Type: application/json' \
  -d '{"conid": 265598, "symbol": "AAPL", "timeframes": ["D"], "indicators": ["EMA Stack", "Fibonacci Retracement"]}' | head -50
```

Inspect the response: `narrative` should reference at least one `[D.*]` fact ID; `signal.confirmation_fact_ids` (if signal present) must all exist in the prompt context.

- [ ] **Step 4: Acceptance checklist (from spec §18)**

Walk down the spec acceptance list and check each item:

- [ ] Prompt emits explicit relationship phrases (no raw value dumps) when computable.
- [ ] No "near 0.5 retracement" hallucination in TSM extension fixture.
- [ ] Signal `confirmation_fact_ids` / `caution_fact_ids` always map to facts present in the prompt.
- [ ] `risk_reward` is backend-computed, never echoed from LLM output.
- [ ] Identical inputs produce identical rendered prompt text (byte-stable).
- [ ] Budget truncation preserves cautions + highest-TF non-neutral facts under a 1024-token clamp.
- [ ] All new fact builders and validation paths covered by tests.

- [ ] **Step 5: Open the PR**

```bash
git push -u origin feature/ai-prompt-context-facts
gh pr create --title "feat(ai): prompt fact layer — deterministic facts, no LLM relationship guessing" --body "$(cat <<'EOF'
## Summary
- New backend prompt-fact layer between indicator computation and prompt rendering.
- LLM narrates from verified PromptFact objects; backend computes all relationships and risk/reward.
- Truncation operates on structured blocks, protecting cautions + highest-TF facts.

## Test plan
- [ ] All new fact builders pass unit tests (`uv run pytest tests/test_prompt_facts_*.py`)
- [ ] TSM regression fixture proves no "near 0.5 retracement" fabrication
- [ ] Snapshot tests pass for AAPL/NVDA/TSM
- [ ] Manual analyze on real symbol references fact IDs inline
- [ ] Truncation under 1024-token clamp preserves caution facts
EOF
)"
```

---

## Plan Self-Review

After writing every task, scan the plan for:

**1. Spec coverage** — walk each section of the spec and confirm at least one task implements it.

  | Spec § | Task |
  |---|---|
  | §1 TSM regression case | Task 27 |
  | §2 Fact ID schema | Task 1 |
  | §3 Polarity Literal | Task 1 |
  | §4 PromptContextBlock | Task 1 |
  | §5 Stable enum suffix rule | Tasks 4-14 (each builder emits stable suffix IDs) |
  | §6 Dispatcher with weights | Task 15 |
  | §7.1–§7.11 per-indicator facts | Tasks 4-14 |
  | §8 Renderer | Task 16 |
  | §9 Truncate by value | Task 17 |
  | §10 OllamaContextService | Tasks 18, 19 |
  | §11 SignalDraft / extraction | NOT IN THIS PLAN — see scope note below |
  | §12 Prompt cache stability | Task 21 (canonical hint order + byte-stable labels) |
  | §13 Frontend ATR | Task 24 |
  | §14 Eval harness | Task 27 |
  | §15 Test inventory | Tasks 25-27 |
  | §16 main.py wiring | Task 23 |
  | §17 Removals (no contradictory JSON, etc.) | Task 21 |
  | §18 Acceptance | Task 28 |

**Scope note on §11 SignalDraft / Structured Extraction:** This plan delivers the **fact layer** (the input contract for both narrative and signal extraction). The structured-extraction call itself (chat_structured with per-request enum schema, narrative → signal extraction, risk/reward computation) is a *separate, downstream plan* — it consumes the fact layer this plan produces. Splitting keeps each plan testable and shippable. After this plan merges, the next plan (`docs/superpowers/plans/2026-05-XX-ai-signal-extraction.md`) will implement Tasks 9-10 of the original game-plan: SignalDraft schema, request-specific enum generation, and structured extraction flow.

**2. Placeholder scan** — grep for `TBD`, `TODO`, `fill in`, `similar to`:

```bash
grep -nE "TBD|TODO|fill in|similar to task" docs/superpowers/plans/2026-05-24-ai-prompt-fact-layer.md
```

Should return nothing inside task bodies (mentions in this self-review section are fine).

**3. Type consistency** — across tasks:

  - `PromptFact` fields (`id`, `timeframe`, `indicator`, `text`, `polarity`, `strength`, `priority`, `data`) are identical in Task 1, 4-14, and the eval harness.
  - `PromptContextBlock` shape (`timeframe`, `tf_weight`, `facts`, `last_close`) is identical in Task 1, 15, 16, 17.
  - `build_prompt_facts(symbol=, timeframe_data=, indicator_priority=)` signature is identical in Task 15 and call sites in Tasks 21, 27.
  - `OllamaContextService.get_budget_for_model` is `async` in Tasks 19, 20, 23, 26.
  - `AiService.analyze` parameters (`indicators_display`, `indicator_names`) are identical in Tasks 20, 22, 26.

If you find a mismatch while implementing, fix it inline and verify other call sites still align.

---
