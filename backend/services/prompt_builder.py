"""
Prompt builder — assembles structured context for AI analysis.

This module handles five things:
  1. Per-indicator formatting via a registration pattern (no if/elif chain)
  2. Dynamic system prompt that adapts to the enabled indicator set
  3. Watchlist-aware framing when the ticker comes from a specific watchlist
  4. Prompt length budget + graceful truncation
  5. Structured user message builder (analysis guidance, timeframe weighting)

Architecture:
  Each indicator has a formatter function registered in INDICATOR_FORMATTERS.
  To add a new indicator (e.g., Ichimoku), just write a new format_xxx
  function and add it to the registry dict. No touching the core builder logic.

Prompt budget:
  Smaller models (e2b, e4b) have limited context windows. We estimate
  token count ≈ chars/2.8 (tuned for financial data density) and truncate
  the oldest timeframe data first if the prompt exceeds the budget.

Signal extraction:
  The AI service uses a two-call approach:
    Call 1 (narrative): free-text analysis with reasoning
    Call 2 (signal): structured JSON via Ollama's format parameter
  This guarantees valid JSON and lets the model reason before committing
  to a signal (chain-of-thought before structured output).
"""

import datetime
import logging
from typing import Optional

from models import CandleData, IndicatorResult, FibonacciResult

log = logging.getLogger("parallax.prompt")


# ═══════════════════════════════════════════════════════════════
#  Prompt Length Budget
# ═══════════════════════════════════════════════════════════════

# Default budget in estimated tokens. Ollama models vary from 2K to 128K
# context, but the actual usable budget for the prompt + system + response
# is much smaller. We target ~3500 tokens for the indicator context as a
# safe default (leaves room for system prompt, chat history, and model
# output). Per-model overrides live in _MODEL_BUDGETS below.
DEFAULT_CONTEXT_BUDGET = 3500

# Approximate chars per token for financial data.
# Standard English prose is ~4 chars/token, but financial data is denser:
# prices like "$185.20", indicator values, percentages — these tokenize
# at roughly 1 token per 2-3 chars. Using 2.8 prevents underestimating
# token usage that leads to silent context overflow on smaller models.
CHARS_PER_TOKEN = 2.8


def _estimate_tokens(text: str) -> int:
    """Rough token estimate from character count."""
    return int(len(text) / CHARS_PER_TOKEN)


# ── Per-model token budgets ─────────────────────────────────
#
# Parallax supports the full Ollama model zoo, but tiny models (gemma3:e2b)
# and heavyweights (gemma3:31b, qwen2.5:72b) have wildly different usable
# context windows. A 3K flat default is wasteful on beefy models and
# dangerous on light ones — the prompt grows with every enabled indicator
# × every timeframe, and Fibonacci output (which includes swing candidates
# with full scoring breakdowns) is particularly heavy.
#
# Tiers are keyed by substrings that appear in typical Ollama model names.
# Unknown models fall back to DEFAULT_CONTEXT_BUDGET. The lookup is
# lowercase + substring-match so "gemma3:e2b-instruct-q4_K_M" still hits
# the "e2b" tier.
#
# These are context budgets for the indicator context block only, NOT the
# model's advertised total context window. The remaining model context is
# reserved for the system prompt, conversation history, and the response.

# Order matters: larger / more specific tiers must come first so substring
# matching doesn't collapse "27b" onto "7b". "e2b" / "e4b" are listed early
# because they're unambiguous two-character tokens unique to tiny Gemma.
_MODEL_BUDGETS: list[tuple[str, int]] = [
    # Tiniest Gemma variants — aggressive truncation, keep only essentials
    ("e2b",   1800),
    ("e4b",   2800),
    # Heavyweight first (so "70b" hits before "7b", "27b" before "7b", etc.)
    ("72b",   9500),
    ("70b",   9500),
    ("32b",   7000),
    ("31b",   7000),
    ("27b",   5500),
    ("26b",   5500),
    ("14b",   4000),
    ("13b",   4000),
    # 7-8B class comes last because its tokens are short substrings of
    # the larger-tier tokens above.
    ("8b",    3500),
    ("7b",    3500),
]


def get_budget_for_model(model: Optional[str]) -> int:
    """
    Return the estimated-token budget for the indicator context block,
    scaled to the capability of the user's selected Ollama model.

    Matching is case-insensitive substring against _MODEL_BUDGETS tiers,
    first hit wins (tiers are ordered smallest → largest so "2b" doesn't
    eat "e2b" etc.). Falls back to DEFAULT_CONTEXT_BUDGET for unknown
    models, local custom builds, or None.
    """
    if not model:
        return DEFAULT_CONTEXT_BUDGET
    name = model.lower()
    for tier, budget in _MODEL_BUDGETS:
        if tier in name:
            return budget
    return DEFAULT_CONTEXT_BUDGET


# ═══════════════════════════════════════════════════════════════
#  Per-Indicator Formatters
# ═══════════════════════════════════════════════════════════════
#
# Each formatter takes (indicator, last_candle) and returns a list of
# formatted lines. Returning an empty list means "skip this indicator."
#
# The last_candle is provided so formatters can show price-relative
# context (e.g., "EMA(50): $185.20 [Price ABOVE]").


def _format_rsi(ind: IndicatorResult, last: CandleData) -> list[str]:
    latest = ind.values[-1]
    val = latest.value
    if val is None:
        return [f"RSI(14): N/A"]
    zone = "OVERSOLD" if val < 30 else "OVERBOUGHT" if val > 70 else "NEUTRAL"
    return [f"RSI(14): {val:.1f} [{zone}]"]


