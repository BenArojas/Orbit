"""
Prompt builder — assembles structured context for AI analysis.

This module handles three things:
  1. Per-indicator formatting via a registration pattern (no if/elif chain)
  2. Dynamic system prompt that adapts to the enabled indicator set
  3. Watchlist-aware framing when the ticker comes from a specific watchlist
  4. Prompt length budget + graceful truncation

Architecture:
  Each indicator has a formatter function registered in INDICATOR_FORMATTERS.
  To add a new indicator (e.g., Fibonacci, Ichimoku), just write a new
  format_xxx function and add it to the registry dict. No touching the
  core builder logic.

Prompt budget:
  Smaller models (e2b, e4b) have limited context windows. We estimate
  token count ≈ chars/3.5 and truncate the oldest timeframe data first
  if the prompt exceeds the budget.
"""

import logging
from typing import Optional

from models import CandleData, IndicatorResult, FibonacciResult

log = logging.getLogger("parallax.prompt")


# ═══════════════════════════════════════════════════════════════
#  Prompt Length Budget
# ═══════════════════════════════════════════════════════════════

# Default budget in estimated tokens. Ollama models vary from 2K to 128K
# context, but the actual usable budget for the prompt + system + response
# is much smaller. We target ~3000 tokens for the indicator context
# (leaves room for system prompt, chat history, and model output).
DEFAULT_CONTEXT_BUDGET = 3000

# Approximate chars per token for English text (conservative estimate)
CHARS_PER_TOKEN = 3.5


def _estimate_tokens(text: str) -> int:
    """Rough token estimate from character count."""
    return int(len(text) / CHARS_PER_TOKEN)


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
    """Fibonacci is special — it comes from a separate data path, not IndicatorResult."""
    lines = [
        "",
        f"Fibonacci ({fibonacci.trend.upper()} trend):",
        f"  Swing High: ${fibonacci.swing_high:.2f}",
        f"  Swing Low: ${fibonacci.swing_low:.2f}",
    ]
    for level in fibonacci.levels:
        proximity = abs(last.close - level.price) / last.close * 100
        marker = " ← NEAR" if proximity < 1.0 else ""
        lines.append(f"  {level.label}: ${level.price:.2f}{marker}")
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
#  Context Builder
# ═══════════════════════════════════════════════════════════════


def build_indicator_context(
    symbol: str,
    timeframe: str,
    candles: list[CandleData],
    indicators: list[IndicatorResult],
    fibonacci: Optional[FibonacciResult] = None,
) -> str:
    """
    Build structured text context from computed indicator data.

    Uses registered formatters — no if/elif chain. New indicators
    just need a formatter function and a registry entry.
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

    for ind in indicators:
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

    # Fibonacci (separate data path)
    if fibonacci:
        lines.extend(_format_fibonacci(fibonacci, last))

    return "\n".join(lines)


def build_multi_timeframe_context(
    symbol: str,
    timeframe_data: dict[str, dict],
) -> str:
    """
    Build context from multiple timeframes.
    timeframe_data: dict of timeframe → {"candles": [...], "indicators": [...], "fibonacci": ...}
    """
    sections = []
    for tf, data in timeframe_data.items():
        section = build_indicator_context(
            symbol=symbol,
            timeframe=tf,
            candles=data.get("candles", []),
            indicators=data.get("indicators", []),
            fibonacci=data.get("fibonacci"),
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

# Base system prompt — always present
_SYSTEM_BASE = """You are Parallax AI, an expert technical analysis assistant for experienced stock and ETF traders. You analyze charts using technical indicators and provide actionable trading signals.

Your role:
- Analyze indicator data and identify trading setups
- Provide clear direction (STRONG LONG, LONG, NEUTRAL, SHORT, STRONG SHORT)
- Give specific entry, stop-loss, and target levels
- List confirmation factors and caution flags
- Be concise and data-driven — no fluff, no disclaimers about "not financial advice"

When providing a trading signal, you MUST respond with a JSON block in this exact format:

```json
{
  "direction": "STRONG LONG" | "LONG" | "NEUTRAL" | "SHORT" | "STRONG SHORT",
  "confidence": <number 0-100>,
  "description": "<1-2 sentence summary of the setup>",
  "entry": {"price": <number>, "note": "<brief note>"},
  "stop": {"price": <number>, "note": "<brief note>"},
  "target": {"price": <number>, "note": "<brief note>"},
  "confirmations": ["<factor 1>", "<factor 2>", ...],
  "cautions": ["<risk 1>", "<risk 2>", ...],
  "meta": {
    "risk_reward": "<e.g. 2.5:1>",
    "score": "<e.g. 7/10>",
    "adx_trend": "<e.g. Strong (28.5)>",
    "volume_signal": "<e.g. Above avg>"
  }
}
```

After the JSON block, provide a brief analysis paragraph explaining your reasoning.

For follow-up questions, respond conversationally — only include a JSON signal block if the user asks for an updated signal."""


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
) -> str:
    """
    Build a system prompt tailored to the enabled indicators and watchlist context.

    indicators: backend indicator names (e.g., ["rsi", "ema_9", "ema_21", "macd"])
    watchlist: optional watchlist name the ticker came from (e.g., "RS Leaders")
    """
    parts = [_SYSTEM_BASE]

    # Collect unique indicator hints
    added_hints: set[str] = set()
    for ind_name in indicators:
        # Normalize EMA variants to one hint
        hint_key = "ema" if ind_name.startswith("ema_") else ind_name
        if hint_key in INDICATOR_HINTS and hint_key not in added_hints:
            added_hints.add(hint_key)

    if added_hints:
        parts.append("\n\nAnalysis focus for enabled indicators:")
        for key in added_hints:
            parts.append(f"- {INDICATOR_HINTS[key]}")

    # Watchlist-aware framing
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


def _build_watchlist_framing(watchlist: str) -> Optional[str]:
    """
    Match a watchlist name to a known archetype and return framing text.
    Returns None if the watchlist doesn't match any known pattern.
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
