# AI Prompt Fact Layer

**Branch:** `feature/ai-prompt-context-facts` from `dev`
**Date:** 2026-05-24
**Status:** Design approved, ready for plan
**Predecessor work:** This spec is the spine of the larger "AI Prompt Context Reliability" plan. A follow-up spec ("Verified Signal Contract") will cover the deferred Task 9 / Task 10 work.

---

## 1. Problem

The current AI prompt gives the local LLM raw indicator values but not the *relationships between them*. The small models that this app primarily targets (tiny + mid, 8–24 GB RAM machines) fill the gap by **inferring relationships and inferring wrong**.

The canonical failure is the TSM extension case: price at $215.40 is above the entire swing ($145.20 → $210.50), so it's in extension territory. The current prompt emits seven retracement-level lines (`0.0, 0.382, 0.5, 0.618, 0.65, 0.716, 1.0` per `indicators.py:47`) and lets the model figure out where price sits. A tiny model latches onto the visually-prominent 0.5 line and writes "price is testing the 0.5 retracement" — a fabrication. The 0.5 level is at $177.85; price is 21% above it.

The root cause is everywhere, not just fibs:
- `_format_macd` labels the histogram `BULLISH` purely from sign, missing the four meaningful states.
- `_format_ema` emits four independent "Price ABOVE/BELOW" lines and never says "stack is bullish-ordered."
- `_format_rsi` says `NEUTRAL` for 40 ≤ RSI ≤ 70, hiding "above 50 and rising" momentum.
- `_format_volume` says `ABOVE AVG` without coupling to candle direction (the rejection-volume pattern is invisible).

## 2. Goal

Make the Python sidecar compute deterministic, relationship-aware **facts** before the prompt is rendered. The LLM reads facts and narrates from them rather than re-deriving relationships from raw numbers.

**Success criteria:**
1. For the TSM extension case, the prompt contains `D.fibonacci.position_above_swing` and does **not** contain any "price near 0.5 retracement" wording.
2. Every enabled indicator's prompt block makes its relationships explicit (stack order, above/below thresholds, rising/falling, recent events) **when computable values are present**.
3. Prompt output is byte-stable for identical inputs (deterministic ordering and formatting).
4. Tight context budgets preserve high-value facts and drop neutral / raw filler first.
5. Every new fact builder has tests, including "no false fact" regression tests for the original bug class.

## 3. Scope

**In scope** (Tasks 1, 2-minimal, 3, 4, 5, 6, 7, 8, 11, 12, 13 from the originating game plan):
- New fact-layer module replacing per-indicator formatters in `prompt_builder.py`.
- Per-indicator-family fact builders (11 families).
- Ollama `/api/show` integration for context-window introspection with cached budget calculation and fallback to existing per-model budgets.
- Value-scored context truncation that preserves high-impact facts.
- Prompt layout pass for cache stability and consistent labels.
- Frontend: add `ATR` to the AI indicator picker. No priority UI in this branch (plumbing only).
- Eval harness via `syrupy` snapshot tests + explicit "no false fact" assertions.

**Out of scope — deferred to follow-up specs:**
- **Task 9 — Verified Signal Contract.** `SignalDraft` schema with fact-ID enums, backend-computed risk/reward, signal-level validation.
- **Task 10 — Structured Extraction Flow.** Bringing back the second `chat_structured()` call, removing inline JSON, removing `reasoning_steps`.
- **Deeper Task 2 work.** `prompt_eval_count` / `eval_count` capture, runtime-context introspection via `/api/ps`, latency dashboards.
- **Frontend priority UI** (drag-to-reorder, star/pin) — fact layer benefits when priority is set, but no UI is added in this branch.
- **True 1H / 4H candle resampling** — see §13 limitations.

**Known limitation accepted by this branch:** This spec improves *prompt factuality* (the model sees verified relationships and narrates from them). It does **not** fully constrain the structured signal card. The model can still fabricate confirmations and risk/reward values in its inline JSON output. That problem is the explicit goal of the follow-up Verified Signal Contract spec.

## 4. Architecture

```
candles + indicators + ATR + history
                ↓
build_prompt_facts(symbol, timeframe_data, indicator_priority)
                ↓                  (dispatch by indicator family)
  ┌──────────────────────────────────────────────────┐
  │  prompt_facts/fibonacci.py   build_facts(...)    │
  │  prompt_facts/ema.py         build_facts(...)    │
  │  prompt_facts/rsi.py         build_facts(...)    │
  │  prompt_facts/macd.py        build_facts(...)    │  ← per family
  │  prompt_facts/bbands.py      build_facts(...)    │
  │  prompt_facts/vwap.py        build_facts(...)    │
  │  prompt_facts/atr.py         build_facts(...)    │
  │  prompt_facts/stoch.py       build_facts(...)    │
  │  prompt_facts/obv.py         build_facts(...)    │
  │  prompt_facts/adx.py         build_facts(...)    │
  │  prompt_facts/volume.py      build_facts(...)    │
  └──────────────────────────────────────────────────┘
                ↓
list[PromptFact]   (sort by priority desc, tf weight desc, strength desc, recency desc)
                ↓
PromptContextBlock per timeframe   (header + facts + optional chart-context blocks, all still structured)
                ↓
truncate_by_value(blocks, budget)    ← operates on structured blocks, not rendered text
                ↓
render_blocks(blocks) → "Verified Facts:" prompt block per timeframe
                ↓
final prompt → Ollama
```