def _format_macd(ind: IndicatorResult, last: CandleData) -> list[str]:
    latest = ind.values[-1]
    if latest.value is None:
        return ["MACD: N/A"]
    hist_label = "BULLISH" if latest.histogram and latest.histogram > 0 else "BEARISH"
    return [
        f"MACD: Line={latest.value:.4f}, Signal={latest.signal:.4f}, "
        f"Histogram={latest.histogram:.4f} [{hist_label}]"
    ]


def _format_ema(ind: IndicatorResult, last: CandleData) -> list[str]:
    period = ind.name.split("_")[1]
    latest = ind.values[-1]
    val = latest.value
    if val is None:
        return [f"EMA({period}): N/A"]
    pos = "ABOVE" if last.close > val else "BELOW"
    return [f"EMA({period}): ${val:.2f} [Price {pos}]"]


def _format_bbands(ind: IndicatorResult, last: CandleData) -> list[str]:
    latest = ind.values[-1]
    if latest.value is None:
        return ["Bollinger Bands: N/A"]
    lines = [
        f"Bollinger Bands: Upper=${latest.upper:.2f}, "
        f"Middle=${latest.value:.2f}, Lower=${latest.lower:.2f}"
    ]
    if latest.upper and latest.lower and latest.value:
        width = (latest.upper - latest.lower) / latest.value * 100
        lines.append(f"  Band Width: {width:.1f}%")
    return lines


def _format_vwap(ind: IndicatorResult, last: CandleData) -> list[str]:
    latest = ind.values[-1]
    val = latest.value
    if val is None:
        return ["VWAP: N/A"]
    pos = "ABOVE" if last.close > val else "BELOW"
    return [f"VWAP: ${val:.2f} [Price {pos}]"]


def _format_atr(ind: IndicatorResult, last: CandleData) -> list[str]:
    latest = ind.values[-1]
    if latest.value is None:
        return ["ATR(14): N/A"]
    return [f"ATR(14): ${latest.value:.2f}"]


def _format_stoch(ind: IndicatorResult, last: CandleData) -> list[str]:
    latest = ind.values[-1]
    if latest.value is None:
        return ["Stochastic: N/A"]
    zone = (
        "OVERSOLD" if latest.value < 20
        else "OVERBOUGHT" if latest.value > 80
        else "NEUTRAL"
    )
    return [
        f"Stochastic: %K={latest.value:.1f}, %D={latest.signal:.1f} [{zone}]"
    ]


def _format_obv(ind: IndicatorResult, last: CandleData) -> list[str]:
    latest = ind.values[-1]
    if latest.value is None:
        return ["OBV: N/A"]
    return [f"OBV: {latest.value:,.0f}"]


def _format_adx(ind: IndicatorResult, last: CandleData) -> list[str]:
    latest = ind.values[-1]
    val = latest.value
    if val is None:
        return ["ADX(14): N/A"]
    strength = "STRONG TREND" if val > 25 else "WEAK/NO TREND"
    return [f"ADX(14): {val:.1f} [{strength}]"]


def _format_volume(ind: IndicatorResult, last: CandleData) -> list[str]:
    latest = ind.values[-1]
    if latest.value is None:
        return ["Volume: N/A"]
    if latest.signal:
        ratio = latest.value / latest.signal if latest.signal else 0
        label = "ABOVE AVG" if ratio > 1.0 else "BELOW AVG"
        return [
            f"Volume: {latest.value:,.0f} (MA: {latest.signal:,.0f}, "
            f"Ratio: {ratio:.2f}x) [{label}]"
        ]
    return [f"Volume: {latest.value:,.0f}"]


def _format_fibonacci(
    fibonacci: FibonacciResult,
    last: CandleData,
) -> list[str]:
    """
    Format a FibonacciResult for the LLM prompt.

    Emits a structured block covering the active swing, both level sets
    (retracement + extension), scoring breakdown, timeframe clarity, and
    any cross-TF convergence zones detected upstream. This is intentionally
    dense — the LLM uses this as the canonical fib view when building its
    narrative analysis.
    """
    lines: list[str] = ["", f"Fibonacci ({fibonacci.direction.upper()} swing):"]
    lines.append(
        f"  Swing: ${fibonacci.swing_low:.2f} → ${fibonacci.swing_high:.2f} "
        f"  Score: {fibonacci.score:.1f}/100  Clarity: {fibonacci.swing_clarity:.2f}  "
        f"TF: {fibonacci.timeframe_clarity}"
    )
    if fibonacci.is_nested:
        lines.append("  [NESTED inside a higher-scoring parent fib]")

    # Retracement levels — with NEAR marker and GP tag
    if fibonacci.levels:
        lines.append("  Retracement:")
        for level in fibonacci.levels:
            proximity = abs(last.close - level.price) / last.close * 100 if last.close > 0.01 else 0
            marker = " ← NEAR" if proximity < 1.0 else ""
            gp_tag = " [GP]" if level.golden_pocket else ""
            lines.append(f"    {level.label}: ${level.price:.2f}{gp_tag}{marker}")

    # Extension levels — compact, only show the most-watched ones
    if fibonacci.extensions:
        key_ratios = {1.272, 1.414, 1.5, 1.618, 2.0}
        key_exts = [e for e in fibonacci.extensions if e.level in key_ratios]
        if key_exts:
            lines.append("  Extension targets:")
            for level in key_exts:
                lines.append(f"    {level.label}: ${level.price:.2f}")

    # Cross-TF convergences (populated by the AI service post-hoc)
    if fibonacci.convergence_zones:
        lines.append("  Cross-TF convergences:")
        for zone in fibonacci.convergence_zones:
            price = zone.get("price", "?")
            tfs = zone.get("timeframes", [])
            lines.append(f"    ~${price} — {', '.join(tfs)}")

    # Reasoning is short — include it verbatim so the LLM can cite it
    if fibonacci.reasoning:
        lines.append(f"  Reasoning: {fibonacci.reasoning}")

    return lines


