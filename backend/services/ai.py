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
import inspect
import json
import logging
import re
import uuid
from collections import OrderedDict
from decimal import Decimal
from time import monotonic
from typing import TYPE_CHECKING, AsyncIterator, Optional

if TYPE_CHECKING:
    from services.ai_analysis_preparation import PreparedAnalysisSnapshot
    from services.ollama_context import OllamaContextService

from exceptions import AIAnalysisTimeoutError

from models import AIProviderMetadata

# ── Per-stage analysis timeouts (seconds) ────────────────────
# Defined at module level so tests can patch them without touching internals.
#
# One-shot flow: only narrative + (rarely) reformat. Structured-output stage
# was removed — its per-token JSON-mode constraint was 5–10x slower than the
# narrative on 20B+ models and dominated total wall time.
_NARRATIVE_TIMEOUT: float = 180.0   # Free-text analysis with inline JSON block
_REFORMAT_TIMEOUT: float = 90.0     # Last-resort free-text reformat attempt
_OLLAMA_READ_TIMEOUT: float = 180.0
_OLLAMA_CONNECT_TIMEOUT: float = 10.0
_ANALYSIS_NUM_PREDICT: int = 4096

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
    build_full_prompt_context_bundle,
    build_analysis_user_message,
    build_system_prompt,
    get_budget_for_model,
    SIGNAL_EXTRACTION_PROMPT,       # noqa: F401 — kept for legacy callers/tests
    SIGNAL_JSON_SCHEMA,             # noqa: F401 — kept for legacy callers/tests
)
from services.ai_providers import AIProviderRegistry, OllamaLLMProvider  # noqa: E402
from services.ai_cloud_adapters import (  # noqa: E402
    AIProviderAuthError,
    AIProviderModelUnavailableError,
    AIProviderNetworkError,
    AIProviderRequestError,
    AIProviderRateLimitError,
    AIProviderTimeoutError,
    AIProviderTextResult,
)
from services.ai_signal_validation import (  # noqa: E402
    AISignalGroundingError,
    safe_neutral_signal,
    validate_signal_draft,
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


def strip_signal_json_from_response(text: str) -> str:
    """
    Remove the trailing fenced ```json``` signal block from a model response.

    The analysis prompt intentionally asks the model to append machine-readable
    JSON as the very last thing in the message so we can parse a structured
    signal. That block is useful for the backend, but noisy in the user-facing
    chat transcript.
    """
    json_match = re.search(r"\n*```json\s*\n.*?\n\s*```\s*$", text, re.DOTALL)
    if not json_match:
        return text

    candidate = json_match.group(0)
    if parse_signal_from_response(candidate) is None:
        return text

    return text[:json_match.start()].rstrip()


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

    def _format_price(value: object) -> str:
        if isinstance(value, Decimal):
            return f"${value:.2f}"
        if isinstance(value, (int, float)):
            return f"${value:.2f}"
        if value is None:
            return "—"
        return str(value)

    def _format_level_sub(value: object, note: object) -> str:
        if value is None:
            return "No grounded level"
        if isinstance(note, str) and note:
            return note
        return ""

    def _format_meta_value(value: object) -> str:
        if value is None:
            return "—"
        return str(value)

    return {
        "direction": signal.get("direction", "NEUTRAL"),
        "description": signal.get("description", ""),
        "confidence": _coerce_confidence(signal.get("confidence")),
        "levels": [
            {
                "label": "Entry",
                "value": _format_price(entry.get("price")),
                "sub": _format_level_sub(entry.get("price"), entry.get("note")),
            },
            {
                "label": "Stop",
                "value": _format_price(stop.get("price")),
                "sub": _format_level_sub(stop.get("price"), stop.get("note")),
                "color": "red",
            },
            {
                "label": "Target",
                "value": _format_price(target.get("price")),
                "sub": _format_level_sub(target.get("price"), target.get("note")),
                "color": "green",
            },
        ],
        "meta": [
            {"label": "R:R", "value": _format_meta_value(meta.get("risk_reward"))},
            {"label": "Score", "value": _format_meta_value(meta.get("score", "N/A"))},
            {"label": "ADX", "value": _format_meta_value(meta.get("adx_trend", "N/A"))},
            {"label": "Vol", "value": _format_meta_value(meta.get("volume_signal", "N/A"))},
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
        self.provider_name: str = "ollama"
        self.model: str = ""
        self.fallback_model: Optional[str] = None
        self.grounding_map: dict[str, frozenset[Decimal]] = {}

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
        self.grounding_map = {}


# ═══════════════════════════════════════════════════════════════
#  AI Service
# ═══════════════════════════════════════════════════════════════


class AiService:
    """
    Main AI service — orchestrates analysis and chat via Ollama.

    Created once during app startup. Holds active chat sessions
    and the HTTP client for Ollama communication.
    """

    def __init__(
        self,
        context_service: "OllamaContextService | None" = None,
        provider_registry: AIProviderRegistry | None = None,
    ) -> None:
        # Model is not hardcoded — it comes from the user's selection
        # stored in SQLite settings and set via OllamaLifecycle.selected_model.
        # The router passes the current model name into analyze()/follow_up().
        self._context_service = context_service
        self._provider_registry = provider_registry or AIProviderRegistry({
            "ollama": OllamaLLMProvider(),
        })
        self.sessions: OrderedDict[str, ChatSession] = OrderedDict()

    @property
    def provider_registry(self) -> AIProviderRegistry:
        return self._provider_registry

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
        provider_name: str = "ollama",
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
        provider = self._provider_registry.require(provider_name)
        return await provider.chat(messages=messages, model=model, think=think)

    async def _chat_analysis_with_metadata(
        self,
        *,
        messages: list[dict[str, str]],
        model: str,
        provider_name: str,
        provider: object | None = None,
    ) -> AIProviderTextResult:
        resolved_provider = provider or self._provider_registry.require(provider_name)
        chat_with_metadata = getattr(resolved_provider, "chat_with_metadata", None)
        if chat_with_metadata is not None:
            return await chat_with_metadata(messages=messages, model=model)

        if provider is None:
            content = await self.chat(
                messages, model=model, think=None, provider_name=provider_name,
            )
        else:
            content = await resolved_provider.chat(messages=messages, model=model, think=None)
        return AIProviderTextResult(
            content=content,
            metadata=AIProviderMetadata(
                provider_name="ollama",
                kind="local",
                model=model,
                estimated_cost=None,
                actual_cost=None,
                fallback_used=False,
            ),
            provider_request_id=None,
        )

    @staticmethod
    def _fallback_metadata(model: str) -> AIProviderMetadata:
        return AIProviderMetadata(
            provider_name="ollama",
            kind="local",
            model=model,
            estimated_cost=None,
            actual_cost=None,
            fallback_used=True,
        )

    async def _stream_analysis_with_metadata(
        self,
        *,
        messages: list[dict[str, str]],
        model: str,
        provider_name: str,
        provider: object | None = None,
    ) -> AsyncIterator[dict]:
        resolved_provider = provider or self._provider_registry.require(provider_name)
        stream_with_metadata = getattr(resolved_provider, "chat_stream_with_metadata", None)
        if stream_with_metadata is not None and inspect.isasyncgenfunction(stream_with_metadata):
            async for event in stream_with_metadata(messages=messages, model=model):
                yield event
            return

        chat_with_metadata = getattr(resolved_provider, "chat_with_metadata", None)
        if chat_with_metadata is not None:
            result = await chat_with_metadata(messages=messages, model=model)
            yield {"type": "token", "content": result.content}
            yield {"type": "metadata", "metadata": result.metadata.model_dump()}
            return

        if provider is None:
            token_stream = self.chat_stream(
                messages, model=model, think=None, provider_name=provider_name,
            )
        else:
            token_stream = resolved_provider.chat_stream(
                messages=messages, model=model, think=None,
            )
        async for token in token_stream:
            yield {"type": "token", "content": token}
        yield {
            "type": "metadata",
            "metadata": AIProviderMetadata(
                provider_name="ollama",
                kind="local",
                model=model,
                estimated_cost=None,
                actual_cost=None,
                fallback_used=False,
            ).model_dump(),
        }

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
        provider = self._provider_registry.require("ollama")
        return await provider.chat_structured(
            messages=messages,
            model=model,
            json_schema=json_schema,
            think=think,
        )

    async def chat_stream(
        self,
        messages: list[dict[str, str]],
        model: str,
        *,
        think: Optional[bool] = None,
        provider_name: str = "ollama",
    ) -> AsyncIterator[str]:
        """
        Send a chat request to Ollama and yield tokens as they arrive.
        Used for the streaming chat experience in the frontend.

        model: the Ollama model name to use (from user's selection).
        think: see chat() — None = use Ollama default, True/False forces it.
        """
        provider = self._provider_registry.require(provider_name)
        async for token in provider.chat_stream(
            messages=messages,
            model=model,
            think=think,
        ):
            yield token

    # ── Warmup ──────────────────────────────────────────────────

    async def warmup(self, model: str) -> None:
        """
        Pre-load the model into GPU/RAM by sending a minimal 1-token prompt.

        Ollama evicts models from memory after keep_alive expires.  Calling
        this on Analysis/Screener page mount ensures the first real request
        is fast.  The keep_alive=20m means the model stays loaded for 20
        minutes of inactivity, so calling this once per page visit is enough.
        """
        provider = self._provider_registry.require("ollama")
        await provider.warmup(model=model)

    # ── Analysis ────────────────────────────────────────────────

    # ── Internal: build the prompt + return primed session ─────────────

    async def _prepare_analysis_session(
        self,
        symbol: str,
        timeframe_data: dict[str, dict],
        indicators_display: list[str],
        indicator_names: list[str],
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

        indicators_display: UI label names (e.g. ["EMA Stack", "RSI"]) — shown
            in the user-facing narrative prompt.
        indicator_names: resolved backend names (e.g. ["ema", "rsi"]) — used
            by the fact builders and system prompt.
        """
        messages, grounding_map = await self._prepare_analysis_payload(
            symbol=symbol,
            timeframe_data=timeframe_data,
            indicators_display=indicators_display,
            indicator_names=indicator_names,
            model=model,
            watchlist=watchlist,
            indicator_priority=indicator_priority,
        )
        session = self.get_or_create_session(session_id)
        session.symbol = symbol
        session.clear()
        session.messages = [dict(message) for message in messages]
        session.grounding_map = grounding_map
        return session

    async def prepare_analysis_messages(
        self,
        *,
        symbol: str,
        timeframe_data: dict[str, dict],
        indicators_display: list[str],
        indicator_names: list[str],
        model: str,
        watchlist: Optional[str] = None,
        indicator_priority: Optional[list[str]] = None,
    ) -> list[dict[str, str]]:
        messages, _grounding_map = await self._prepare_analysis_payload(
            symbol=symbol,
            timeframe_data=timeframe_data,
            indicators_display=indicators_display,
            indicator_names=indicator_names,
            model=model,
            watchlist=watchlist,
            indicator_priority=indicator_priority,
        )
        return messages

    async def _prepare_analysis_payload(
        self,
        *,
        symbol: str,
        timeframe_data: dict[str, dict],
        indicators_display: list[str],
        indicator_names: list[str],
        model: str,
        watchlist: Optional[str] = None,
        indicator_priority: Optional[list[str]] = None,
    ) -> tuple[list[dict[str, str]], dict[str, frozenset[Decimal]]]:
        if self._context_service is not None:
            budget = await self._context_service.get_budget_for_model(model)
        else:
            budget = get_budget_for_model(model)

        bundle = build_full_prompt_context_bundle(
            symbol=symbol,
            timeframe_data=timeframe_data,
            indicator_priority=indicator_priority or [],
            budget_tokens=budget,
        )
        system_prompt = build_system_prompt(
            indicators_display=indicators_display,
            indicator_names=indicator_names,
            watchlist=watchlist,
            indicator_priority=indicator_priority,
        )
        user_message = build_analysis_user_message(
            symbol=symbol,
            context=bundle.context,
            timeframes=list(timeframe_data.keys()),
            indicators_requested=indicators_display,
            indicator_priority=indicator_priority,
        )
        return (
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
            bundle.grounding_map,
        )

    # ── Internal: parse + (one) reformat fallback ─────────────────────

    async def _extract_signal(
        self,
        session: ChatSession,
        narrative: str,
        model: str,
        symbol: str,
        provider_name: str = "ollama",
        provider: object | None = None,
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
                self._chat_with_provider(
                    session.get_messages(), model=model,
                    provider_name=provider_name, provider=provider,
                ),
                timeout=_REFORMAT_TIMEOUT,
            )
        except asyncio.TimeoutError:
            log.warning(
                "Reformat call timed out for %s after %ss — signal will be null",
                symbol, _REFORMAT_TIMEOUT,
            )
            return None
        if retry:
            return parse_signal_from_response(retry)
        return None

    async def _chat_with_provider(
        self,
        messages: list[dict[str, str]],
        *,
        model: str,
        provider_name: str,
        provider: object | None,
    ) -> str:
        if provider is None:
            return await self.chat(messages, model=model, provider_name=provider_name)
        chat_with_metadata = getattr(provider, "chat_with_metadata", None)
        if chat_with_metadata is not None:
            result = await chat_with_metadata(messages=messages, model=model)
            return result.content
        return await provider.chat(messages=messages, model=model, think=None)

    # ── Internal: post-process raw signal into frontend shape ─────────

    @staticmethod
    def _finalize_signal(
        raw_signal: Optional[dict],
        *,
        grounding_map: dict[str, frozenset[Decimal]] | None = None,
    ) -> Optional[dict]:
        """Validate signal geometry and convert to frontend ActionSignalCard shape."""
        if not raw_signal:
            return None
        cleaned = dict(raw_signal)
        cleaned.pop("reasoning_steps", None)
        cleaned["confidence"] = _coerce_confidence(cleaned.get("confidence"))

        try:
            validated = validate_signal_draft(cleaned, grounding_map=grounding_map)
        except AISignalGroundingError as exc:
            log.warning("Rejected ungrounded AI signal: %s", exc)
            validated = safe_neutral_signal(
                "Insufficient verified evidence for numeric trade levels"
            )

        return signal_to_frontend_format(validated.model_dump(mode="python"))

    # ── Public: full (non-streaming) analyze ──────────────────────────

    async def analyze(
        self,
        symbol: str,
        timeframe_data: dict[str, dict],
        indicators_display: list[str],
        indicator_names: list[str],
        model: str,
        session_id: Optional[str] = None,
        watchlist: Optional[str] = None,
        indicator_priority: Optional[list[str]] = None,
        context_mode: str = "none",
        context_bars: int = 10,
        provider_name: str = "ollama",
        fallback_model: Optional[str] = None,
        allow_fallback: bool = False,
        provider: object | None = None,
        # Legacy alias — prefer indicators_display + indicator_names
        indicators_requested: Optional[list[str]] = None,
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

        indicators_display: UI label names (e.g. ["EMA Stack"]) — user-facing.
        indicator_names: resolved backend names (e.g. ["ema"]) — fact builders.

        Returns: {
            "session_id": str,
            "signal": dict | None,
            "message": str,
        }
        """
        # Backward compat: if caller passes only indicators_requested, use it for both
        if indicators_requested is not None and not indicators_display:
            indicators_display = indicators_requested
            indicator_names = indicators_requested
        session = await self._prepare_analysis_session(
            symbol, timeframe_data, indicators_display, indicator_names, model,
            session_id, watchlist, indicator_priority,
            context_mode, context_bars,
        )
        session.provider_name = provider_name
        session.model = model
        session.fallback_model = fallback_model

        provider_result: AIProviderTextResult
        try:
            provider_result = await asyncio.wait_for(
                self._chat_analysis_with_metadata(
                    messages=session.get_messages(),
                    model=model,
                    provider_name=provider_name,
                    provider=provider,
                ),
                timeout=_NARRATIVE_TIMEOUT,
            )
        except asyncio.TimeoutError:
            raise AIAnalysisTimeoutError("narrative", _NARRATIVE_TIMEOUT)
        except (
            AIProviderAuthError,
            AIProviderModelUnavailableError,
            AIProviderNetworkError,
            AIProviderRequestError,
            AIProviderRateLimitError,
            AIProviderTimeoutError,
        ):
            if not allow_fallback or not fallback_model:
                raise
            fallback_content = await asyncio.wait_for(
                self.chat(
                    session.get_messages(),
                    model=fallback_model,
                    provider_name="ollama",
                ),
                timeout=_NARRATIVE_TIMEOUT,
            )
            provider_result = AIProviderTextResult(
                content=fallback_content,
                metadata=self._fallback_metadata(fallback_model),
                provider_request_id=None,
            )
            session.provider_name = "ollama"
            session.model = fallback_model

        response_text = provider_result.content
        clean_response_text = strip_signal_json_from_response(response_text)
        session.add_assistant(clean_response_text)

        raw_signal = await self._extract_signal(
            session, response_text, session.model, symbol,
            provider_name=session.provider_name,
            provider=provider if session.provider_name == provider_name else None,
        )
        frontend_signal = self._finalize_signal(
            raw_signal,
            grounding_map=session.grounding_map,
        )
        session.signal = frontend_signal

        return {
            "session_id": session.session_id,
            "signal": frontend_signal,
            "message": clean_response_text,
            "provider": provider_result.metadata.model_dump(),
        }

    # ── Public: streaming analyze ─────────────────────────────────────

    async def analyze_stream(
        self,
        symbol: str,
        timeframe_data: dict[str, dict],
        indicators_display: list[str],
        indicator_names: list[str],
        model: str,
        session_id: Optional[str] = None,
        watchlist: Optional[str] = None,
        indicator_priority: Optional[list[str]] = None,
        context_mode: str = "none",
        context_bars: int = 10,
        provider_name: str = "ollama",
        fallback_model: Optional[str] = None,
        allow_fallback: bool = False,
        provider: object | None = None,
        # Legacy alias — prefer indicators_display + indicator_names
        indicators_requested: Optional[list[str]] = None,
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

        indicators_display: UI label names — user-facing narrative prompt.
        indicator_names: resolved backend names — fact builders and system prompt.
        """
        # Backward compat: if caller passes only indicators_requested, use it for both
        if indicators_requested is not None and not indicators_display:
            indicators_display = indicators_requested
            indicator_names = indicators_requested
        session = await self._prepare_analysis_session(
            symbol, timeframe_data, indicators_display, indicator_names, model,
            session_id, watchlist, indicator_priority,
            context_mode, context_bars,
        )
        session.provider_name = provider_name
        session.model = model
        session.fallback_model = fallback_model

        accumulated: list[str] = []
        provider_metadata: dict | None = None
        try:
            async for event in self._stream_analysis_with_metadata(
                messages=session.get_messages(),
                model=model,
                provider_name=provider_name,
                provider=provider,
            ):
                if event.get("type") == "token":
                    token = event["content"]
                    accumulated.append(token)
                    yield {"type": "token", "content": token}
                elif event.get("type") == "metadata":
                    provider_metadata = event["metadata"]
        except (
            ConnectionError,
            TimeoutError,
            RuntimeError,
            AIProviderAuthError,
            AIProviderModelUnavailableError,
            AIProviderNetworkError,
            AIProviderRequestError,
            AIProviderRateLimitError,
            AIProviderTimeoutError,
        ) as e:
            if (
                provider_name != "ollama"
                and isinstance(
                    e,
                    (
                        AIProviderAuthError,
                        AIProviderModelUnavailableError,
                        AIProviderNetworkError,
                        AIProviderRequestError,
                        AIProviderRateLimitError,
                        AIProviderTimeoutError,
                    ),
                )
                and (not allow_fallback or not fallback_model)
            ):
                raise
            if allow_fallback and fallback_model and provider_name != "ollama":
                provider_metadata = self._fallback_metadata(fallback_model).model_dump()
                session.provider_name = "ollama"
                session.model = fallback_model
                async for token in self.chat_stream(
                    session.get_messages(),
                    model=fallback_model,
                    provider_name="ollama",
                ):
                    accumulated.append(token)
                    yield {"type": "token", "content": token}
            else:
                provider_metadata = AIProviderMetadata(
                    provider_name="ollama" if provider_name == "ollama" else provider_name,
                    kind="local" if provider_name == "ollama" else "cloud",
                    model=model,
                    estimated_cost=None,
                    actual_cost=None,
                    fallback_used=False,
                ).model_dump()
            # chat_stream itself yields error tokens on httpx failures, but
            # any unexpected error here is surfaced as a final done event so
            # the client can render something meaningful.
            log.warning("Stream error mid-analysis for %s: %s", symbol, e)

        full_text = "".join(accumulated)
        clean_full_text = strip_signal_json_from_response(full_text)
        session.add_assistant(clean_full_text)

        raw_signal = await self._extract_signal(
            session, full_text, session.model, symbol,
            provider_name=session.provider_name,
            provider=provider if session.provider_name == provider_name else None,
        )
        frontend_signal = self._finalize_signal(
            raw_signal,
            grounding_map=session.grounding_map,
        )
        session.signal = frontend_signal

        yield {
            "type": "done",
            "session_id": session.session_id,
            "signal": frontend_signal,
            "message": clean_full_text,
            "provider": provider_metadata,
        }

    async def analyze_prepared_stream(
        self,
        *,
        snapshot: "PreparedAnalysisSnapshot",
        provider: object | None,
        fallback_provider: object | None,
        grounding_map: dict[str, frozenset[Decimal]] | None = None,
    ) -> AsyncIterator[dict]:
        session = self.get_or_create_session(snapshot.request.session_id)
        session.symbol = snapshot.request.symbol
        session.messages = [dict(message) for message in snapshot.messages]
        session.provider_name = snapshot.provider_name
        session.model = snapshot.model.id
        session.grounding_map = grounding_map or {}

        accumulated: list[str] = []
        provider_metadata: dict | None = None
        if provider is None:
            if not snapshot.fallback_enabled or fallback_provider is None:
                raise AIProviderNetworkError("Cloud provider is unavailable")
            fallback_model = snapshot.local_model or ""
            provider_metadata = self._fallback_metadata(fallback_model).model_dump()
            session.provider_name = "ollama"
            session.model = fallback_model
            async for token in fallback_provider.chat_stream(
                messages=snapshot.messages,
                model=fallback_model,
                think=None,
            ):
                accumulated.append(token)
                yield {"type": "token", "content": token}
        else:
            try:
                async for event in provider.chat_stream_with_metadata(
                    messages=snapshot.messages,
                    model=snapshot.model.id,
                    max_tokens=snapshot.cost.max_output_tokens,
                ):
                    if event.get("type") == "token":
                        accumulated.append(event["content"])
                        yield event
                    elif event.get("type") == "metadata":
                        provider_metadata = event["metadata"]
            except (
                AIProviderAuthError,
                AIProviderModelUnavailableError,
                AIProviderNetworkError,
                AIProviderRequestError,
                AIProviderRateLimitError,
                AIProviderTimeoutError,
            ):
                if not snapshot.fallback_enabled or fallback_provider is None:
                    raise
                fallback_model = snapshot.local_model or ""
                provider_metadata = self._fallback_metadata(fallback_model).model_dump()
                session.provider_name = "ollama"
                session.model = fallback_model
                async for token in fallback_provider.chat_stream(
                    messages=snapshot.messages,
                    model=fallback_model,
                    think=None,
                ):
                    accumulated.append(token)
                    yield {"type": "token", "content": token}

        full_text = "".join(accumulated)
        clean_text = strip_signal_json_from_response(full_text)
        session.add_assistant(clean_text)
        raw_signal = await self._extract_signal(
            session,
            full_text,
            session.model,
            snapshot.request.symbol,
            provider_name=session.provider_name,
            provider=provider if session.provider_name == snapshot.provider_name else fallback_provider,
        )
        session.signal = self._finalize_signal(
            raw_signal,
            grounding_map=session.grounding_map,
        )
        yield {
            "type": "done",
            "session_id": session.session_id,
            "signal": session.signal,
            "message": clean_text,
            "provider": provider_metadata,
        }

    async def execute_prepared_analysis(
        self,
        *,
        messages: list[dict[str, str]],
        model: str,
        provider: object,
        max_tokens: int | None = None,
        grounding_map: dict[str, frozenset[Decimal]] | None = None,
    ) -> dict:
        """Execute prepared messages once without creating a chat session."""
        started = monotonic()
        chunks: list[str] = []
        metadata: dict | None = None
        stream_with_metadata = getattr(provider, "chat_stream_with_metadata", None)
        if stream_with_metadata is not None:
            kwargs = {"messages": messages, "model": model}
            if max_tokens is not None:
                kwargs["max_tokens"] = max_tokens
            async for event in stream_with_metadata(**kwargs):
                if event.get("type") == "token":
                    chunks.append(event["content"])
                elif event.get("type") == "metadata":
                    metadata = event["metadata"]
        else:
            async for token in provider.chat_stream(
                messages=messages, model=model, think=None,
            ):
                chunks.append(token)

        full_text = "".join(chunks)
        raw_signal = parse_signal_from_response(full_text)
        metadata = metadata or AIProviderMetadata(
            provider_name="ollama",
            kind="local",
            model=model,
            requested_model=model,
            resolved_model=model,
            duration_ms=round((monotonic() - started) * 1000),
        ).model_dump()
        if metadata.get("duration_ms") is None:
            metadata["duration_ms"] = round((monotonic() - started) * 1000)
        return {
            "message": strip_signal_json_from_response(full_text),
            "signal": self._finalize_signal(raw_signal, grounding_map=grounding_map),
            "provider": metadata,
        }

    async def follow_up(
        self,
        session_id: str,
        message: str,
        model: Optional[str] = None,
        provider: object | None = None,
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
        response_text = await self._chat_with_provider(
            session.get_messages(),
            model=model or session.model,
            provider_name=session.provider_name,
            provider=provider,
        )
        clean_response_text = strip_signal_json_from_response(response_text)
        session.add_assistant(clean_response_text)

        # Check if the response contains an updated signal
        raw_signal = parse_signal_from_response(response_text)
        if raw_signal:
            session.signal = self._finalize_signal(
                raw_signal,
                grounding_map=session.grounding_map,
            )

        return {
            "session_id": session.session_id,
            "signal": session.signal,
            "message": clean_response_text,
        }

    async def follow_up_stream(
        self,
        session_id: str,
        message: str,
        model: Optional[str] = None,
        provider: object | None = None,
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
        async for event in self._stream_analysis_with_metadata(
            messages=session.get_messages(),
            model=model or session.model,
            provider_name=session.provider_name,
            provider=provider,
        ):
            if event.get("type") == "token":
                token = event["content"]
                full_response += token
                yield token

        clean_full_response = strip_signal_json_from_response(full_response)
        session.add_assistant(clean_full_response)

        # Check for signal update
        raw_signal = parse_signal_from_response(full_response)
        if raw_signal:
            session.signal = self._finalize_signal(
                raw_signal,
                grounding_map=session.grounding_map,
            )

    # ── Cleanup ─────────────────────────────────────────────────

    async def shutdown(self) -> None:
        """Clean shutdown — close HTTP client."""
        provider = self._provider_registry.require("ollama")
        close_provider = getattr(provider, "aclose", None)
        if close_provider is not None:
            await close_provider()
        self.sessions.clear()
        log.info("AI service shut down")