**Why a structured intermediate (`PromptContextBlock`):** value-scored truncation needs to know per-fact `priority / strength / polarity / timeframe` to make drop decisions. If we render to text first, all that metadata is lost and truncation degrades to substring matching. The render step happens **after** truncation.

```python
# backend/services/prompt_facts/types.py (also)
class PromptContextBlock(BaseModel):
    timeframe: str
    header_line: str            # already-formatted "Price: $… ATR(14): $…" line
    facts: list[PromptFact]     # already sorted; truncation may pop entries
    chart_context: Optional[str] = None   # _build_price_summary / ohlcv / patterns, optional
```

The per-indicator formatters in `prompt_builder.py` (`_format_rsi`, `_format_macd`, `_format_ema`, `_format_bbands`, `_format_vwap`, `_format_atr`, `_format_stoch`, `_format_obv`, `_format_adx`, `_format_volume`, `_format_fibonacci`, `_format_fibs`) are **deleted**. They are private to `prompt_builder.py`; sweep confirmed no external callers.

`build_indicator_context` becomes a thin orchestrator: build header → build facts → sort facts → assemble `PromptContextBlock` per timeframe → run `truncate_by_value` over the block list → render. The existing `_build_price_summary` / `_build_ohlcv_history` / `_build_pattern_context` are kept untouched and attached as the block's `chart_context` string; they're orthogonal to the fact layer and remain droppable as a whole.

## 5. PromptFact contract

```python
# backend/services/prompt_facts/types.py
from pydantic import BaseModel
from typing import Literal

Polarity = Literal["bullish", "bearish", "neutral", "caution"]

class PromptFact(BaseModel):
    id: str           # "{timeframe}.{indicator}.{condition}", e.g. "D.macd.hist_above_rising"
    timeframe: str    # "1H" | "4H" | "D" | "W" | "M"
    indicator: str    # "fibonacci" | "ema" | "rsi" | ... (one of 11 families, lowercase)
    text: str         # human-readable line including load-bearing raw numbers
    polarity: Polarity
    strength: int     # 0–100
    priority: int     # static per fact type (see §7); modulated by indicator_priority at sort time
    data: dict        # raw numbers, ratios, distances, lookback (everything that backed the decision)
```

**Where it lives:** `backend/services/prompt_facts/types.py`. **Not** in `backend/models/` — `PromptFact` is an internal service contract between the fact builders and the prompt renderer, not an HTTP request/response model.

**Hard rules for fact builders:**
1. Builders return `[]` on missing/None inputs. Use **explicit guards** (`if val is None: return []`, `if not ind.values: return []`). **Never** `except Exception: return []`. Typed errors only (CLAUDE.md rule 4).
2. Every `IndicatorValue.value / signal / histogram / upper / lower` access must defend against `None` — these are all `Optional[float]` on the model.
3. Fact text embeds the load-bearing raw number(s) (architecture C). `"RSI 62.3, above 50 and rising 3 bars"` not `"RSI above 50 rising"`.
4. IDs may include **stable enum suffixes** (e.g., EMA periods `9 / 21 / 50 / 200`, fib retracement ratios `0382 / 0500 / 0618`), but **not tunable thresholds or lookback lengths**. Threshold values (`0.005`), lookback `N` (`3`, `5`), percentile cutoffs (`25`), and ATR multipliers live in `data`, never the ID. Enum suffixes are spelled as digits with no decimal point (`price_near_0618`, `cross_9_21_recent`) so the ID stays a valid Python identifier substring.
5. ID schema (locked): `{timeframe}.{indicator}.{condition}`. Timeframe ∈ `{1H, 4H, D, W, M}`. Indicator is the lowercase family name (`fibonacci`, `ema`, `rsi`, `macd`, `bbands`, `vwap`, `atr`, `stoch`, `obv`, `adx`, `volume`). Condition is snake_case and may carry the stable enum suffixes above.
6. Renaming a condition is a breaking change requiring a migration note in the next design doc.

## 6. Threshold helpers

All shared in `prompt_facts/_common.py`. Builders import these — they do not reinvent thresholds.

### 6.1 `is_near(price, level, atr=None) -> bool`
- If `atr` is provided and > 0: returns `True` iff `abs(price - level) <= 0.25 * atr`.
- If `atr` is missing or zero: percent fallback, `abs(price - level) / price <= 0.005` (0.5%).

### 6.2 `is_rising_n(values, n, mode) -> bool`
- `mode="momentum"` (default for RSI, MACD hist, Stoch, price-momentum): N=3, **net slope > 0** AND at least 2 of 3 step-diffs same sign. Catches noisy uptrends.
- `mode="slow"` (for ADX, OBV slope, BBand-width percentile): N=5, net slope > 0 only.
- `is_falling_n` is the symmetric counterpart.
- Returns `False` if `values` has < N non-None entries.

### 6.3 `recent_cross(values_a, values_b, timeframe) -> tuple[bool, int]`
Detects whether `values_a` crossed `values_b` within a timeframe-calibrated lookback window. Window calibration uses **underlying-bar counts** (see §13 — `AI_TIMEFRAME_MAP` configures 1H as 1-min and 4H as 5-min underlying bars):

