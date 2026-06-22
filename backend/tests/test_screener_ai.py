"""
Tests for the screener AI service — critical-promise subset.

Covers:
  - External failures stop safely and visibly (AIError on connect/timeout/HTTP/invalid JSON)
  - Truncation guards surface typed errors instead of silent corruption
  - think=False default prevents token-budget exhaustion on structured output
"""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from exceptions import AIError
from services.screener_ai import ScreenerAiService


# ── External-failure handling ────────────────────────────────


class TestGenerateFilters:

    @pytest.mark.asyncio
    async def test_connect_error_raises_ai_error(self):
        """Test that connection errors are converted to AIError."""
        svc = ScreenerAiService()

        with patch.object(svc._http, "post", new_callable=AsyncMock) as mock_post:
            mock_post.side_effect = __import__("httpx").ConnectError("Failed to connect")

            with pytest.raises(AIError):
                await svc.generate_filters(
                    query="test",
                    model="gemma4:26b",
                )

        await svc.shutdown()

    @pytest.mark.asyncio
    async def test_timeout_error_raises_ai_error(self):
        """Test that timeout errors are converted to AIError."""
        import httpx
        svc = ScreenerAiService()

        with patch.object(svc._http, "post", new_callable=AsyncMock) as mock_post:
            mock_post.side_effect = httpx.TimeoutException("Request timed out")

            with pytest.raises(AIError, match="timed out"):
                await svc.generate_filters(
                    query="test",
                    model="gemma4:26b",
                )

        await svc.shutdown()

    @pytest.mark.asyncio
    async def test_http_error_raises_ai_error(self):
        """Test that HTTP errors are converted to AIError."""
        import httpx
        svc = ScreenerAiService()

        mock_response = MagicMock()
        mock_response.status_code = 500
        mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
            "Server error", request=MagicMock(), response=mock_response
        )

        with patch.object(svc._http, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = mock_response

            with pytest.raises(AIError, match="error"):
                await svc.generate_filters(
                    query="test",
                    model="gemma4:26b",
                )

        await svc.shutdown()

    @pytest.mark.asyncio
    async def test_invalid_json_response_raises_ai_error(self):
        """Test that invalid JSON responses are converted to AIError."""
        svc = ScreenerAiService()

        mock_response = MagicMock()
        mock_response.json.return_value = {
            "message": {
                "content": "not valid json {"
            }
        }

        with patch.object(svc._http, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = mock_response

            with pytest.raises(AIError, match="invalid"):
                await svc.generate_filters(
                    query="test",
                    model="gemma4:26b",
                )

        await svc.shutdown()


# ── Truncation / empty-content guards ───────────────────────


class TestTruncationGuards:
    """
    Two specific Ollama failure modes were silently surfacing as either a
    cryptic JSONDecodeError or a 60s timeout in production. Both should now
    raise a typed AIError with a user-actionable message.
    """

    @pytest.mark.asyncio
    async def test_done_reason_length_raises_ai_error(self):
        """num_predict exhausted → typed AIError, not JSONDecodeError."""
        svc = ScreenerAiService()
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "message": {"content": '{"reasoning":"...","filt'},
            "done_reason": "length",
        }

        with patch.object(svc._http, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = mock_response
            with pytest.raises(AIError, match="truncated"):
                await svc.generate_filters(query="test", model="gemma4:26b")

        await svc.shutdown()

    @pytest.mark.asyncio
    async def test_empty_content_raises_ai_error(self):
        """Thinking model put everything in `thinking` → empty content."""
        svc = ScreenerAiService()
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "message": {
                "content": "",
                "thinking": "Long chain of thought went here...",
            },
            "done_reason": "stop",
        }

        with patch.object(svc._http, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = mock_response
            with pytest.raises(AIError, match="empty"):
                await svc.generate_filters(query="test", model="gemma4:26b")

        await svc.shutdown()

    @pytest.mark.asyncio
    async def test_whitespace_only_content_raises_ai_error(self):
        """Whitespace counts as empty — same guard fires."""
        svc = ScreenerAiService()
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "message": {"content": "   \n  \t "},
            "done_reason": "stop",
        }

        with patch.object(svc._http, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = mock_response
            with pytest.raises(AIError, match="empty"):
                await svc.generate_filters(query="test", model="gemma4:26b")

        await svc.shutdown()


# ── think parameter default ──────────────────────────────────


class TestThinkParameter:
    """
    Screener AI must default to think=False (thinking models like Gemma 4 26B
    burn their token budget on chain-of-thought before producing structured
    JSON, which timed out in production).
    """

    @pytest.mark.asyncio
    async def test_think_defaults_to_false_in_payload(self):
        svc = ScreenerAiService()
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "message": {"content": '{"reasoning":"x","filters":[],"summary":"x"}'}
        }

        with patch.object(svc._http, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = mock_response
            await svc.generate_filters(query="test", model="gemma4:26b")

            payload = mock_post.call_args.kwargs["json"]
            assert payload["think"] is False, (
                "Screener AI must default to think=False so thinking models "
                "don't burn the token budget before emitting JSON."
            )

        await svc.shutdown()