# ── Registry ────────────────────────────────────────────────
#
# Maps indicator name → formatter function.
# EMA variants all share one formatter (matched by prefix in the lookup).

INDICATOR_FORMATTERS: dict[str, callable] = {
    "rsi":    _format_rsi,
    "macd":   _format_macd,
    "bbands": _format_bbands,
    "vwap":   _format_vwap,
    "atr":    _format_atr,
    "stoch":  _format_stoch,
    "obv":    _format_obv,
    "adx":    _format_adx,
    "volume": _format_volume,
}

# EMA variants share one formatter — resolved by prefix
_EMA_PREFIX = "ema_"


def _get_formatter(indicator_name: str):
    """Look up a formatter by indicator name (with EMA prefix fallback)."""
    if indicator_name in INDICATOR_FORMATTERS:
        return INDICATOR_FORMATTERS[indicator_name]
    if indicator_name.startswith(_EMA_PREFIX):
        return _format_ema
    return None


# ═══════════════════════════════════════════════════════════════
#  Chart Context Builders (optional — selected by user per run)
# ═══════════════════════════════════════════════════════════════
#
# These three functions append raw price history to the indicator context.
# Each is gated by the user's context_mode selection in the AI panel.
# They add token cost in proportion to context_bars — the user is warned
# in the UI about the trade-off.


def _build_price_summary(candles: list[CandleData], n_bars: int) -> str:
    """
    Mode "summary" — compact recent-close series + price action blurb.

    Gives the model a directional sense of recent price action without
    flooding the context with raw OHLCV tables. Token cost: ~+5%.

    Detects:
      - Consecutive higher / lower closes (momentum direction)
      - Whether price is near the n-bar high or low
    """
    bars = candles[-n_bars:] if len(candles) >= n_bars else candles
    if not bars:
        return ""

    closes = [b.close for b in bars]
    high_n = max(b.high for b in bars)
    low_n = min(b.low for b in bars)
    current = closes[-1]

    # Count consecutive higher or lower closes from the right
    streak_dir = "flat"
    streak_count = 0
    for i in range(len(closes) - 1, 0, -1):
        diff = closes[i] - closes[i - 1]
        if abs(diff) < 0.001:
            break
        if i == len(closes) - 1:
            streak_dir = "higher" if diff > 0 else "lower"
            streak_count = 1
        elif (diff > 0 and streak_dir == "higher") or (diff < 0 and streak_dir == "lower"):
            streak_count += 1
        else:
            break

    # Price position within n-bar range
    range_span = high_n - low_n
    if range_span > 0:
        pct_of_range = (current - low_n) / range_span * 100
        if pct_of_range >= 80:
            position = "near the period high"
        elif pct_of_range <= 20:
            position = "near the period low"
        else:
            position = f"{pct_of_range:.0f}% through the period range"
    else:
        position = "in a flat range"

    close_str = " → ".join(f"{c:.2f}" for c in closes)

    lines = [
        "",
        f"Price Summary (last {len(bars)} bars):",
        f"  Closes: {close_str}",
        f"  Period range: ${low_n:.2f} – ${high_n:.2f}",
        f"  Current price {position}",
    ]

    if streak_count >= 2:
        lines.append(f"  Momentum: {streak_count} consecutive {streak_dir} closes")
    elif streak_dir != "flat":
        lines.append(f"  Momentum: 1 {streak_dir} close (direction unclear)")

    return "\n".join(lines)


def _build_ohlcv_history(candles: list[CandleData], n_bars: int) -> str:
    """
    Mode "ohlcv" — compact OHLCV table for the last n_bars bars.

    Enables the model to reason about patterns, ranges, and volume
    spikes that indicators don't capture. High token cost: ~+25-40%.
    Only recommended for models ≥7B.

    Format: DATE: O=X H=X L=X C=X V=XM (oldest → newest)
    """
    bars = candles[-n_bars:] if len(candles) >= n_bars else candles
    if not bars:
        return ""

    lines = [
        "",
        f"OHLCV History (last {len(bars)} bars, oldest → newest):",
    ]

    for bar in bars:
        # Unix timestamp → date string (UTC)
        try:
            date_str = datetime.datetime.utcfromtimestamp(bar.time).strftime("%Y-%m-%d")
        except (OSError, OverflowError, ValueError):
            date_str = f"t={bar.time}"

        vol_m = bar.volume / 1_000_000
        direction = "▲" if bar.close >= bar.open else "▼"
        lines.append(
            f"  {date_str} {direction}: "
            f"O={bar.open:.2f} H={bar.high:.2f} L={bar.low:.2f} C={bar.close:.2f} "
            f"V={vol_m:.1f}M"
        )

    return "\n".join(lines)