| Displayed TF | Underlying bar | Lookback window (bars) | ≈ wall-clock |
|---|---|---|---|
| `D`, `W`, `M` | same | 5 | ~5 trading days/weeks/months |
| `4H` | 5-min | 48 | ~4 hours |
| `1H` | 1-min | 60 | ~1 hour |

Returns `(True, bars_ago)` if a cross occurred within the window, `(False, -1)` otherwise.

### 6.4 `percentile_rank(value, history, lookback=100) -> float`
For squeeze / BBand-width / volatility-percentile facts. Returns the current value's percentile against the last `lookback` bars of its own history.

### 6.5 No broad exception handling
Helpers raise on type errors. Builders catch only when wrapped in an explicit `if` guard. Pattern:

```python
# OK
if ind.values is None or len(ind.values) < 3:
    return []
latest = ind.values[-1]
if latest.value is None:
    return []
# ... use latest.value safely

# NOT OK (banned by spec)
try:
    return _build_macd_facts(ind, last, atr)
except Exception:
    return []
```

## 7. Fact roster per indicator family

This is the complete v1 fact vocabulary. Each entry lists the fact ID, polarity rule, and key `data` fields. Strengths in the table are defaults; builders may modulate ±15 based on numerical magnitude.

### 7.1 fibonacci

Replaces both `_format_fibonacci` (backend auto fibs) and `_format_fibs` (frontend-provided snapshots). One builder consumes either `FibonacciResult` or `FibonacciSnapshot` via a small internal adapter.

Actual retracement levels (from `backend/services/indicators.py:47`):
`[0.0, 0.382, 0.5, 0.618, 0.65, 0.716, 1.0]`. Golden pocket is `{0.618, 0.65, 0.716}` per `GOLDEN_POCKET_LEVELS`. There is no `0.236` and no `0.786` in v1 — the spec must not reference them.

| ID | Condition | Polarity | Strength | data |
|---|---|---|---|---|
| `{tf}.fibonacci.position_inside_swing` | price between swing low and swing high | neutral | 40 | `pct_into_swing` |
| `{tf}.fibonacci.position_above_swing` | price > swing_high in UP swing (extension territory) | bullish | 70 | `pct_above_swing_high` |
| `{tf}.fibonacci.position_below_swing` | price < swing_low in DOWN swing (extension territory) | bearish | 70 | `pct_below_swing_low` |
| `{tf}.fibonacci.in_golden_pocket` | price between the 0.618 and 0.716 levels (inclusive — GP spans the three middle ratios) | bullish (UP) / bearish (DOWN) | 80 | `level_0618`, `level_0650`, `level_0716` |
| `{tf}.fibonacci.near_golden_pocket` | within 0.5×ATR of the nearest GP boundary (0.618 or 0.716), not inside | neutral | 55 | `distance_atr`, `nearest_boundary_ratio` |
| `{tf}.fibonacci.price_near_<ratio>` | within 0.25×ATR of a retracement level. Ratio enum: `0382 / 0500 / 0618 / 0650 / 0716` | neutral | 60 | `level_price`, `distance_atr_or_pct` |
| `{tf}.fibonacci.away_from_levels` | no retracement level within near-threshold | neutral | 30 | `nearest_above`, `nearest_below` |
| `{tf}.fibonacci.target_extension_<ratio>` | price approaching a key extension. Ratio enum: `1272 / 1500 / 1618` | neutral | 50 | `target_price`, `distance_pct` |
| `{tf}.fibonacci.nested_inside_parent` | this swing is nested inside a higher-scoring parent | caution | 35 | `parent_score`, `parent_swing` |
| `{tf}.fibonacci.convergence_cross_tf` | cross-TF convergence detected by upstream pipeline | bullish (UP context) / bearish (DOWN context) | 75 | `convergence_price`, `timeframes` |

**Position logic (the original bug):** the builder first determines `position_*`. If the price is past the 1.0 swing level in the trend direction (`UP` swing: price > swing_high; `DOWN` swing: price < swing_low), emit `position_above_swing` / `position_below_swing` and **skip retracement-level near-checks entirely** — those levels aren't in play. This is the deterministic fix for the TSM case.

Retracement level dump is also trimmed: only `price_near_<ratio>` facts for levels actually near current price, plus one `away_from_levels` summary when nothing is in play.

### 7.2 ema

| ID | Condition | Polarity | Strength |
|---|---|---|---|
| `{tf}.ema.stack_bullish` | 9 > 21 > 50 > 200 (all available periods in descending order) | bullish | 85 |
| `{tf}.ema.stack_bearish` | 9 < 21 < 50 < 200 (inverse) | bearish | 85 |
| `{tf}.ema.stack_mixed` | not fully ordered | caution | 40 |
| `{tf}.ema.stack_incomplete` | missing one or more required EMA periods | neutral | 25 |
| `{tf}.ema.price_above_all` | price above every EMA | bullish | 70 |
| `{tf}.ema.price_below_all` | price below every EMA | bearish | 70 |
| `{tf}.ema.price_near_<period>` | `is_near(price, EMA[period], atr)` for any period | neutral | 55 |
| `{tf}.ema.cross_<short>_<long>_recent` | EMA short crossed EMA long within recency window | bullish (golden) / bearish (death) | 75 |

