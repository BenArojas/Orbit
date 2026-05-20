"""
Tests for AI analysis timeout guards (one-shot flow).

The analyze flow was reworked to a single Ollama call: the narrative ends
with a fenced ```json``` block. Parsing is local; one reformat fallback
remains if the model omits the JSON.

Covers:
  - AIAnalysisTimeoutError exception shape
  - Narrative timeout raises AIAnalysisTimeoutError("narrative", ...)
  - Inline JSON in narrative is parsed without a second Ollama call
  - When the narrative has no JSON, ONE reformat call is attempted
  - Reformat timeout → graceful signal=None, narrative still returned
  - Router catches AIAnalysisTimeoutError and returns a friendly response
"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
import pytest

from exceptions import AIAnalysisTimeoutError


# ── Exception shape ───────────────────────────────────────────

class TestAIAnalysisTimeoutError:
    def test_attributes_set_correctly(self):
        err = AIAnalysisTimeoutError(stage="narrative", timeout_s=120.0)
        assert err.stage == "narrative"
        assert err.timeout_s == 120.0

    def test_message_includes_stage_and_timeout(self):
        err = AIAnalysisTimeoutError(stage="narrative", timeout_s=120.0)
        assert "narrative" in str(err)
        assert "120" in str(err)

    def test_is_ai_error_subclass(self):
        from exceptions import AIError
        err = AIAnalysisTimeoutError(stage="narrative", timeout_s=120.0)
        assert isinstance(err, AIError)


# ── Service-level: one-shot flow ──────────────────────────────

_INLINE_JSON_NARRATIVE = (
    "AAPL is showing strong momentum with RSI at 65 and price above EMA-50.\n\n"
    "```json\n"
    "{\n"
    '  "direction": "LONG", "confidence": 70, "description": "Trend continuation",\n'
    '  "entry":  {"price": 180.0, "note": "above resistance"},\n'
    '  "stop":   {"price": 175.0, "note": "below EMA-50"},\n'
    '  "target": {"price": 195.0, "note": "next swing high"},\n'
    '  "confirmations": ["RSI bullish"], "cautions": [],\n'
    '  "meta": {"risk_reward": "1:3", "score": "8/10",\n'
    '           "adx_trend": "Strong", "volume_signal": "Above avg"}\n'
    "}\n"
    "```"
)


class TestAiServiceOneShot:
    """The new analyze() pipeline does ONE chat call when JSON is inline."""

    @pytest.mark.asyncio
    async def test_narrative_timeout_raises_error(self):
        """If the narrative call hangs, AIAnalysisTimeoutError is raised."""
        from services.ai import AiService

        svc = AiService()

        async def slow_chat(*_args, **_kwargs):
            await asyncio.sleep(9999)
            return ""

        with patch.object(svc, "chat", side_effect=slow_chat), \
             patch("services.ai._NARRATIVE_TIMEOUT", 0.01):
            with pytest.raises(AIAnalysisTimeoutError) as exc_info:
                await svc.analyze(
                    symbol="AAPL",
                    timeframe_data={"1D": {"candles": [], "indicators": [], "fibonacci": None}},
                    indicators_requested=["rsi"],
                    model="gemma4:4b",
                )
        assert exc_info.value.stage == "narrative"

    @pytest.mark.asyncio
    async def test_inline_json_parsed_without_second_call(self):
        """When the narrative includes a fenced JSON block, no reformat call is made."""
        from services.ai import AiService

        svc = AiService()
        chat_mock = AsyncMock(return_value=_INLINE_JSON_NARRATIVE)

        with patch.object(svc, "chat", chat_mock):
            result = await svc.analyze(
                symbol="AAPL",
                timeframe_data={"1D": {"candles": [], "indicators": [], "fibonacci": None}},
                indicators_requested=["rsi"],
                model="gemma4:4b",
            )

        assert chat_mock.await_count == 1, "Should be exactly ONE Ollama call"
        assert result["signal"] is not None
        assert result["signal"]["direction"] == "LONG"
        # The service strips the trailing ```json``` fence before returning the
        # message; only the narrative text should remain.
        assert result["message"] == "AAPL is showing strong momentum with RSI at 65 and price above EMA-50."
        assert "```json" not in result["message"]

    @pytest.mark.asyncio
    async def test_missing_json_triggers_one_reformat(self):
        """No JSON in narrative → one reformat attempt."""
        from services.ai import AiService

        svc = AiService()
        responses = ["No JSON in this narrative.", _INLINE_JSON_NARRATIVE]
        chat_mock = AsyncMock(side_effect=responses)

        with patch.object(svc, "chat", chat_mock):
            result = await svc.analyze(
                symbol="AAPL",
                timeframe_data={"1D": {"candles": [], "indicators": [], "fibonacci": None}},
                indicators_requested=["rsi"],
                model="gemma4:4b",
            )

        assert chat_mock.await_count == 2, "narrative + reformat = 2 calls"
        assert result["signal"] is not None
        assert result["signal"]["direction"] == "LONG"
        # The originally-streamed narrative is what the user sees, not the reformat
        assert result["message"] == "No JSON in this narrative."

    @pytest.mark.asyncio
    async def test_reformat_timeout_returns_null_signal(self):
        """Reformat hangs → signal=None, narrative still returned (no crash)."""
        from services.ai import AiService

        svc = AiService()
        call_count = 0

        async def chat_side_effect(*_args, **_kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return "Narrative without JSON."
            await asyncio.sleep(9999)  # reformat hangs
            return ""

        with patch.object(svc, "chat", side_effect=chat_side_effect), \
             patch("services.ai._REFORMAT_TIMEOUT", 0.01):
            result = await svc.analyze(
                symbol="AAPL",
                timeframe_data={"1D": {"candles": [], "indicators": [], "fibonacci": None}},
                indicators_requested=["rsi"],
                model="gemma4:4b",
            )

        assert result["signal"] is None
        assert result["message"] == "Narrative without JSON."

    @pytest.mark.asyncio
    async def test_reformat_failure_returns_null_signal(self):
        """Reformat returns text without JSON → signal=None (no third call)."""
        from services.ai import AiService

        svc = AiService()
        chat_mock = AsyncMock(side_effect=["No JSON.", "Still no JSON here either."])

        with patch.object(svc, "chat", chat_mock):
            result = await svc.analyze(
                symbol="AAPL",
                timeframe_data={"1D": {"candles": [], "indicators": [], "fibonacci": None}},
                indicators_requested=["rsi"],
                model="gemma4:4b",
            )

        assert chat_mock.await_count == 2
        assert result["signal"] is None


# ── Streaming variant ─────────────────────────────────────────

class TestAiServiceStreaming:
    @pytest.mark.asyncio
    async def test_analyze_stream_yields_tokens_then_done(self):
        """analyze_stream emits each token, then a final done with signal."""
        from services.ai import AiService

        svc = AiService()

        async def fake_stream(*_args, **_kwargs):
            for tok in ["Hello", " world", " ", _INLINE_JSON_NARRATIVE]:
                yield tok

        with patch.object(svc, "chat_stream", side_effect=fake_stream):
            events = []
            async for ev in svc.analyze_stream(
                symbol="AAPL",
                timeframe_data={"1D": {"candles": [], "indicators": [], "fibonacci": None}},
                indicators_requested=["rsi"],
                model="gemma4:4b",
            ):
                events.append(ev)

        token_events = [e for e in events if e["type"] == "token"]
        done_events = [e for e in events if e["type"] == "done"]

        assert len(token_events) == 4
        assert len(done_events) == 1
        assert done_events[0]["signal"] is not None
        assert done_events[0]["signal"]["direction"] == "LONG"


# ── Router-level graceful handling ────────────────────────────

class TestAnalyzeRouterTimeout:
    @pytest.mark.asyncio
    async def test_router_returns_graceful_response_on_timeout(self):
        from routers.ai import analyze
        from models import AnalyzeRequest

        req = AnalyzeRequest(
            conid=265598,
            symbol="AAPL",
            timeframes=["D"],
            indicators=["RSI"],
        )

        mock_ibkr = MagicMock()
        mock_ibkr.history = AsyncMock(return_value={"data": []})

        mock_ai = MagicMock()
        mock_ai.analyze = AsyncMock(
            side_effect=AIAnalysisTimeoutError("narrative", 120.0)
        )

        mock_ollama = MagicMock()
        mock_ollama.status.return_value = {"ready": True, "state": "ready"}
        mock_ollama.selected_model = "gemma4:4b"

        response = await analyze(
            request=req, ibkr=mock_ibkr, ai=mock_ai, ollama=mock_ollama,
        )

        assert response.signal is None
        assert "timed out" in response.message.lower()
        assert "AAPL" in response.message
        assert "narrative" in response.message or "narrativ" in response.message.lower()