def _detect_candlestick_patterns(
    candles: list[CandleData],
    n_bars: int,
) -> list[tuple[int, str]]:
    """
    Detect common candlestick patterns in the last n_bars candles.

    Returns a list of (unix_timestamp, pattern_name) pairs.
    No TA-Lib or external deps — direct OHLCV math only.

    Patterns detected:
      - Doji (body < 10% of range)
      - Hammer / Bearish Hammer (long lower shadow, small body)
      - Shooting Star (long upper shadow, small body)
      - Bullish Engulfing / Bearish Engulfing
      - Inside Bar (consolidation — full bar inside prior bar)
    """
    bars = candles[-n_bars:] if len(candles) >= n_bars else candles
    findings: list[tuple[int, str]] = []

    for i, bar in enumerate(bars):
        full_range = bar.high - bar.low
        if full_range < 0.0001:  # Zero-range bar (halted, weekend, etc.) — skip
            continue

        body = abs(bar.close - bar.open)
        upper_shadow = bar.high - max(bar.open, bar.close)
        lower_shadow = min(bar.open, bar.close) - bar.low
        bullish = bar.close >= bar.open

        # ── Single-bar patterns ──────────────────────────────
        if body < full_range * 0.1:
            findings.append((bar.time, "Doji"))

        elif (
            lower_shadow > body * 2
            and upper_shadow < body * 0.5
            and body < full_range * 0.35
        ):
            name = "Bullish Hammer" if bullish else "Bearish Hammer"
            findings.append((bar.time, name))

        elif (
            upper_shadow > body * 2
            and lower_shadow < body * 0.5
            and body < full_range * 0.35
        ):
            findings.append((bar.time, "Shooting Star"))

        # ── Two-bar patterns (need a previous bar) ───────────
        if i == 0:
            continue

        prev = bars[i - 1]
        prev_bullish = prev.close >= prev.open
        curr_body_top = max(bar.open, bar.close)
        curr_body_bot = min(bar.open, bar.close)
        prev_body_top = max(prev.open, prev.close)
        prev_body_bot = min(prev.open, prev.close)

        # Bullish Engulfing: prior bar bearish, current bar bullish + fully contains prior body
        if (
            not prev_bullish
            and bullish
            and curr_body_top > prev_body_top
            and curr_body_bot < prev_body_bot
        ):
            findings.append((bar.time, "Bullish Engulfing"))

        # Bearish Engulfing: prior bar bullish, current bar bearish + fully contains prior body
        elif (
            prev_bullish
            and not bullish
            and curr_body_top > prev_body_top
            and curr_body_bot < prev_body_bot
        ):
            findings.append((bar.time, "Bearish Engulfing"))

        # Inside Bar: current bar range fully inside prior bar range
        if bar.high < prev.high and bar.low > prev.low:
            findings.append((bar.time, "Inside Bar"))

    return findings


def _build_pattern_context(candles: list[CandleData], n_bars: int) -> str:
    """
    Mode "patterns" — pre-computed candlestick pattern list.

    Runs pattern detection on the last n_bars candles and formats the
    results as a compact list. Token cost: ~+10-15% (proportional to
    patterns found, not to n_bars). Better signal/token ratio than
    the full OHLCV table for pattern-aware models.
    """
    findings = _detect_candlestick_patterns(candles, n_bars)
    if not findings:
        return (
            f"\nCandlestick Patterns (last {min(n_bars, len(candles))} bars): "
            "No notable patterns detected."
        )

    lines = [
        "",
        f"Candlestick Patterns (last {min(n_bars, len(candles))} bars, oldest → newest):",
    ]
    for ts, pattern in findings:
        try:
            date_str = datetime.datetime.utcfromtimestamp(ts).strftime("%Y-%m-%d")
        except (OSError, OverflowError, ValueError):
            date_str = f"t={ts}"
        lines.append(f"  {date_str}: {pattern}")

    # Summarize bullish vs bearish pattern count for quick model orientation
    bullish_patterns = {"Bullish Hammer", "Bullish Engulfing"}
    bearish_patterns = {"Bearish Engulfing", "Shooting Star", "Bearish Hammer"}
    n_bullish = sum(1 for _, p in findings if p in bullish_patterns)
    n_bearish = sum(1 for _, p in findings if p in bearish_patterns)
    n_neutral = len(findings) - n_bullish - n_bearish

    summary_parts = []
    if n_bullish:
        summary_parts.append(f"{n_bullish} bullish")
    if n_bearish:
        summary_parts.append(f"{n_bearish} bearish")
    if n_neutral:
        summary_parts.append(f"{n_neutral} neutral")
    lines.append(f"  Summary: {', '.join(summary_parts)} pattern(s)")

    return "\n".join(lines)


# ═══════════════════════════════════════════════════════════════
#  Context Builder
# ═══════════════════════════════════════════════════════════════


def _sort_indicators(
    indicators: list[IndicatorResult],
    priority: Optional[list[str]] = None,
) -> list[IndicatorResult]:
    """
    Reorder indicators so prioritized ones appear first in the context.

    LLMs pay more attention to content that appears earlier in the prompt.
    By putting the user's priority indicators at the top, we get a
    structural bias towards those signals — reinforced by the explicit
    weighting instruction in the system prompt.

    priority: ordered list of backend indicator names (first = most important).
              None means keep original order.
    """
    if not priority:
        return indicators

    # Build a rank map: prioritized indicators get low numbers, rest get high
    rank = {name: i for i, name in enumerate(priority)}
    max_rank = len(priority)

    def sort_key(ind: IndicatorResult) -> int:
        # EMA variants: match "ema_9" against "EMA Stack" by checking
        # if the indicator name is in the priority list directly
        name = ind.name
        if name in rank:
            return rank[name]
        # EMA prefix match — all EMAs get the rank of the first EMA in priority
        if name.startswith("ema_"):
            for pname in priority:
                if pname.startswith("ema_"):
                    return rank[pname]
        return max_rank  # Unprioritized indicators go after prioritized ones

    return sorted(indicators, key=sort_key)