**Data on every EMA fact:** per-period table `{"period": 21, "value": 208.50, "distance_pct": 3.2}` for all available periods, so the fact text can read `"price 0.7% above EMA-9, 3.3% above EMA-21, 8.6% above EMA-50, 24.9% above EMA-200"`.

### 7.3 rsi

| ID | Condition | Polarity | Strength |
|---|---|---|---|
| `{tf}.rsi.above_50_rising` | RSI > 50 AND `is_rising_n(values, 3, momentum)` | bullish | 60 |
| `{tf}.rsi.above_50_falling` | RSI > 50 AND `is_falling_n(values, 3, momentum)` | neutral | 45 |
| `{tf}.rsi.below_50_falling` | RSI < 50 AND `is_falling_n(values, 3, momentum)` | bearish | 60 |
| `{tf}.rsi.below_50_rising` | RSI < 50 AND `is_rising_n(values, 3, momentum)` | neutral | 45 |
| `{tf}.rsi.overbought` | RSI > 70 | caution | 55 |
| `{tf}.rsi.oversold` | RSI < 30 | caution | 55 |
| `{tf}.rsi.cross_70_recent` | RSI crossed 70 within recency window | caution | 50 |
| `{tf}.rsi.cross_30_recent` | RSI crossed 30 within recency window | caution | 50 |
| `{tf}.rsi.cross_50_recent` | RSI crossed 50 within recency window — direction in `data.direction` ("up" / "down") | bullish (up) / bearish (down) | 45 |

Direction nuance ("mean-reversion long", "weakening", "trend confirmation") belongs in the fact `text` and `data`, never in polarity. Polarity is strictly one of the four literal values from §5.

Divergence detection is **deferred** (see §13).

### 7.4 macd

Two independent state matrices: the line-state and the histogram-state. Both emit one fact each per analysis (unless data missing).

**Line state** (line value vs signal line vs zero):

| Line vs Signal | Line vs Zero | Fact ID | Polarity | Strength |
|---|---|---|---|---|
| above | above zero | `{tf}.macd.line_bullish_impulse` | bullish | 75 |
| above | below zero | `{tf}.macd.line_bearish_improving` | neutral | 50 |
| below | above zero | `{tf}.macd.line_bullish_weakening` | neutral | 45 |
| below | below zero | `{tf}.macd.line_bearish_impulse` | bearish | 75 |

**Histogram state** (sign × direction):

| Hist vs Zero | Hist Direction (3-bar) | Fact ID | Polarity | Strength |
|---|---|---|---|---|
| above | rising | `{tf}.macd.hist_above_rising` | bullish | 70 |
| above | falling | `{tf}.macd.hist_above_falling` | neutral | 45 |
| below | rising | `{tf}.macd.hist_below_rising` | neutral | 50 |
| below | falling | `{tf}.macd.hist_below_falling` | bearish | 70 |
| `|hist|` < ε (1e-4) | — | (skip — no fact emitted) | — | — |

Plus `{tf}.macd.cross_recent` (line crosses signal within recency window) — `data.direction` carries `"up"` / `"down"`; polarity is `bullish` for an up-cross, `bearish` for a down-cross.

### 7.5 bbands

| ID | Condition | Polarity | Strength |
|---|---|---|---|
| `{tf}.bbands.squeeze` | band width < 25th percentile of last 100 bars | neutral | 65 |
| `{tf}.bbands.upper_band_walk` | 3+ closes in upper third of band | bullish | 60 |
| `{tf}.bbands.lower_band_walk` | 3+ closes in lower third of band | bearish | 60 |
| `{tf}.bbands.outside_upper` | last close > upper band | caution | 55 |
| `{tf}.bbands.outside_lower` | last close < lower band | caution | 55 |
| `{tf}.bbands.percent_b_<state>` | %B state enum: `under_0` / `0_20` / `80_100` / `over_100` | `caution` for `under_0` / `over_100`; `bearish` for `0_20`; `bullish` for `80_100` | 40 |

### 7.6 vwap

| ID | Condition | Polarity | Strength |
|---|---|---|---|
| `{tf}.vwap.price_above` | price > VWAP | bullish | 55 |
| `{tf}.vwap.price_below` | price < VWAP | bearish | 55 |
| `{tf}.vwap.reclaim_recent` | crossed up through VWAP within recency window | bullish | 65 |
| `{tf}.vwap.loss_recent` | crossed down through VWAP within recency window | bearish | 65 |
| `{tf}.vwap.distance_far` | `abs(price - vwap) / vwap > 1.5%` | caution | 40 |

### 7.7 atr

| ID | Condition | Polarity | Strength |
|---|---|---|---|
| `{tf}.atr.expanding` | ATR rising over 5 bars (slow mode) | neutral | 50 |
| `{tf}.atr.contracting` | ATR falling over 5 bars (slow mode) | neutral | 50 |
| `{tf}.atr.stop_distances` | always emits when ATR present: 1.5×ATR + 2.0×ATR raw distances | neutral | 30 |

`stop_distances` is informational — provides the model with concrete stop levels rather than the model computing them.

### 7.8 stoch

