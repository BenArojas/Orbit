"""
Tests for AI analysis timeout guards.

Covers:
  - AIAnalysisTimeoutError is raised when the narrative call exceeds its timeout
  - AIAnalysisTimeoutError is raised when the signal extraction call exceeds its timeout
  - The router catches AIAnalysisTimeoutError and returns a graceful AnalyzeResponse
    (no 500, no stack trace to the client)
  - Error attributes (stage, timeout_s, message) are correct
"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
import pytest

from exceptions import AIAnalysisTimeoutError


# ── Exception shape ───────────────────────────────────────────

class TestAIAnalysisTimeoutError:
    def test_attributes_set_correctly(self):
        err = AIAnalysisTimeoutError(stage="narrative", timeout_s=90.0)
        assert err.stage == "narrative"
        assert err.timeout_s == 90.0

    def test_message_includes_stage_and_timeout(self):
        err = AIAnalysisTimeoutError(stage="signal_extraction", timeout_s=45.0)
        assert "signal_extraction" in str(err)
        assert "45" in str(err)

    def test_is_ai_error_subclass(self):
        from exceptions import AIError
        err = AIAnalysisTimeoutError(stage="narrative", timeout_s=90.0)
        assert isinstance(err, AIError)


# ── Service-level timeout ─────────────────────────────────────

class TestAiServiceTimeouts:
    """
    AiService.analyze() wraps Ollama calls with asyncio.wait_for.
    When a call takes longer than its allotted time, it raises
    AIAnalysisTimeoutError with the correct stage name.
    """

    @pytest.mark.asyncio
    async def test_narrative_timeout_raises_error(self):
        """If the narrative call hangs, AIAnalysisTimeoutError is raised."""
        from services.ai import AiService

        svc = AiService()

        async def slow_chat(*_args, **_kwargs):
            await asyncio.sleep(9999)
            return ""

        with patch.object(svc, "chat", side_effect=slow_chat):
            with patch("services.ai._NARRATIVE_TIMEOUT", 0.01):
                with pytest.raises(AIAnalysisTimeoutError) as exc_info:
                    await svc.analyze(
                        symbol="AAPL",
                        timeframe_data={"1D": {"candles": [], "indicators": [], "fibonacci": None}},
                        indicators_requested=["rsi"],
                        model="gemma4:4b",
                    )

        assert exc_info.value.stage == "narrative"

    @pytest.mark.asyncio
    async def test_signal_extraction_timeout_falls_back_to_regex(self):
        """
        If the structured-output call times out, the service falls back to
        regex parsing on the narrative text — does NOT raise.
        """
        from services.ai import AiService

        svc = AiService()

        async def fast_chat(*_args, **_kwargs):
            return '```json\n{"direction": "LONG", "confidence": 70, "description": "test", "entry": {"price": 100, "note": ""}, "stop": {"price": 95, "note": ""}, "target": {"price": 110, "note": ""}, "confirmations": [], "cautions": [], "meta": {}}\n```'

        async def slow_structured(*_args, **_kwargs):
            await asyncio.sleep(9999)
            return {}

        with (
            patch.object(svc, "chat", side_effect=fast_chat),
            patch.object(svc, "chat_structured", side_effect=slow_structured),
            patch("services.ai._EXTRACTION_TIMEOUT", 0.01),
        ):
            result = await svc.analyze(
                symbol="AAPL",
                timeframe_data={"1D": {"candles": [], "indicators": [], "fibonacci": None}},
                indicators_requested=["rsi"],
                model="gemma4:4b",
            )

        # Should return successfully — narrative + regex-parsed signal
        assert result["session_id"]
        assert result["message"]

    @pytest.mark.asyncio
    async def test_reformat_timeout_returns_null_signal(self):
        """
        If the last-resort reformat call also times out, the service returns
        signal=None in the result (graceful degradation, not a crash).
        """
        from services.ai import AiService

        svc = AiService()
        call_count = 0

        async def chat_side_effect(*_args, **_kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return "No JSON here, just a narrative"
            # Second call (reformat) — hang
            await asyncio.sleep(9999)
            return ""

        async def failed_structured(*_args, **_kwargs):
            raise ValueError("schema not supported")

        with (
            patch.object(svc, "chat", side_effect=chat_side_effect),
            patch.object(svc, "chat_structured", side_effect=failed_structured),
            patch("services.ai._REFORMAT_TIMEOUT", 0.01),
        ):
            result = await svc.analyze(
                symbol="AAPL",
                timeframe_data={"1D": {"candles": [], "indicators": [], "fibonacci": None}},
                indicators_requested=["rsi"],
                model="gemma4:4b",
            )

        assert result["signal"] is None
        assert result["message"]  # Narrative is still returned


# ── Router-level graceful handling ────────────────────────────

class TestAnalyzeRouterTimeout:
    """
    POST /ai/analyze catches AIAnalysisTimeoutError from the service
    and returns an AnalyzeResponse with a user-friendly message, not a 500.
    """

    @pytest.mark.asyncio
    async def test_router_returns_graceful_response_on_timeout(self):
        from routers.indicators import compute_indicators  # noqa — just verify import path works
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
            side_effect=AIAnalysisTimeoutError("narrative", 90.0)
        )

        mock_ollama = MagicMock()
        mock_ollama.status.return_value = {"ready": True, "state": "ready"}
        mock_ollama.selected_model = "gemma4:4b"

        response = await analyze(
            request=req,
            ibkr=mock_ibkr,
            ai=mock_ai,
            ollama=mock_ollama,
        )

        # Must NOT raise — must return an AnalyzeResponse
        assert response.signal is None
        assert "timed out" in response.message.lower()
        assert "AAPL" in response.message
        assert "narrative" in response.message or "narrativ" in response.message.lower()