def build_indicator_context(
    symbol: str,
    timeframe: str,
    candles: list[CandleData],
    indicators: list[IndicatorResult],
    fibonacci: Optional[FibonacciResult] = None,
    indicator_priority: Optional[list[str]] = None,
    context_mode: str = "none",
    context_bars: int = 10,
) -> str:
    """
    Build structured text context from computed indicator data.

    Uses registered formatters — no if/elif chain. New indicators
    just need a formatter function and a registry entry.

    indicator_priority: optional ordered list of backend indicator names.
        When set, indicators are reordered so prioritized ones appear
        first in the context (models attend more to earlier content).

    context_mode: controls what raw price history is appended.
        "none"     — indicator values only (default, lowest token cost)
        "summary"  — compact recent-closes + direction blurb (~+5% tokens)
        "ohlcv"    — full OHLCV table for context_bars bars (~+25-40% tokens)
        "patterns" — pre-computed candlestick pattern list (~+10-15% tokens)
    context_bars: number of bars to use when context_mode != "none" (5–30).
    """
    if not candles:
        return f"No candle data available for {symbol} on {timeframe} timeframe."

    last = candles[-1]
    prev = candles[-2] if len(candles) > 1 else last
    price_change = ((last.close - prev.close) / prev.close * 100) if prev.close else 0

    lines = [
        f"=== {symbol} — {timeframe} Timeframe ===",
        f"Current Price: ${last.close:.2f} ({price_change:+.2f}%)",
        f"Open: ${last.open:.2f} | High: ${last.high:.2f} | Low: ${last.low:.2f}",
        f"Volume: {last.volume:,.0f}",
        f"Candles analyzed: {len(candles)}",
        "",
    ]

    # Reorder indicators by priority (if provided)
    sorted_indicators = _sort_indicators(indicators, indicator_priority)

    for ind in sorted_indicators:
        if not ind.values:
            lines.append(f"{ind.name.upper()}: No data")
            continue

        formatter = _get_formatter(ind.name)
        if formatter:
            lines.extend(formatter(ind, last))
        else:
            # Fallback for unregistered indicators — show raw latest value
            latest = ind.values[-1]
            lines.append(f"{ind.name.upper()}: {latest.value}")

    # Fibonacci (separate data path) — if prioritized, it already got
    # emphasis from being mentioned in the system prompt priority section
    if fibonacci:
        lines.extend(_format_fibonacci(fibonacci, last))

    # ── Optional chart context block ─────────────────────────
    # Appended after indicators so it doesn't disrupt indicator priority ordering.
    # The model sees indicators first (most signal-dense), then raw context.
    if context_mode == "summary":
        summary = _build_price_summary(candles, context_bars)
        if summary:
            lines.append(summary)
    elif context_mode == "ohlcv":
        ohlcv = _build_ohlcv_history(candles, context_bars)
        if ohlcv:
            lines.append(ohlcv)
    elif context_mode == "patterns":
        patterns = _build_pattern_context(candles, context_bars)
        if patterns:
            lines.append(patterns)

    return "\n".join(lines)


def build_multi_timeframe_context(
    symbol: str,
    timeframe_data: dict[str, dict],
    indicator_priority: Optional[list[str]] = None,
    context_mode: str = "none",
    context_bars: int = 10,
) -> str:
    """
    Build context from multiple timeframes.
    timeframe_data: dict of timeframe → {"candles": [...], "indicators": [...], "fibonacci": ...}
    indicator_priority: optional ordered list — prioritized indicators appear first in each section.
    context_mode / context_bars: passed through to build_indicator_context for each timeframe.
    """
    sections = []
    for tf, data in timeframe_data.items():
        section = build_indicator_context(
            symbol=symbol,
            timeframe=tf,
            candles=data.get("candles", []),
            indicators=data.get("indicators", []),
            fibonacci=data.get("fibonacci"),
            indicator_priority=indicator_priority,
            context_mode=context_mode,
            context_bars=context_bars,
        )
        sections.append(section)
    return "\n\n".join(sections)


# ═══════════════════════════════════════════════════════════════
#  Truncation
# ═══════════════════════════════════════════════════════════════


def truncate_context(
    context: str,
    budget_tokens: int = DEFAULT_CONTEXT_BUDGET,
) -> str:
    """
    If the context exceeds the token budget, truncate from the top
    (oldest timeframes first, since multi-TF context is ordered
    oldest→newest). Adds a note so the model knows data was trimmed.
    """
    estimated = _estimate_tokens(context)
    if estimated <= budget_tokens:
        return context

    target_chars = int(budget_tokens * CHARS_PER_TOKEN)

    # Split by timeframe sections (separated by double newlines + "===")
    sections = context.split("\n\n=== ")

    if len(sections) <= 1:
        # Single timeframe — hard-truncate from top
        truncated = context[-target_chars:]
        return f"[Context truncated — showing most recent data]\n\n{truncated}"

    # Drop oldest timeframes first until we fit
    while len(sections) > 1 and len("\n\n=== ".join(sections)) > target_chars:
        dropped = sections.pop(0)
        log.debug("Truncated timeframe section (%d chars)", len(dropped))

    result = "=== ".join(sections) if not sections[0].startswith("===") else "\n\n=== ".join(sections)

    # Restore leading "===" if we popped the first section
    if not result.startswith("==="):
        result = "=== " + result

    return f"[Context truncated — some timeframes omitted to fit model context]\n\n{result}"


# ═══════════════════════════════════════════════════════════════
#  Dynamic System Prompt
# ═══════════════════════════════════════════════════════════════