| ID | Condition | Polarity | Strength |
|---|---|---|---|
| `{tf}.stoch.k_above_d` | %K > %D | bullish | 50 |
| `{tf}.stoch.k_below_d` | %K < %D | bearish | 50 |
| `{tf}.stoch.cross_recent` | %K crossed %D within recency window — `data.direction` ("up" / "down") | bullish (up) / bearish (down) | 60 |
| `{tf}.stoch.overbought_exit` | %K crossed below 80 from above within recency window | bearish | 60 |
| `{tf}.stoch.oversold_exit` | %K crossed above 20 from below within recency window | bullish | 60 |

### 7.9 obv

| ID | Condition | Polarity | Strength |
|---|---|---|---|
| `{tf}.obv.rising` | OBV rising over 5 bars (slow mode) | bullish | 55 |
| `{tf}.obv.falling` | OBV falling over 5 bars (slow mode) | bearish | 55 |
| `{tf}.obv.divergence_bullish` | price made lower low, OBV made higher low (within lookback) | bullish | 70 |
| `{tf}.obv.divergence_bearish` | price made higher high, OBV made lower high | bearish | 70 |

Divergence requires enough history; emit only when last 20 bars yield identifiable swing points.

### 7.10 adx

| ID | Condition | Polarity | Strength |
|---|---|---|---|
| `{tf}.adx.strong_rising` | ADX > 25 AND rising over 5 bars | neutral | 65 |
| `{tf}.adx.strong_falling` | ADX > 25 AND falling | caution | 50 |
| `{tf}.adx.weak` | ADX < 20 | neutral | 45 |

ADX measures **trend strength, not direction** — polarity is `neutral` because the same ADX value confirms an uptrend or a downtrend depending on price action. Fact text says so explicitly ("ADX 32 and rising — strong-trend confirmer, direction taken from price/EMA stack"). `+DI` / `-DI` directional facts deferred (see §13).

### 7.11 volume

| ID | Condition | Polarity | Strength |
|---|---|---|---|
| `{tf}.volume.surge_up` | volume ≥ 1.5× MA AND last candle bullish (close > open) | bullish | 60 |
| `{tf}.volume.surge_down` | volume ≥ 1.5× MA AND last candle bearish (close < open) | bearish | 60 |
| `{tf}.volume.dry_up` | volume < 0.5× MA | neutral | 35 |

Volume facts describe the candle/volume pairing on its own — they do **not** consult other indicators' polarity. The previous draft's `confirm_*` / `contradict_*` pair conflated the same condition under different names and required cross-indicator context that doesn't exist in a single-family builder.

"Rejection volume" (large bearish candle on high volume at a key level) is a *cross-indicator confluence* — emerges from `volume.surge_down` + `fibonacci.in_golden_pocket` + the model reading both. Explicit confluence facts are v2 (see `parallax-v2-roadmap` §2).

## 8. Rendered prompt shape

The renderer produces this exact format per timeframe (whitespace is significant for cache stability — see §11):

```
=== {SYMBOL} — {TF} Timeframe ===
Price: ${close} ({change_pct:+.2f}% intraday). ATR(14): ${atr}.

Verified Facts:
  {tf}.{indicator}.{condition}      [{polarity}, strength {n}] {text}
  ...

Cautions:
  {tf}.{indicator}.{condition}      [caution, strength {n}] {text}
  ...
```

If no caution facts fire, render `Cautions: (none)` so the model cannot wonder if a check was skipped. Same for an empty `Verified Facts:` block (render `Verified Facts: (none)`).

Multi-timeframe analyses repeat the block per timeframe, separated by a single blank line. Existing `=== {SYMBOL} — {TF} Timeframe ===` separator is preserved.

**Sort key for facts within a block:** `(priority desc, timeframe weight desc, strength desc, recency desc)`. `timeframe weight` reuses the existing `_TIMEFRAME_WEIGHT` dict in `prompt_builder.py`.

**Indicator priority interaction (user-set):** When the request carries `indicator_priority`, facts whose `indicator` field appears earlier in the priority list receive a `+20` boost to their effective sort priority. This pulls user-prioritized indicators to the top without changing the static priority constants. When `indicator_priority` is `None`, default sort applies.

## 9. Truncation by value (Task 8)

`truncate_by_value(blocks: list[PromptContextBlock], budget_tokens: int) -> list[PromptContextBlock]`:

Operates on the **structured intermediate** from §4, not on rendered text. Each `PromptContextBlock` still has typed `facts` (with `priority`, `polarity`, `strength`), so drop decisions can be made on metadata. Rendering happens *after* truncation.

1. Compute total token estimate by calling the existing `_estimate_tokens` helper (2.8 chars/token) on a *pre-render* estimate: sum of `header_line` length + per-fact rendered length + optional `chart_context` length.
2. If under budget, return as-is.
3. Drop order:
   - **(a)** `chart_context` on each block (`summary` / `ohlcv` / `patterns` — these come from the legacy chart-context helpers). Drop the lowest-`_TIMEFRAME_WEIGHT` timeframe's chart-context first, then proceed up. Whole field, not partial.
   - **(b)** Lowest-scoring **neutral** facts across all timeframes (score = `priority × tf_weight × strength`). Pop from `block.facts`. Stop when under budget.
   - **(c)** Entire lowest-priority `PromptContextBlock` (using `_TIMEFRAME_WEIGHT`), oldest TF first within ties — but only down to the protected set in step 4.
4. **Never droppable** while any other category remains:
   - Any block's `header_line`.
   - All facts on the highest-`_TIMEFRAME_WEIGHT` timeframe with polarity ≠ neutral.
   - All `caution` polarity facts (across all timeframes).
