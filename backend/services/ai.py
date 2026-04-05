"""
AI analysis service — connects to Ollama for chart analysis and chat.

This service does three things:
  1. Builds structured prompts from indicator data (JSON → trading context)
  2. Calls Ollama's /api/chat endpoint for analysis and conversation
  3. Parses AI responses into structured SignalData for the Action Signal card

Architecture:
  - AiService is the main class, created once during app startup
  - It depends on IndicatorService (for fetching indicator data)
  - It depends on OllamaLifecycle (for checking if Ollama is ready)
  - The AI router (routers/ai.py) is a thin wrapper over this service

Prompt strategy:
  We send structured JSON with pre-computed indicator values and signals.
  The model interprets the data and returns a trading signal with reasoning.
  This is more reliable than sending raw OHLCV arrays.
"""

import json
import logging
import re
import uuid
from collections import OrderedDict
from typing import AsyncIterator, Optional

import httpx

from config import OLLAMA_HOST
from models import CandleData, IndicatorResult, FibonacciResult

log = logging.getLogger("parallax.ai")

# Maximum conversation messages to keep in context (per session)
MAX_CONTEXT_MESSAGES = 20

# Maximum number of concurrent sessions held in memory.
# Once this is exceeded, the oldest session is evicted (LRU).
# For a 2-person app this is generous — just prevents runaway memory growth.
MAX_SESSIONS = 50


# ═══════════════════════════════════════════════════════════════
#  Prompt Templates
# ═══════════════════════════════════════════════════════════════

SYSTEM_PROMPT = """You are Parallax AI, an expert technical analysis assistant for experienced stock and ETF traders. You analyze charts using technical indicators and provide actionable trading signals.

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

For follow-up questions, respond conversationally — only include a JSON signal block if the user asks for an updated signal.
"""


def build_indicator_context(
    symbol: str,
    timeframe: str,
    candles: list[CandleData],
    indicators: list[IndicatorResult],
    fibonacci: Optional[FibonacciResult] = None,
) -> str:
    """
    Convert computed indicator data into a structured text context
    that the LLM can easily interpret.

    We extract the LATEST values from each indicator and present them
    as a concise summary rather than raw arrays.
    """
    if not candles:
        return f"No candle data available for {symbol} on {timeframe} timeframe."

    # Current price info from the last candle
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

    # Extract latest value from each indicator
    for ind in indicators:
        name = ind.name.upper()
        if not ind.values:
            lines.append(f"{name}: No data")
            continue

        latest = ind.values[-1]

        if ind.name == "rsi":
            val = latest.value
            zone = "OVERSOLD" if val and val < 30 else "OVERBOUGHT" if val and val > 70 else "NEUTRAL"
            lines.append(f"RSI(14): {val:.1f} [{zone}]")

        elif ind.name == "macd":
            lines.append(
                f"MACD: Line={latest.value:.4f}, Signal={latest.signal:.4f}, "
                f"Histogram={latest.histogram:.4f} "
                f"[{'BULLISH' if latest.histogram and latest.histogram > 0 else 'BEARISH'}]"
            )

        elif ind.name.startswith("ema_"):
            period = ind.name.split("_")[1]
            val = latest.value
            if val:
                pos = "ABOVE" if last.close > val else "BELOW"
                lines.append(f"EMA({period}): ${val:.2f} [Price {pos}]")

        elif ind.name == "bbands":
            lines.append(
                f"Bollinger Bands: Upper=${latest.upper:.2f}, "
                f"Middle=${latest.value:.2f}, Lower=${latest.lower:.2f}"
            )
            if latest.upper and latest.lower:
                width = (latest.upper - latest.lower) / latest.value * 100 if latest.value else 0
                lines.append(f"  Band Width: {width:.1f}%")

        elif ind.name == "vwap":
            val = latest.value
            if val:
                pos = "ABOVE" if last.close > val else "BELOW"
                lines.append(f"VWAP: ${val:.2f} [Price {pos}]")

        elif ind.name == "atr":
            lines.append(f"ATR(14): ${latest.value:.2f}")

        elif ind.name == "stoch":
            lines.append(
                f"Stochastic: %K={latest.value:.1f}, %D={latest.signal:.1f} "
                f"[{'OVERSOLD' if latest.value and latest.value < 20 else 'OVERBOUGHT' if latest.value and latest.value > 80 else 'NEUTRAL'}]"
            )

        elif ind.name == "obv":
            lines.append(f"OBV: {latest.value:,.0f}")

        elif ind.name == "adx":
            val = latest.value
            strength = (
                "STRONG TREND" if val and val > 25
                else "WEAK/NO TREND"
            )
            lines.append(f"ADX(14): {val:.1f} [{strength}]")

        elif ind.name == "volume":
            if latest.signal:  # Volume MA
                ratio = latest.value / latest.signal if latest.signal else 0
                lines.append(
                    f"Volume: {latest.value:,.0f} (MA: {latest.signal:,.0f}, "
                    f"Ratio: {ratio:.2f}x) "
                    f"[{'ABOVE AVG' if ratio > 1.0 else 'BELOW AVG'}]"
                )
            else:
                lines.append(f"Volume: {latest.value:,.0f}")

        else:
            lines.append(f"{name}: {latest.value}")

    # Fibonacci levels
    if fibonacci:
        lines.append("")
        lines.append(f"Fibonacci ({fibonacci.trend.upper()} trend):")
        lines.append(f"  Swing High: ${fibonacci.swing_high:.2f}")
        lines.append(f"  Swing Low: ${fibonacci.swing_low:.2f}")
        for level in fibonacci.levels:
            proximity = abs(last.close - level.price) / last.close * 100
            marker = " ← NEAR" if proximity < 1.0 else ""
            lines.append(f"  {level.label}: ${level.price:.2f}{marker}")

    return "\n".join(lines)