# Base system prompt — always present.
#
# Structure: narrative analysis first, then the signal is extracted
# separately via Ollama structured output. The model never needs to
# produce JSON in free text — that's handled by a second focused call.
_SYSTEM_BASE = """You are Parallax AI, an expert technical analysis assistant for experienced US equity and ETF traders. You analyze charts using technical indicators and provide actionable trading signals.

Your role:
- Analyze the provided indicator data and identify trading setups
- Provide clear direction (STRONG LONG, LONG, NEUTRAL, SHORT, STRONG SHORT)
- Give specific entry, stop-loss, and target levels with reasoning
- List confirmation factors and caution flags
- Be concise and data-driven — no fluff, no disclaimers about "not financial advice"

DIRECTION CRITERIA — use these thresholds consistently:
- STRONG LONG: 3+ primary indicators align bullish, no major cautions, trend confirmed by ADX > 25 or strong EMA stack
- LONG: Majority of indicators lean bullish, minor cautions acceptable
- NEUTRAL: Mixed signals, no clear edge, or conflicting timeframes
- SHORT: Majority of indicators lean bearish, minor bullish outliers acceptable
- STRONG SHORT: 3+ primary indicators align bearish, no major bullish signals, trend confirmed

RESPONSE FORMAT:
1. Start with a 2-3 paragraph analysis explaining what the indicators show
2. Structure your analysis: higher timeframe trend first, then lower timeframe entry timing
3. Be explicit about entry price, stop-loss, and target with brief reasoning for each
4. List what confirms the setup and what could go wrong

After your analysis, the system will ask you to produce a structured signal separately — you do NOT need to include JSON in your narrative response.

For follow-up questions, respond conversationally about the chart and setup."""


# Per-indicator analysis hints — appended to system prompt when that
# indicator is enabled. Helps the model focus on what matters.

INDICATOR_HINTS: dict[str, str] = {
    "rsi": "Pay attention to RSI divergences and overbought/oversold zones (30/70). RSI between 40-60 in a trend is normal — not a reversal signal.",
    "macd": "Note MACD crossovers, histogram direction changes, and zero-line crosses. Histogram shrinking often precedes a crossover.",
    "ema": "Analyze the EMA stack order (9>21>50>200 = strong uptrend). Crossovers between EMAs are key signals. Price bouncing off an EMA is support/resistance.",
    "bbands": "Bollinger Band squeeze (narrow width) precedes breakouts. Walks along upper/lower band show strong momentum. Price returning to middle band is mean reversion.",
    "vwap": "VWAP is the institutional benchmark. Price above VWAP = bullish institutional flow. Key for intraday setups.",
    "atr": "Use ATR for sizing stops and targets. 1.5-2x ATR for stops is standard. Expanding ATR = increasing volatility.",
    "stoch": "Stochastic is most useful in ranges — less reliable in strong trends. %K/%D crossovers in oversold/overbought zones are the key signals.",
    "obv": "OBV divergences from price are powerful signals. Rising OBV with flat price = accumulation. Falling OBV with flat price = distribution.",
    "adx": "ADX > 25 means the trend is strong enough to trade with trend-following strategies. ADX < 20 favors range-bound / mean-reversion setups.",
    "volume": "Volume confirms price moves. Breakouts on high volume are more reliable. Low volume moves are suspect.",
    "fibonacci": "Focus on Fibonacci levels near current price (0.382, 0.5, 0.618 are key). Confluence of Fibonacci with EMA or VWAP levels strengthens the zone.",
}


def build_system_prompt(
    indicators: list[str],
    watchlist: Optional[str] = None,
    indicator_priority: Optional[list[str]] = None,
) -> str:
    """
    Build a system prompt tailored to the enabled indicators, priority, and watchlist.

    indicators: backend indicator names (e.g., ["rsi", "ema_9", "ema_21", "macd"])
    watchlist: optional watchlist name the ticker came from (e.g., "RS Leaders")
    indicator_priority: optional ordered list — first = most important to the trader.
        When None, the AI decides which indicators matter most for the setup.
    """
    parts = [_SYSTEM_BASE]

    # ── Indicator priority weighting ──
    if indicator_priority:
        # Normalize names for display (ema_9 → EMA 9, rsi → RSI, etc.)
        display_names = []
        for name in indicator_priority:
            if name.startswith("ema_"):
                display_names.append(f"EMA {name.split('_')[1]}")
            else:
                display_names.append(name.upper())

        priority_text = ", ".join(display_names)
        parts.append(
            f"\n\nINDICATOR PRIORITY (set by the trader — respect this ordering):\n"
            f"The trader has ranked these indicators by importance: {priority_text}.\n"
            f"Weigh the first-listed indicators most heavily in your analysis. "
            f"Your signal direction and confidence should be primarily driven by "
            f"what the top-priority indicators are showing. The remaining indicators "
            f"serve as confirmation or caution — they can raise or lower confidence "
            f"but should not override the primary signals unless they show strong "
            f"divergence."
        )

    # ── Per-indicator analysis hints ──
    added_hints: set[str] = set()
    for ind_name in indicators:
        hint_key = "ema" if ind_name.startswith("ema_") else ind_name
        if hint_key in INDICATOR_HINTS and hint_key not in added_hints:
            added_hints.add(hint_key)

    if added_hints:
        parts.append("\n\nAnalysis focus for enabled indicators:")
        for key in added_hints:
            parts.append(f"- {INDICATOR_HINTS[key]}")

    # ── Watchlist-aware framing ──
    if watchlist:
        watchlist_framing = _build_watchlist_framing(watchlist)
        if watchlist_framing:
            parts.append(f"\n\n{watchlist_framing}")

    return "\n".join(parts)


# ═══════════════════════════════════════════════════════════════
#  Watchlist Context (Task 4.14)
# ═══════════════════════════════════════════════════════════════

# Known watchlist archetypes and their analysis framing.
# The key is matched case-insensitively as a substring of the watchlist name.
# This means "RS Leaders 2026" matches "rs leader", "Swing Setups Q2" matches "swing", etc.