5. After dropping, attach a single `omitted_note: str` field on the returned block list (e.g., `"[Omitted: 4H chart context, 7 neutral facts — over budget by ~412 tokens]"`). The renderer appends this as one line after the last block. Keeps the model informed without leaking metadata into the truncation loop.

Tests assert that for a tight budget (1800 tokens / e2b tier), the TSM extension fixture still emits `D.fibonacci.position_above_swing` even when raw chart context is dropped.

## 10. Ollama context introspection (Task 2 — minimal)

New module: `backend/services/ollama_context.py`.

```python
class OllamaContextService:
    def __init__(self, http_client, lifecycle): ...

    async def get_model_max_context(self, model: str) -> Optional[int]:
        """
        Call POST /api/show with body {"model": model} (the Ollama API uses
        "model", not "name" — see https://github.com/ollama/ollama/blob/main/docs/api.md#show-model-information).
        Walk the response's model_info dict for any key ending in
        ".context_length" — this is the model's MAXIMUM trainable context,
        not the runtime-allocated context.
        Also check the top-level "parameters" string for a "num_ctx <N>" line
        if the user has pinned a smaller default via a Modelfile.
        Cache result per-model on the instance.
        Return None on connection error / missing field / non-2xx.
        """

    async def get_budget_for_model(self, model: str) -> int:
        """
        Single source of budget truth. Async because it awaits the cached
        /api/show lookup on first call per model.

        Logic:
          model_max = await self.get_model_max_context(model)  # ceiling, not allocation
          static_budget = _static_budget_for_model(model)       # fallback tier
          if model_max is None:
              return static_budget                              # Ollama unreachable / metadata missing
          # Treat model_max as a CEILING. Do NOT raise the budget above the
          # static tier just because the model could in theory accept more —
          # the runtime might be loaded with a smaller num_ctx, and we have
          # no way to know that without /api/ps (deferred). Clamp instead.
          return min(static_budget, int(model_max * 0.7))       # 30% reserve
        """
```

`get_budget_for_model` becomes the **single source of budget truth**. The existing module-level `get_budget_for_model` in `prompt_builder.py` is renamed `_static_budget_for_model` and used only as the fallback / ceiling-clamp input.

**Why "ceiling, not allocation":** `/api/show`'s `context_length` is the model's max-trainable context. The Ollama runtime may have loaded the model with a smaller `num_ctx` (default 4096 on many builds, user-overridable). Until `/api/ps` runtime introspection lands (deferred), assuming the bigger number causes the prompt to overflow the runtime allocation silently. Use the static tier as the authoritative budget and only let `/api/show` *lower* it.

**Caching:** Per-model `context_length` results cached on the instance. No TTL (model context windows are immutable per model version). Cache invalidated when Ollama is restarted (next `get_model_max_context` returns None → falls through to fallback).

**Dependency injection:** `OllamaContextService` is constructed once in `backend/main.py` alongside the existing `OllamaLifecycle` / `OllamaService` wiring and passed into `AiService` via its constructor. `AiService._prepare_analysis_session` becomes async because it must `await self._ollama_context.get_budget_for_model(model)`. **Budget logic does NOT live in `routers/ai.py`** — the router stays thin per backend conventions.

**Out of scope:** `/api/ps` runtime-loaded-context lookup (the real fix for the ceiling-vs-allocation problem above), `prompt_eval_count` / `eval_count` metric capture, latency dashboards. Deferred to a Task 2-full follow-up spec.

## 11. Prompt layout & cache stability (Task 11)

Ollama's prompt cache keys on byte-stable prefixes. The current builder leaks volatile content (set-iteration order in `INDICATOR_HINTS`, display-name variants, indicator order driven by upstream dict) into the system prompt.

Changes:
1. **`build_system_prompt` accepts a backend indicator name list** (not display names). Display names are used only in the `build_analysis_user_message` "Indicators provided: …" line. `AiService.analyze()` receives both `indicators_display` and `indicator_names`; router passes them through cleanly.
2. **`INDICATOR_HINTS` rendered in canonical order**, not set-iteration order. Canonical order: `fibonacci, ema, rsi, macd, volume, bbands, vwap, atr, stoch, obv, adx`. Stored as an ordered tuple, not a set.
3. **System base prompt is byte-stable** — fix the existing contradiction (the line "you do NOT need to include JSON in your narrative response" conflicts with the user message asking for inline JSON). Resolution for this branch: **remove the contradictory line from `_SYSTEM_BASE`**. Inline JSON remains required (until the deferred Task 10 reverses that).
4. **Volatile content (prices, fact values) appears strictly after the static system prompt and static hint block.** Header and `Verified Facts` block live in the user message, not the system.
5. Labels are byte-identical across requests: `Verified Facts:` (capital V, capital F, colon-space). Indicator-family names lowercase. Whitespace inside the block: exactly two-space indent for each fact line.

## 12. Display vs backend name separation

`AiService.analyze()` and `AiService.analyze_stream()` gain a second indicator parameter:

```python
async def analyze(
    self,
    symbol: str,
    timeframe_data: dict[str, dict],
    indicators_display: list[str],    # NEW — UI labels, e.g. ["EMA Stack", "RSI"]
    indicator_names: list[str],       # was indicators_requested — backend names
    model: str,
    ...
):
```

