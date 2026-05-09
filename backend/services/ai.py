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

import asyncio
import json
import logging
import re
import uuid
from collections import OrderedDict
from typing import AsyncIterator, Optional

import httpx

from exceptions import AIAnalysisTimeoutError

from config import OLLAMA_HOST
from models import CandleData

# ── Per-stage analysis timeouts (seconds) ────────────────────
# Defined at module level so tests can patch them without touching internals.
#
# One-shot flow: only narrative + (rarely) reformat. Structured-output stage
# was removed — its per-token JSON-mode constraint was 5–10x slower than the
# narrative on 20B+ models and dominated total wall time.
_NARRATIVE_TIMEOUT: float = 120.0   # Free-text analysis with inline JSON block
_REFORMAT_TIMEOUT: float = 45.0     # Last-resort free-text reformat attempt

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
    SIGNAL_EXTRACTION_PROMPT,       # noqa: F401 — kept for legacy callers/tests
    SIGNAL_JSON_SCHEMA,             # noqa: F401 — kept for legacy callers/tests
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


def _coerce_confidence(value: int | str | None) -> int:
    """
    Coerce model confidence to an int in [0, 100].

    The model sometimes returns a string label ("HIGH", "MEDIUM", "LOW")
    instead of the integer the schema specifies.  Map those to sensible
    defaults rather than letting the value fall through to Pydantic where
    it would raise a ValidationError.
    """
    _LABEL_MAP: dict[str, int] = {
        "HIGH": 75,
        "MEDIUM": 50,
        "MED": 50,
        "LOW": 25,
    }
    if isinstance(value, int):
        return max(0, min(100, value))
    if isinstance(value, str):
        upper = value.strip().upper()
        if upper in _LABEL_MAP:
            return _LABEL_MAP[upper]
        try:
            return max(0, min(100, int(upper)))
        except ValueError:
            return 50
    return 50


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
        "confidence": _coerce_confidence(signal.get("confidence")),
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
            "keep_alive": "20m",
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
            "keep_alive": "20m",
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
            "keep_alive": "20m",
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

    # ── Warmup ──────────────────────────────────────────────────

    async def warmup(self, model: str) -> None:
        """
        Pre-load the model into GPU/RAM by sending a minimal 1-token prompt.

        Ollama evicts models from memory after keep_alive expires.  Calling
        this on Analysis/Screener page mount ensures the first real request
        is fast.  The keep_alive=20m means the model stays loaded for 20
        minutes of inactivity, so calling this once per page visit is enough.
        """
        payload = {
            "model": model,
            "messages": [{"role": "user", "content": "hi"}],
            "stream": False,
            "keep_alive": "20m",
            "options": {"num_predict": 1},
        }
        try:
            resp = await self._http.post("/api/chat", json=payload, timeout=30.0)
            resp.raise_for_status()
        except (httpx.ConnectError, httpx.TimeoutException, httpx.HTTPStatusError) as e:
            # Warmup failure is non-fatal — log and continue
            log.debug("Warmup request failed (non-fatal): %s", e)

    # ── Analysis ────────────────────────────────────────────────

    # ── Internal: build the prompt + return primed session ─────────────

    def _prepare_analysis_session(
        self,
        symbol: str,
        timeframe_data: dict[str, dict],
        indicators_requested: list[str],
        model: str,
        session_id: Optional[str],
        watchlist: Optional[str],
        indicator_priority: Optional[list[str]],
        context_mode: str,
        context_bars: int,
    ) -> ChatSession:
        """
        Prepare a ChatSession with system + user messages ready to send to
        Ollama. Shared by both `analyze` and `analyze_stream` so the streaming
        path stays in lockstep with the non-streaming one.
        """
        session = self.get_or_create_session(session_id)
        session.symbol = symbol
        session.clear()

        context = build_multi_timeframe_context(
            symbol, timeframe_data,
            indicator_priority=indicator_priority,
            context_mode=context_mode,
            context_bars=context_bars,
        )
        budget = get_budget_for_model(model)
        context = truncate_context(context, budget_tokens=budget)

        system_prompt = build_system_prompt(
            indicators=indicators_requested,
            watchlist=watchlist,
            indicator_priority=indicator_priority,
        )

        # The analysis user message now ends with SIGNAL_INLINE_JSON_INSTRUCTION,
        # asking the model to emit a fenced ```json``` block as the LAST thing
        # in its response. We parse that block locally — no second Ollama call.
        user_message = build_analysis_user_message(
            symbol=symbol,
            context=context,
            timeframes=list(timeframe_data.keys()),
            indicators_requested=indicators_requested,
            indicator_priority=indicator_priority,
        )

        session.add_system(system_prompt)
        session.add_user(user_message)
        return session

    # ── Internal: parse + (one) reformat fallback ─────────────────────

    async def _extract_signal(
        self,
        session: ChatSession,
        narrative: str,
        model: str,
        symbol: str,
    ) -> Optional[dict]:
        """
        Parse the trailing ```json``` block from the narrative.

        On failure (model forgot the JSON, malformed, etc.), make ONE
        reformat attempt asking only for the JSON block. If that times out
        too, give up gracefully — the narrative is still useful to the user
        even without a structured signal.
        """
        raw_signal = parse_signal_from_response(narrative)
        if raw_signal:
            return raw_signal

        log.info(
            "Inline JSON missing for %s — requesting one reformat attempt",
            symbol,
        )
        session.add_user(
            "Your previous response did not include the required JSON block. "
            "Please reply with ONLY a fenced ```json ... ``` block containing "
            "the signal (direction, confidence, description, entry, stop, "
            "target, confirmations, cautions, meta). No other text."
        )
        try:
            retry = await asyncio.wait_for(
                self.chat(session.get_messages(), model=model),
                timeout=_REFORMAT_TIMEOUT,
            )
        except asyncio.TimeoutError:
            log.warning(
                "Reformat call timed out for %s after %ss — signal will be null",
                symbol, _REFORMAT_TIMEOUT,
            )
            return None
        if retry:
            session.add_assistant(retry)
            return parse_signal_from_response(retry)
        return None

    # ── Internal: post-process raw signal into frontend shape ─────────

    @staticmethod
    def _finalize_signal(raw_signal: Optional[dict]) -> Optional[dict]:
        """Strip reasoning_steps + convert to frontend ActionSignalCard shape."""
        if not raw_signal:
            return None
        if "reasoning_steps" in raw_signal:
            del raw_signal["reasoning_steps"]
        return signal_to_frontend_format(raw_signal)

    # ── Public: full (non-streaming) analyze ──────────────────────────

    async def analyze(
        self,
        symbol: str,
        timeframe_data: dict[str, dict],
        indicators_requested: list[str],
        model: str,
        session_id: Optional[str] = None,
        watchlist: Optional[str] = None,
        indicator_priority: Optional[list[str]] = None,
        context_mode: str = "none",
        context_bars: int = 10,
    ) -> dict:
        """
        Run a full technical analysis for a stock — one-shot flow.

        Single Ollama call. The user-message prompt ends with a
        SIGNAL_INLINE_JSON_INSTRUCTION block instructing the model to append
        a ```json``` block with the signal as the last thing in its response.
        We parse that block locally with regex.

        Fallback: if parsing fails, ONE reformat attempt asking only for the
        JSON. If that also fails, return the narrative with signal=None —
        the analysis text is still useful to the trader.

        This replaces the old three-stage flow (narrative → format=json →
        reformat), which on 20B+ models routinely took 2+ minutes due to
        the JSON-mode extraction stage timing out at 45s.

        Returns: {
            "session_id": str,
            "signal": dict | None,
            "message": str,
        }
        """
        session = self._prepare_analysis_session(
            symbol, timeframe_data, indicators_requested, model,
            session_id, watchlist, indicator_priority,
            context_mode, context_bars,
        )

        try:
            response_text = await asyncio.wait_for(
                self.chat(session.get_messages(), model=model),
                timeout=_NARRATIVE_TIMEOUT,
            )
        except asyncio.TimeoutError:
            raise AIAnalysisTimeoutError("narrative", _NARRATIVE_TIMEOUT)
        session.add_assistant(response_text)

        raw_signal = await self._extract_signal(session, response_text, model, symbol)
        frontend_signal = self._finalize_signal(raw_signal)
        session.signal = frontend_signal

        return {
            "session_id": session.session_id,
            "signal": frontend_signal,
            "message": response_text,
        }

    # ── Public: streaming analyze ─────────────────────────────────────

    async def analyze_stream(
        self,
        symbol: str,
        timeframe_data: dict[str, dict],
        indicators_requested: list[str],
        model: str,
        session_id: Optional[str] = None,
        watchlist: Optional[str] = None,
        indicator_priority: Optional[list[str]] = None,
        context_mode: str = "none",
        context_bars: int = 10,
    ) -> AsyncIterator[dict]:
        """
        Stream the analysis. Yields events as dicts:

            {"type": "token",   "content": "..."}    # raw model tokens
            {"type": "done",    "session_id": "...",
                                "signal": {...} | None,
                                "message": "<full narrative>"}

        The frontend SSE adapter serialises each yielded event onto the wire.

        Same prompt + parse contract as `analyze` — the model emits a fenced
        JSON block at the end of its narrative. We accumulate tokens, then
        parse the signal once the stream completes. If parsing fails, we
        attempt one (non-streamed) reformat call before yielding `done`.
        """
        session = self._prepare_analysis_session(
            symbol, timeframe_data, indicators_requested, model,
            session_id, watchlist, indicator_priority,
            context_mode, context_bars,
        )

        accumulated: list[str] = []
        try:
            async for token in self.chat_stream(session.get_messages(), model=model):
                accumulated.append(token)
                yield {"type": "token", "content": token}
        except (ConnectionError, TimeoutError, RuntimeError) as e:
            # chat_stream itself yields error tokens on httpx failures, but
            # any unexpected error here is surfaced as a final done event so
            # the client can render something meaningful.
            log.warning("Stream error mid-analysis for %s: %s", symbol, e)

        full_text = "".join(accumulated)
        session.add_assistant(full_text)

        raw_signal = await self._extract_signal(session, full_text, model, symbol)
        frontend_signal = self._finalize_signal(raw_signal)
        session.signal = frontend_signal

        yield {
            "type": "done",
            "session_id": session.session_id,
            "signal": frontend_signal,
            "message": full_text,
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