WATCHLIST_FRAMING: dict[str, str] = {
    "rs leader": (
        "WATCHLIST CONTEXT: This ticker is from a Relative Strength leaders watchlist. "
        "It has demonstrated strong relative performance vs. the market. "
        "Favor trend-continuation setups. Look for pullbacks to moving averages as entries. "
        "Give extra weight to momentum indicators (RSI staying above 50, MACD above zero). "
        "These are leaders — they tend to recover from dips faster than the market."
    ),
    "short": (
        "WATCHLIST CONTEXT: This ticker is from a short-term / short-dated watchlist. "
        "The trader is looking for quick moves — intraday to a few days. "
        "Prioritize immediate price action, VWAP positioning, and volume surges. "
        "Tighter stops and smaller targets. Stochastic and RSI extremes matter more here. "
        "Time in trade is a cost — favor setups with an immediate catalyst."
    ),
    "swing": (
        "WATCHLIST CONTEXT: This ticker is from a swing trading watchlist. "
        "Typical hold period is 2-10 days. Daily and 4H timeframes are most relevant. "
        "Look for entries on pullbacks to key levels (EMA 21, Fibonacci 0.5-0.618). "
        "Wider stops (1.5-2x ATR), bigger targets. Pattern completions and breakouts are key. "
        "Risk-reward of 2:1 minimum."
    ),
    "long": (
        "WATCHLIST CONTEXT: This ticker is from a long-term / position watchlist. "
        "Hold period is weeks to months. Weekly timeframe carries the most weight. "
        "Focus on the EMA 50/200 relationship (golden/death cross), major Fibonacci levels, "
        "and ADX trend strength. Daily noise is less important. "
        "Wide stops below structural levels. Favor accumulation zones and major breakouts."
    ),
    "momentum": (
        "WATCHLIST CONTEXT: This ticker is flagged for momentum. "
        "Favor breakout entries with volume confirmation. "
        "ADX > 25 and rising confirms the momentum thesis. "
        "Trailing stops work well here — let winners run."
    ),
    "mean reversion": (
        "WATCHLIST CONTEXT: This ticker is flagged for mean reversion. "
        "Look for overextended conditions: RSI at extremes, price far from VWAP, "
        "Bollinger Band touches. Entries on exhaustion candles with volume spike. "
        "Tight targets (back to VWAP or middle Bollinger). ADX < 20 favors this setup."
    ),
}


def _build_watchlist_framing(watchlist: str) -> str:
    """
    Match a watchlist name to a known archetype and return framing text.
    Returns empty string if the watchlist doesn't match any known pattern.
    """
    lower = watchlist.lower()
    for pattern, framing in WATCHLIST_FRAMING.items():
        if pattern in lower:
            return framing

    # No match — still mention the watchlist name so the model has context,
    # but without specific trading framing
    return (
        f"WATCHLIST CONTEXT: This ticker is from the \"{watchlist}\" watchlist. "
        f"The trader has placed it in this list intentionally — consider what "
        f"the watchlist name implies about their thesis."
    )


# ═══════════════════════════════════════════════════════════════
#  User Message Builder (Task 5 — enriched analysis request)
# ═══════════════════════════════════════════════════════════════

# Timeframe hierarchy — higher timeframes carry more weight for trend,
# lower timeframes for entry timing. Used to structure the analysis request.
_TIMEFRAME_WEIGHT: dict[str, int] = {
    "1H": 1, "4H": 2, "D": 3, "W": 4, "M": 5,
}


def build_analysis_user_message(
    symbol: str,
    context: str,
    timeframes: list[str],
    indicators_requested: list[str],
    indicator_priority: Optional[list[str]] = None,
) -> str:
    """
    Build the user message for the initial analysis request.

    This is the core prompt the model receives alongside the system prompt
    and indicator context. It provides:
      1. What to analyze (symbol + context)
      2. How to structure the analysis (higher TF → lower TF flow)
      3. What to focus on (indicators, priority if set)
      4. What "done" looks like (specific levels, actionable output)
    """
    # Determine primary timeframe (highest in hierarchy among selected)
    sorted_tfs = sorted(timeframes, key=lambda tf: _TIMEFRAME_WEIGHT.get(tf, 0), reverse=True)
    primary_tf = sorted_tfs[0] if sorted_tfs else "D"
    entry_tf = sorted_tfs[-1] if len(sorted_tfs) > 1 else primary_tf

    parts = [
        f"Analyze {symbol} across the provided timeframes and identify the best trading setup.",
        "",
        f"Here is the current technical data:\n\n{context}",
        "",
    ]

    # Analysis structure guidance
    if len(timeframes) > 1:
        parts.append(
            f"ANALYSIS STRUCTURE:\n"
            f"1. Start with the {primary_tf} timeframe to establish the dominant trend direction\n"
            f"2. Then examine {entry_tf} for precise entry timing and immediate price action\n"
            f"3. Note any conflicts between timeframes — if {primary_tf} is bullish but {entry_tf} "
            f"shows short-term weakness, address whether it's a pullback opportunity or a warning"
        )
    else:
        parts.append(
            f"ANALYSIS STRUCTURE:\n"
            f"Focus on the {primary_tf} timeframe. Identify the trend, key support/resistance "
            f"levels, and where price sits relative to them."
        )

    # Indicator focus
    parts.append("")
    indicator_list = ", ".join(indicators_requested)
    parts.append(f"Indicators provided: {indicator_list}")

    if indicator_priority:
        display_names = []
        for name in indicator_priority:
            if name.startswith("ema_"):
                display_names.append(f"EMA {name.split('_')[1]}")
            else:
                display_names.append(name.upper())
        priority_text = " > ".join(display_names)
        parts.append(f"Trader's priority ranking: {priority_text}")
        parts.append("Weigh the first-listed indicators most heavily.")

    # What "done" looks like — define the output clearly
    parts.append("")
    parts.append(
        "REQUIRED OUTPUT:\n"
        "- Clear direction call with reasoning\n"
        "- Specific entry price with rationale (e.g., pullback to EMA 21, break above resistance)\n"
        "- Stop-loss price with rationale (e.g., below swing low, 1.5x ATR)\n"
        "- Target price with rationale (e.g., next resistance, Fibonacci extension)\n"
        "- 2-4 confirmation factors supporting the setup\n"
        "- 1-3 caution flags or risks to watch"
    )

    # One-shot JSON block requirement — appended at the very end of the
    # narrative so the frontend can stream the analysis live AND parse a
    # signal in a single round trip (no separate structured-output call).
    parts.append("")
    parts.append(SIGNAL_INLINE_JSON_INSTRUCTION)

    return "\n".join(parts)