- `indicators_display` → `build_analysis_user_message(... indicators_requested=indicators_display ...)` for the "Indicators provided: EMA Stack, RSI" line.
- `indicator_names` → `build_system_prompt(indicators=indicator_names ...)` for the hint-selection logic and fact builders.

The router (`routers/ai.py:418`) already computes `resolved_indicators` from `_resolve_indicators(request.indicators)`. Pass both into `AiService.analyze`. No backwards-compat shim — sweep confirmed only `services/ai.py` calls into the prompt builder, and routers/tests can be updated in lock-step.

## 13. Known limitations accepted by this branch

These are documented here so the next contributor doesn't have to rediscover them.

1. **Signal card is not yet trustworthy.** The inline JSON block can still contain fabricated confirmations and risk/reward. The model is grounded in facts for *narrative*, but JSON output is not yet constrained by fact IDs. The follow-up "Verified Signal Contract" spec is the explicit fix.
2. **1H / 4H bars are not true hourly / 4-hour candles.** `AI_TIMEFRAME_MAP` at `backend/routers/ai.py:71-73` configures them as 1-min and 5-min underlying bars. All "recent" lookbacks in §6.3 use **underlying-bar counts** calibrated to roughly one displayed-bar of wall-clock. A future task can either resample to true 1H/4H or pick longer lookbacks; for now the documented semantics are explicit.
3. **RSI / OBV divergence detection** is shallow. v1 emits divergence facts only when last 20 bars yield clear swing points. A v2 spec can add proper pivot-based divergence.
4. **ADX direction (+DI / -DI)** is not computed. ADX-strength facts emit as "trend confirmer" without direction. This is a Polars-side computation upgrade tracked separately.
5. **Cache stability is best-effort.** The Ollama cache hit rate is observable but not asserted by tests in this branch. Performance follow-up may add `prompt_eval_count` capture to confirm.
6. **No frontend priority UI.** API field exists; UI control is a deferred follow-up.

## 14. File map

### Files created

```
backend/services/prompt_facts/
├── __init__.py                   # build_prompt_facts() dispatcher, public API
├── _common.py                    # is_near, is_rising_n, is_falling_n, recent_cross, percentile_rank
├── types.py                      # PromptFact pydantic model, Polarity literal
├── fibonacci.py                  # build_facts(fib_result | fib_snapshot, last, atr) → list[PromptFact]
├── ema.py
├── rsi.py
├── macd.py
├── bbands.py
├── vwap.py
├── atr.py
├── stoch.py
├── obv.py
├── adx.py
└── volume.py                     # — 11 family modules + __init__ + _common + types = 14 files

backend/services/ollama_context.py

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
backend/tests/test_prompt_facts_common.py    # _common.py helpers
backend/tests/test_prompt_facts_dispatcher.py  # build_prompt_facts dispatcher, sort order, priority interaction
backend/tests/test_prompt_builder_facts.py    # end-to-end rendered prompt — replaces existing assertions in test_ai_with_fibs.py
backend/tests/test_ollama_context.py
backend/tests/test_truncate_by_value.py

backend/tests/fixtures/prompt_facts/
├── tsm_extension_d.json          # TSM in extension territory — the canonical bug case
├── nvda_inside_swing_d.json      # NVDA inside a swing, multiple levels in play
├── aapl_golden_pocket_d.json     # AAPL price inside golden pocket
├── aapl_squeeze_4h.json          # BBand squeeze fixture
└── multi_tf_aapl.json            # Multi-timeframe (1H + 4H + D + W) for truncation tests
```

### Files modified

```
backend/services/prompt_builder.py
  - Delete all _format_* private functions (rsi, macd, ema, bbands, vwap, atr, stoch, obv, adx, volume, fibonacci, fibs)
  - Delete INDICATOR_FORMATTERS dict and _get_formatter
  - Delete _sort_indicators (replaced by fact-level sort)
  - Rewrite build_indicator_context to delegate to prompt_facts
  - Rewrite truncate_context to call truncate_by_value (new value-scored truncation)
  - Rename get_budget_for_model → _static_budget_for_model (now fallback-only)
  - Convert INDICATOR_HINTS iteration to canonical-ordered tuple
  - Remove the "you do NOT need to include JSON" line from _SYSTEM_BASE
  - Keep _build_price_summary / _build_ohlcv_history / _build_pattern_context / _detect_candlestick_patterns UNTOUCHED
  - Keep watchlist framing UNTOUCHED

backend/services/ai.py
  - Delete the SIGNAL_EXTRACTION_PROMPT and SIGNAL_JSON_SCHEMA re-exports (sweep-confirmed unused)
  - AiService.__init__: accept OllamaContextService via constructor injection
  - _prepare_analysis_session: async, awaits self._ollama_context.get_budget_for_model
  - analyze() / analyze_stream(): accept indicators_display + indicator_names (was indicators_requested)
  - Pass display vs backend names to build_analysis_user_message and build_system_prompt respectively

backend/services/ollama.py
  - OllamaLifecycle.show_model(model) — POST /api/show with {"model": model}, returns model_info dict (or None on failure)
  - (Out of scope: prompt_eval_count capture, /api/ps lookup)

backend/main.py
  - Construct OllamaContextService alongside existing OllamaLifecycle / OllamaService
  - Pass into AiService constructor
  - (Without this wiring AiService can't obtain the budget service — the spec is incomplete without main.py being on the modified list)

backend/routers/ai.py
  - analyze and analyze_stream endpoints pass both request.indicators (display) and resolved_indicators (backend) into AiService
  - No budget logic in this file

backend/models/__init__.py
  - No changes. PromptFact lives in services/prompt_facts/types.py, not here.

backend/pyproject.toml
  - Add: syrupy>=4.6.0 under [dependency-groups].dev (PEP 735 — the project already uses this layout; do not add under [project.optional-dependencies])

backend/uv.lock
  - Regenerated for syrupy and its deps

src/components/ai/AiConfigPanel.tsx
  - Add "ATR" to INDICATORS tuple (one-line change)
  - Add "ATR" to AiIndicator union type
  - Update existing AiConfigPanel.test.tsx to include ATR in the option list assertion
```

