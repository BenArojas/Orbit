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
from models import CandleData

log = logging.getLogger("parallax.ai")

# Maximum conversation messages to keep in context (per session)
MAX_CONTEXT_MESSAGES = 20

# Maximum number of concurrent sessions held in memory.
# Once this is exceeded, the oldest session is evicted (LRU).
# For a 2-person app this is generous — just prevents runaway memory growth.
MAX_SESSIONS = 50


# ═══════════════════════════════════════════════════════════════
#  Prompt Builder (extracted to services/prompt_builder.py)
# ═══════════════════════════════════════════════════════════════

from services.prompt_builder import (
    build_indicator_context,        # noqa: F401 — re-export for backwards compat
    build_multi_timeframe_context,  # noqa: F401
    build_analysis_user_message,
    build_system_prompt,
    get_budget_for_model,
    truncate_context,
    SIGNAL_EXTRACTION_PROMPT,
    SIGNAL_JSON_SCHEMA,
)


# ═══════════════════════════════════════════════════════════════
#  Signal Parser
# ═══════════════════════════════════════════════════════════════


def parse_signal_from_response(text: str) -> Optional[dict]:
    """
    Extract the JSON signal block from an AI response.
    Returns the parsed dict or None if no valid signal found.

    Two fallbacks:
      1. Look for ```json ... ``` code blocks (the standard format)
      2. Find any JSON object containing "direction" (handles models
         that skip the backtick wrapping). Uses nested-aware regex.
    """
    # Try to find JSON in code blocks first
    json_match = re.search(r"```json\s*\n?(.*?)\n?\s*```", text, re.DOTALL)
    if json_match:
        try:
            return json.loads(json_match.group(1))
        except json.JSONDecodeError:
            log.warning("Found JSON block but couldn't parse it")

    # Fallback: find any JSON object with "direction" key.
    # This regex handles one level of nesting (entry, stop, target are dicts).
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
        *,
        think: Optional[bool] = None,
    ) -> str:
        """
        Send a chat request to Ollama and return the full response.
        Non-streaming — waits for the complete response.

        model: the Ollama model name to use (from user's selection).
        think: Optional thinking-mode toggle for thinking models (Gemma 4,
            Qwen3, etc.). None = let Ollama use its model default. False = force
            off (used by the screener AI where reasoning chain wastes tokens).
            True = force on (default for Analysis chat where reasoning is
            valued).
        """
        payload: dict = {
            "model": model,
            "messages": messages,
            "stream": False,
            "options": {
                "temperature": 0.3,     # Low temp for more consistent analysis
                "num_predict": 2048,    # Max tokens to generate
            },
        }
        if think is not None:
            payload["think"] = think

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

    async def chat_structured(
        self,
        messages: list[dict[str, str]],
        model: str,
        json_schema: dict,
        *,
        think: Optional[bool] = None,
    ) -> dict:
        """
        Send a chat request with Ollama's structured output (format parameter).

        The model is constrained to produce JSON matching the provided schema.
        This guarantees valid JSON — no regex parsing needed.

        Uses the reasoning_steps-first pattern: the schema's first property
        is a chain-of-thought field so the model reasons before committing
        to structured signal fields.

        model: the Ollama model name to use.
        json_schema: JSON Schema dict passed to Ollama's `format` parameter.
        think: see chat() — None = use Ollama default, True/False forces it.
        """
        payload: dict = {
            "model": model,
            "messages": messages,
            "stream": False,
            "format": json_schema,
            "options": {
                "temperature": 0.2,     # Even lower temp for structured output
                "num_predict": 2048,
            },
        }
        if think is not None:
            payload["think"] = think

        try:
            resp = await self._http.post("/api/chat", json=payload)
            resp.raise_for_status()
            data = resp.json()
            content = data.get("message", {}).get("content", "")
            return json.loads(content)
        except httpx.ConnectError:
            raise ConnectionError("Cannot connect to Ollama server")
        except httpx.TimeoutException:
            raise TimeoutError("Ollama request timed out (>120s)")
        except httpx.HTTPStatusError as e:
            raise RuntimeError(f"Ollama returned error: {e.response.status_code}")
        except json.JSONDecodeError as e:
            log.warning("Structured output returned invalid JSON: %s", e)
            raise ValueError(f"Model returned invalid JSON despite schema: {e}")

    async def chat_stream(
        self,
        messages: list[dict[str, str]],
        model: str,
        *,
        think: Optional[bool] = None,
    ) -> AsyncIterator[str]:
        """
        Send a chat request to Ollama and yield tokens as they arrive.
        Used for the streaming chat experience in the frontend.

        model: the Ollama model name to use (from user's selection).
        think: see chat() — None = use Ollama default, True/False forces it.
        """
        payload: dict = {
            "model": model,
            "messages": messages,
            "stream": True,
            "options": {
                "temperature": 0.3,
                "num_predict": 2048,
            },
        }
        if think is not None:
            payload["think"] = think

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
        watchlist: Optional[str] = None,
        indicator_priority: Optional[list[str]] = None,
    ) -> dict:
        """
        Run a full technical analysis for a stock.

        Two-call approach:
          Call 1 (narrative): Free-text analysis with reasoning. The model
              reads the indicator data and produces a natural-language analysis
              with entry/stop/target reasoning. No JSON required.
          Call 2 (signal): Structured JSON via Ollama's format parameter.
              The model has its own narrative in context and produces a
              guaranteed-valid signal using the reasoning_steps-first pattern
              (chain of thought before structured fields).

        This approach is more reliable than asking for JSON in free text:
          - Narrative quality improves (model isn't distracted by JSON syntax)
          - Signal extraction is guaranteed valid JSON (schema-constrained)
          - Small models work reliably (no regex fallback needed)
          - The reasoning_steps field gives the model CoT space even in
            the structured call

        Fallback: if structured output fails (old Ollama version or model
        doesn't support format), falls back to parsing JSON from the
        narrative response using regex.

        Args:
            watchlist: optional name of the watchlist this ticker came from.
                       When present, the system prompt gets watchlist-specific
                       framing (e.g., "RS Leaders" → favor trend continuation).

        Returns: {
            "session_id": str,
            "signal": dict | None,  (frontend-formatted signal)
            "message": str,         (full AI response text)
        }
        """
        session = self.get_or_create_session(session_id)
        session.symbol = symbol
        session.clear()

        # Build the context from all timeframes, then truncate if needed.
        # If priority is set, indicators are reordered so prioritized ones
        # appear first in the context (models attend more to earlier content).
        context = build_multi_timeframe_context(
            symbol, timeframe_data, indicator_priority=indicator_priority,
        )
        # Per-model token budget — smaller models get aggressive truncation,
        # beefier models get breathing room. See prompt_builder._MODEL_BUDGETS.
        budget = get_budget_for_model(model)
        context = truncate_context(context, budget_tokens=budget)

        # Dynamic system prompt — tailored to indicators, priority, + watchlist
        system_prompt = build_system_prompt(
            indicators=indicators_requested,
            watchlist=watchlist,
            indicator_priority=indicator_priority,
        )

        # Enriched user message with analysis structure and focus guidance
        user_message = build_analysis_user_message(
            symbol=symbol,
            context=context,
            timeframes=list(timeframe_data.keys()),
            indicators_requested=indicators_requested,
            indicator_priority=indicator_priority,
        )

        # Set up conversation
        session.add_system(system_prompt)
        session.add_user(user_message)

        # ── Call 1: Narrative analysis (free text) ──
        response_text = await self.chat(session.get_messages(), model=model)
        session.add_assistant(response_text)

        # ── Call 2: Signal extraction (structured output) ──
        raw_signal = None

        try:
            # Add the signal extraction prompt to the conversation
            signal_messages = session.get_messages() + [
                {"role": "user", "content": SIGNAL_EXTRACTION_PROMPT}
            ]

            raw_signal = await self.chat_structured(
                signal_messages,
                model=model,
                json_schema=SIGNAL_JSON_SCHEMA,
            )
            log.info("Structured signal extracted for %s via Ollama format", symbol)
        except (ValueError, ConnectionError, TimeoutError, RuntimeError) as e:
            # Structured output failed — fall back to parsing from narrative
            log.warning(
                "Structured output failed for %s (%s) — falling back to regex parse",
                symbol, e,
            )
            raw_signal = parse_signal_from_response(response_text)

            if not raw_signal:
                # Last resort: ask the model to produce JSON in free text
                log.info("Regex parse also failed for %s — requesting reformat", symbol)
                session.add_user(
                    "Please provide a trading signal as a JSON block wrapped in "
                    "```json ... ```. Include: direction, confidence, description, "
                    "entry (price + note), stop (price + note), target (price + note), "
                    "confirmations, cautions."
                )
                retry_response = await self.chat(session.get_messages(), model=model)
                session.add_assistant(retry_response)
                raw_signal = parse_signal_from_response(retry_response)

        # Strip reasoning_steps from the signal before sending to frontend
        # (it was for the model's chain-of-thought, not for display)
        if raw_signal and "reasoning_steps" in raw_signal:
            del raw_signal["reasoning_steps"]

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