# ─────────────────────────────────────────────────────────────────────────
#  Inline JSON instruction for the one-shot analyze flow
# ─────────────────────────────────────────────────────────────────────────
#
# The original implementation made TWO Ollama calls per analysis:
#   1. Free-text narrative
#   2. Structured-output extraction (format=json) for the signal
#
# On a 26B-class model running on consumer hardware, the structured call
# regularly hit the 45s timeout, falling through to a third reformat call.
# Total wall time was 2+ minutes.
#
# The one-shot approach instead asks the narrative call itself to terminate
# with a fenced JSON block. Parsing is via the existing regex (handles
# fenced and unfenced objects). One reformat fallback remains if parsing
# fails, but it's rare in practice.

SIGNAL_INLINE_JSON_INSTRUCTION = (
    "After your full written analysis, append a fenced JSON block in this "
    "EXACT format. The JSON block is REQUIRED and must be the LAST thing "
    "in your response:\n\n"
    "```json\n"
    "{\n"
    '  "direction": "STRONG LONG | LONG | NEUTRAL | SHORT | STRONG SHORT",\n'
    '  "confidence": 0-100,\n'
    '  "description": "one-sentence setup summary",\n'
    '  "entry":  {"price": 0.00, "note": "rationale"},\n'
    '  "stop":   {"price": 0.00, "note": "rationale"},\n'
    '  "target": {"price": 0.00, "note": "rationale"},\n'
    '  "confirmations": ["...", "..."],\n'
    '  "cautions": ["..."],\n'
    '  "meta": {\n'
    '    "risk_reward":   "e.g. 2.5:1",\n'
    '    "score":         "e.g. 7/10",\n'
    '    "adx_trend":     "e.g. Strong (28.5)",\n'
    '    "volume_signal": "e.g. Above avg"\n'
    "  }\n"
    "}\n"
    "```"
)


# ═══════════════════════════════════════════════════════════════
#  Signal Extraction Prompt + Schema (Ollama structured output)
# ═══════════════════════════════════════════════════════════════
#
# After the model produces a free-text narrative analysis, we make a
# second focused call with Ollama's `format` parameter to extract a
# structured signal. This guarantees valid JSON and uses the
# reasoning_steps-first pattern from CoT research: the model reasons
# before committing to structured fields.

SIGNAL_EXTRACTION_PROMPT = (
    "Based on your analysis above, produce a structured trading signal. "
    "Think step by step: first summarize your reasoning, then fill in "
    "the signal fields."
)

# JSON schema for Ollama's `format` parameter.
# reasoning_steps MUST be first — the model generates it before the
# structured signal fields, giving it chain-of-thought space.
SIGNAL_JSON_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "reasoning_steps": {
            "type": "string",
            "description": (
                "Think step by step before filling the signal. "
                "Summarize what the indicators show, which direction they favor, "
                "and what price levels matter. End with: "
                "'The signal is <DIRECTION> with <CONFIDENCE>% confidence.'"
            ),
        },
        "direction": {
            "type": "string",
            "enum": ["STRONG LONG", "LONG", "NEUTRAL", "SHORT", "STRONG SHORT"],
            "description": "Trading direction based on the analysis",
        },
        "confidence": {
            "type": "integer",
            "minimum": 0,
            "maximum": 100,
            "description": "Confidence level 0-100",
        },
        "description": {
            "type": "string",
            "description": "1-2 sentence summary of the setup",
        },
        "entry": {
            "type": "object",
            "properties": {
                "price": {"type": "number"},
                "note": {"type": "string"},
            },
            "required": ["price", "note"],
        },
        "stop": {
            "type": "object",
            "properties": {
                "price": {"type": "number"},
                "note": {"type": "string"},
            },
            "required": ["price", "note"],
        },
        "target": {
            "type": "object",
            "properties": {
                "price": {"type": "number"},
                "note": {"type": "string"},
            },
            "required": ["price", "note"],
        },
        "confirmations": {
            "type": "array",
            "items": {"type": "string"},
            "description": "2-4 factors that confirm the setup",
        },
        "cautions": {
            "type": "array",
            "items": {"type": "string"},
            "description": "1-3 risks or warning signs",
        },
        "meta": {
            "type": "object",
            "properties": {
                "risk_reward": {"type": "string", "description": "e.g. 2.5:1"},
                "score": {"type": "string", "description": "e.g. 7/10"},
                "adx_trend": {"type": "string", "description": "e.g. Strong (28.5)"},
                "volume_signal": {"type": "string", "description": "e.g. Above avg"},
            },
        },
    },
    "required": [
        "reasoning_steps", "direction", "confidence", "description",
        "entry", "stop", "target", "confirmations", "cautions",
    ],
}