def build_multi_timeframe_context(
    symbol: str,
    timeframe_data: dict[str, dict],
) -> str:
    """
    Build context from multiple timeframes for a comprehensive analysis.
    timeframe_data is a dict of timeframe → {"candles": [...], "indicators": [...], "fibonacci": ...}
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
#  Signal Parser
# ═══════════════════════════════════════════════════════════════


def parse_signal_from_response(text: str) -> Optional[dict]:
    """
    Extract the JSON signal block from an AI response.
    Returns the parsed dict or None if no valid signal found.

    The AI is instructed to wrap its signal in ```json ... ``` blocks.
    We also try to find raw JSON objects as a fallback.
    """
    # Try to find JSON in code blocks first
    json_match = re.search(r"```json\s*\n?(.*?)\n?\s*```", text, re.DOTALL)
    if json_match:
        try:
            return json.loads(json_match.group(1))
        except json.JSONDecodeError:
            log.warning("Found JSON block but couldn't parse it")

    # Fallback: find any JSON object with "direction" key
    obj_match = re.search(r'\{[^{}]*"direction"[^{}]*\}', text, re.DOTALL)
    if obj_match:
        try:
            return json.loads(obj_match.group(0))
        except json.JSONDecodeError:
            pass

    # Last resort: try to find a larger JSON block
    for match in re.finditer(r'\{(?:[^{}]|\{[^{}]*\})*\}', text, re.DOTALL):
        try:
            data = json.loads(match.group(0))
            if "direction" in data:
                return data
        except json.JSONDecodeError:
            continue

    return None


def signal_to_frontend_format(signal: dict) -> dict:
    """
    Convert the parsed AI signal into the format expected by
    the ActionSignalCard component on the frontend.
    """
    entry = signal.get("entry", {})
    stop = signal.get("stop", {})
    target = signal.get("target", {})
    meta = signal.get("meta", {})

    return {
        "direction": signal.get("direction", "NEUTRAL"),
        "description": signal.get("description", ""),
        "confidence": signal.get("confidence", 50),
        "levels": [
            {
                "label": "Entry",
                "value": f"${entry.get('price', 0):.2f}" if isinstance(entry.get('price'), (int, float)) else str(entry.get('price', 'N/A')),
                "sub": entry.get("note", ""),
            },
            {
                "label": "Stop",
                "value": f"${stop.get('price', 0):.2f}" if isinstance(stop.get('price'), (int, float)) else str(stop.get('price', 'N/A')),
                "sub": stop.get("note", ""),
                "color": "red",
            },
            {
                "label": "Target",
                "value": f"${target.get('price', 0):.2f}" if isinstance(target.get('price'), (int, float)) else str(target.get('price', 'N/A')),
                "sub": target.get("note", ""),
                "color": "green",
            },
        ],
        "meta": [
            {"label": "R:R", "value": meta.get("risk_reward", "N/A")},
            {"label": "Score", "value": meta.get("score", "N/A")},
            {"label": "ADX", "value": meta.get("adx_trend", "N/A")},
            {"label": "Vol", "value": meta.get("volume_signal", "N/A")},
        ],
        "checks": [
            *[{"text": c, "type": "confirm"} for c in signal.get("confirmations", [])],
            *[{"text": c, "type": "caution"} for c in signal.get("cautions", [])],
        ],
    }


# ═══════════════════════════════════════════════════════════════
#  Chat Context Manager
# ═══════════════════════════════════════════════════════════════


class ChatSession:
    """
    Manages conversation history for one analysis session.
    Each time the user opens a new stock or runs a new analysis,
    a new ChatSession is created.
    """

    def __init__(self, session_id: Optional[str] = None) -> None:
        self.session_id = session_id or str(uuid.uuid4())
        self.messages: list[dict[str, str]] = []
        self.symbol: str = ""
        self.signal: Optional[dict] = None

    def add_system(self, content: str) -> None:
        """Add a system message (indicator context, etc.)."""
        self.messages.append({"role": "system", "content": content})

    def add_user(self, content: str) -> None:
        """Add a user message."""
        self.messages.append({"role": "user", "content": content})

    def add_assistant(self, content: str) -> None:
        """Add an assistant response."""
        self.messages.append({"role": "assistant", "content": content})

    def get_messages(self) -> list[dict[str, str]]:
        """Get conversation history, trimmed to fit context window."""
        if len(self.messages) <= MAX_CONTEXT_MESSAGES + 1:  # +1 for system
            return self.messages

        # Always keep the system message (first) and recent conversation
        system_msgs = [m for m in self.messages if m["role"] == "system"]
        non_system = [m for m in self.messages if m["role"] != "system"]

        # Keep the most recent messages
        trimmed = non_system[-(MAX_CONTEXT_MESSAGES):]
        return system_msgs + trimmed

    def clear(self) -> None:
        """Clear conversation history."""
        self.messages.clear()
        self.signal = None


# ═══════════════════════════════════════════════════════════════
#  AI Service
# ═══════════════════════════════════════════════════════════════


class AiService:
    """
    Main AI service — orchestrates analysis and chat via Ollama.

    Created once during app startup. Holds active chat sessions
    and the HTTP client for Ollama communication.
    """

    def __init__(self) -> None:
        # Model is not hardcoded — it comes from the user's selection
        # stored in SQLite settings and set via OllamaLifecycle.selected_model.
        # The router passes the current model name into analyze()/follow_up().
        self.sessions: OrderedDict[str, ChatSession] = OrderedDict()
        self._http = httpx.AsyncClient(
            base_url=OLLAMA_HOST,
            timeout=httpx.Timeout(120.0, connect=10.0),
        )

    # ── Session management ──────────────────────────────────────

    def get_or_create_session(self, session_id: Optional[str] = None) -> ChatSession:
        """
        Get an existing session or create a new one.

        If the session limit is exceeded, the oldest session is evicted.
        This prevents unbounded memory growth from repeated analysis runs.
        """
        if session_id and session_id in self.sessions:
            # Move to end of OrderedDict (mark as recently used)
            self.sessions.move_to_end(session_id)
            return self.sessions[session_id]

        session = ChatSession(session_id)
        self.sessions[session.session_id] = session

        # Evict oldest sessions if over the limit
        while len(self.sessions) > MAX_SESSIONS:
            evicted_id, _ = self.sessions.popitem(last=False)
            log.debug("Evicted oldest session %s (limit: %d)", evicted_id, MAX_SESSIONS)

        return session

    def clear_session(self, session_id: str) -> None:
        """Remove a session."""
        self.sessions.pop(session_id, None)

    # ── Core Ollama communication ───────────────────────────────

    async def chat(
        self,
        messages: list[dict[str, str]],
        model: str,
    ) -> str:
        """
        Send a chat request to Ollama and return the full response.
        Non-streaming — waits for the complete response.

        model: the Ollama model name to use (from user's selection).
        """
        payload = {
            "model": model,
            "messages": messages,
            "stream": False,
            "options": {
                "temperature": 0.3,     # Low temp for more consistent analysis
                "num_predict": 2048,    # Max tokens to generate
            },
        }

        try:
            resp = await self._http.post("/api/chat", json=payload)
            resp.raise_for_status()
            data = resp.json()
            return data.get("message", {}).get("content", "")
        except httpx.ConnectError:
            raise ConnectionError("Cannot connect to Ollama server")
        except httpx.TimeoutException:
            raise TimeoutError("Ollama request timed out (>120s)")
        except httpx.HTTPStatusError as e:
            raise RuntimeError(f"Ollama returned error: {e.response.status_code}")

    async def chat_stream(
        self,
        messages: list[dict[str, str]],
        model: str,
    ) -> AsyncIterator[str]:
        """
        Send a chat request to Ollama and yield tokens as they arrive.
        Used for the streaming chat experience in the frontend.

        model: the Ollama model name to use (from user's selection).
        """
        payload = {
            "model": model,
            "messages": messages,
            "stream": True,
            "options": {
                "temperature": 0.3,
                "num_predict": 2048,
            },
        }

        try:
            async with self._http.stream(
                "POST",
                "/api/chat",
                json=payload,
                timeout=httpx.Timeout(120.0, connect=10.0),
            ) as response:
                async for line in response.aiter_lines():
                    if not line.strip():
                        continue
                    try:
                        data = json.loads(line)
                        content = data.get("message", {}).get("content", "")
                        if content:
                            yield content
                        if data.get("done", False):
                            return
                    except json.JSONDecodeError:
                        continue
        except httpx.ConnectError:
            yield "\n\n[Error: Cannot connect to Ollama server]"
        except httpx.TimeoutException:
            yield "\n\n[Error: Request timed out]"

    # ── Analysis ────────────────────────────────────────────────

    async def analyze(
        self,
        symbol: str,
        timeframe_data: dict[str, dict],
        indicators_requested: list[str],
        model: str,
        session_id: Optional[str] = None,
    ) -> dict:
        """
        Run a full technical analysis for a stock.

        1. Build structured context from indicator data
        2. Create a new chat session with system prompt + context
        3. Ask the model to analyze and produce a signal
        4. Parse the signal from the response
        5. Return signal + raw text for display

        Returns: {
            "session_id": str,
            "signal": dict | None,  (frontend-formatted signal)
            "message": str,         (full AI response text)
        }
        """
        session = self.get_or_create_session(session_id)
        session.symbol = symbol
        session.clear()

        # Build the context from all timeframes
        context = build_multi_timeframe_context(symbol, timeframe_data)

        # Set up conversation
        session.add_system(SYSTEM_PROMPT)
        session.add_user(
            f"Analyze {symbol} and provide a trading signal.\n\n"
            f"Here is the current technical data:\n\n{context}\n\n"
            f"Indicators requested for analysis: {', '.join(indicators_requested)}\n\n"
            f"Provide your analysis with a JSON signal block."
        )

        # Call Ollama with the user's selected model
        response_text = await self.chat(session.get_messages(), model=model)
        session.add_assistant(response_text)

        # Parse signal — try to extract JSON block from response
        raw_signal = parse_signal_from_response(response_text)

        if not raw_signal:
            # The model didn't include a properly formatted JSON block.
            # This happens occasionally with quantized models. Ask it to retry.
            log.info(
                "No signal JSON found in response for %s — requesting reformat...",
                symbol,
            )
            session.add_user(
                "Your response didn't include the JSON signal block I need. "
                "Please provide ONLY the JSON block now, wrapped in ```json ... ```, "
                "following the exact format specified. Include all required fields: "
                "direction, confidence, description, entry, stop, target, "
                "confirmations, cautions, meta."
            )
            retry_response = await self.chat(session.get_messages(), model=model)
            session.add_assistant(retry_response)
            raw_signal = parse_signal_from_response(retry_response)

            if raw_signal:
                log.info("Signal parsed successfully on retry for %s", symbol)
            else:
                log.warning("Signal parse failed on retry for %s — showing text only", symbol)

        frontend_signal = signal_to_frontend_format(raw_signal) if raw_signal else None
        session.signal = frontend_signal

        return {
            "session_id": session.session_id,
            "signal": frontend_signal,
            "message": response_text,  # Always show the original narrative response
        }

    async def follow_up(
        self,
        session_id: str,
        message: str,
        model: str,
    ) -> dict:
        """
        Send a follow-up message in an existing analysis session.

        Returns: {
            "session_id": str,
            "signal": dict | None,  (if the AI updated its signal)
            "message": str,
        }
        """
        session = self.sessions.get(session_id)
        if not session:
            raise ValueError(f"Session {session_id} not found")

        session.add_user(message)
        response_text = await self.chat(session.get_messages(), model=model)
        session.add_assistant(response_text)

        # Check if the response contains an updated signal
        raw_signal = parse_signal_from_response(response_text)
        if raw_signal:
            session.signal = signal_to_frontend_format(raw_signal)

        return {
            "session_id": session.session_id,
            "signal": session.signal,
            "message": response_text,
        }

    async def follow_up_stream(
        self,
        session_id: str,
        message: str,
        model: str,
    ) -> AsyncIterator[str]:
        """
        Streaming version of follow_up — yields tokens as they arrive.
        After the stream completes, the full response is added to the session.
        """
        session = self.sessions.get(session_id)
        if not session:
            yield "[Error: Session not found]"
            return

        session.add_user(message)

        full_response = ""
        async for token in self.chat_stream(session.get_messages(), model=model):
            full_response += token
            yield token

        session.add_assistant(full_response)

        # Check for signal update
        raw_signal = parse_signal_from_response(full_response)
        if raw_signal:
            session.signal = signal_to_frontend_format(raw_signal)

    # ── Cleanup ─────────────────────────────────────────────────

    async def shutdown(self) -> None:
        """Clean shutdown — close HTTP client."""
        await self._http.aclose()
        self.sessions.clear()
        log.info("AI service shut down")