### Files affected by test rewrite

```
backend/tests/test_ai_with_fibs.py
  - Existing assertions on "Primary fib" / "Locked fib #1" / "Source: MANUAL" are obsolete
  - Replace with assertions on D.fibonacci.position_*, D.fibonacci.in_golden_pocket etc., consuming the new rendered prompt block
  - Test scenarios preserved; only the assertion targets change

backend/tests/test_prompt_budget.py
  - get_budget_for_model is now in OllamaContextService.get_budget_for_model
  - Update imports; semantics of the test preserved (per-tier fallback when /api/show unreachable)
```

## 15. Test impact summary

Risk-categorized from the codebase sweep:

- **HIGH (must rewrite):** `test_ai_with_fibs.py` — asserts on deprecated fib section strings. Rewrite to assert on fact IDs.
- **MEDIUM (must update imports / call sites):**
  - `test_prompt_budget.py` — budget function moves to `OllamaContextService` and becomes async. Update imports; semantics preserved.
  - `test_ai_timeout.py` — does **not** assert on indicator format, but it constructs `AiService` and calls `analyze()`. Both signatures change (`OllamaContextService` constructor arg; `indicators_display` + `indicator_names` split). Update setup and call sites.
  - `test_ai_warmup.py` — same situation as `test_ai_timeout.py` if it instantiates `AiService` directly.
- **LOW (unchanged):** `test_chart_context.py`, `test_ai_confidence.py` — none cross-import the deleted formatters and none touch the changed AiService surface.

## 16. Eval harness (Task 13)

Add `syrupy>=4.6.0` as a test dependency. Use it for the end-to-end rendered prompt tests:

```python
# backend/tests/test_prompt_builder_facts.py
def test_tsm_extension_renders_correctly(snapshot):
    tf_data = load_fixture("tsm_extension_d.json")
    rendered = build_multi_timeframe_context("TSM", {"D": tf_data})
    assert rendered == snapshot

    # Explicit "no false fact" assertions — outside the snapshot
    assert "D.fibonacci.position_above_swing" in rendered
    assert "D.fibonacci.price_near_0500" not in rendered
    assert "0.5 retracement" not in rendered.lower()
```

Snapshots auto-stored under `backend/tests/__snapshots__/`. Updating intentional format changes: `uv run pytest --snapshot-update`. The snapshot diff is reviewed in PR like normal code.

Per-family tests in `test_prompt_facts_<family>.py` use plain assertions (faster to write, clearer failures for single-fact regressions). Syrupy is reserved for the integration-level rendered output where surface area is large.

## 17. Out of scope (explicit)

For clarity to the next contributor:

- **Tasks 9 and 10 from the originating game plan** — verified signal contract, structured extraction reversal, reasoning_steps removal. These get their own spec; this branch leaves the inline-JSON signal contract untouched.
- **Frontend priority UI** — `indicator_priority` field exists in the API; this branch does not add a UI control.
- **Full Task 2** — `/api/ps`, eval-count metric capture, latency observability.
- **True hourly / 4-hour candle resampling.**
- **Divergence detection beyond shallow swing-point comparison.**
- **ADX +DI / -DI directional facts.**
- **Cross-indicator confluence as standalone facts** (e.g., "fib 0.618 sits on EMA-21"). Confluence falls out of multiple facts firing on the same level for now; explicit confluence is a v2 item per `parallax-v2-roadmap` §2.

## 18. Acceptance checklist

Before this branch merges:

- [ ] TSM extension fixture: `D.fibonacci.position_above_swing` appears, `0.5 retracement` does not.
- [ ] Every enabled indicator emits at least one fact per timeframe **when computable values are present** (skipping is allowed when data is missing — e.g., RSI with < 14 bars history; volume facts when MA hasn't filled yet).
- [ ] Identical inputs produce byte-identical rendered prompts (deterministic sort, canonical hint order).
- [ ] Tight-budget truncation preserves caution facts and primary-timeframe non-neutral facts.
- [ ] `/api/show` fallback path tested (Ollama offline → static tier budget used).
- [ ] `test_ai_with_fibs.py` rewritten; `test_prompt_budget.py` updated; all other AI tests pass unchanged.
- [ ] Frontend `AiConfigPanel.tsx` exposes ATR; existing test updated.
- [ ] `syrupy` dep added, snapshots committed, `pytest --snapshot-update` workflow documented in the PR description.
- [ ] Spec known-limitations section is honest about what this branch does *not* fix.
