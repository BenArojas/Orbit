"""
Tests for the screener AI service (Phase 5C — AI-assisted screener).

All tests mock the httpx client — no live Ollama needed.
"""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from models import AiFilterRequest, AiFilterResponse, AiFilterSuggestion
from exceptions import AIError
from services.screener_ai import (
    ScreenerAiService,
    FILTER_CATALOGUE,
    _build_catalogue_text,
)


# ── Tests for _build_catalogue_text ────────────────────────────


class TestBuildCatalogueText:

    def test_returns_non_empty_string(self):
        text = _build_catalogue_text()
        assert isinstance(text, str)
        assert len(text) > 0

    def test_includes_sample_filters(self):
        text = _build_catalogue_text()
        assert "marketCapAbove1e6" in text
        assert "minPeRatio" in text
        assert "volumeAbove" in text

    def test_includes_filter_labels(self):
        text = _build_catalogue_text()
        assert "Market Cap ≥" in text
        assert "P/E" in text

    def test_includes_example_values(self):
        text = _build_catalogue_text()
        # At least some examples should be in the text
        assert "10000" in text or "2000" in text

    def test_includes_notes_when_present(self):
        text = _build_catalogue_text()
        # Some filters have notes
        assert "//" in text


# ── Tests for ScreenerAiService.generate_filters ────────────────


class TestGenerateFilters:

    @pytest.mark.asyncio
    async def test_generates_filters_from_query(self):
        """Test that generate_filters returns valid AiFilterResponse structure."""
        svc = ScreenerAiService()

        # Mock the httpx client
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "message": {
                "content": """{
                    "reasoning": "User wants large cap value stocks",
                    "filters": [
                        {"code": "marketCapAbove1e6", "value": "10000", "display_label": "Market Cap ≥ $10B", "reasoning": "User specified large caps"},
                        {"code": "maxPeRatio", "value": "15", "display_label": "P/E ≤ 15", "reasoning": "User wants value stocks"}
                    ],
                    "summary": "Large cap value stocks with P/E under 15"
                }"""
            }
        }

        with patch.object(svc._http, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = mock_response

            result = await svc.generate_filters(
                query="large cap value stocks",
                model="gemma4:26b",
                preset_context="Most Active — US Stocks",
            )

            assert isinstance(result, dict)
            assert "filters" in result
            assert "summary" in result
            assert "raw_query" in result
            assert result["raw_query"] == "large cap value stocks"
            assert len(result["filters"]) == 2
            assert result["filters"][0]["code"] == "marketCapAbove1e6"

        await svc.shutdown()

    @pytest.mark.asyncio
    async def test_filters_unknown_codes(self):
        """Test that unknown filter codes are dropped."""
        svc = ScreenerAiService()

        mock_response = MagicMock()
        mock_response.json.return_value = {
            "message": {
                "content": """{
                    "reasoning": "Testing unknown codes",
                    "filters": [
                        {"code": "marketCapAbove1e6", "value": "10000", "display_label": "Market Cap ≥ $10B", "reasoning": "Known code"},
                        {"code": "unknownCode999", "value": "100", "display_label": "Unknown Filter", "reasoning": "Unknown code"}
                    ],
                    "summary": "Testing unknown codes"
                }"""
            }
        }

        with patch.object(svc._http, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = mock_response

            result = await svc.generate_filters(
                query="test unknown codes",
                model="gemma4:26b",
            )

            # Only 1 filter should remain (the known code)
            assert len(result["filters"]) == 1
            assert result["filters"][0]["code"] == "marketCapAbove1e6"

        await svc.shutdown()

    @pytest.mark.asyncio
    async def test_all_valid_codes_pass_through(self):
        """Test that all valid filter codes are kept."""
        svc = ScreenerAiService()

        # Build a filters list with 3 known codes
        filters = [
            {"code": "marketCapAbove1e6", "value": "10000", "display_label": "Market Cap ≥ $10B", "reasoning": "Reason 1"},
            {"code": "minPeRatio", "value": "5", "display_label": "P/E ≥ 5", "reasoning": "Reason 2"},
            {"code": "volumeAbove", "value": "1000000", "display_label": "Volume ≥ 1M", "reasoning": "Reason 3"},
        ]

        mock_response = MagicMock()
        import json
        mock_response.json.return_value = {
            "message": {
                "content": json.dumps({
                    "reasoning": "All valid codes",
                    "filters": filters,
                    "summary": "Test summary"
                })
            }
        }

        with patch.object(svc._http, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = mock_response

            result = await svc.generate_filters(
                query="test valid codes",
                model="gemma4:26b",
            )

            # All 3 filters should remain
            assert len(result["filters"]) == 3
            codes = {f["code"] for f in result["filters"]}
            assert codes == {"marketCapAbove1e6", "minPeRatio", "volumeAbove"}

        await svc.shutdown()

    @pytest.mark.asyncio
    async def test_empty_filters_on_unmappable_query(self):
        """Test that unmappable queries return empty filters."""
        svc = ScreenerAiService()

        mock_response = MagicMock()
        mock_response.json.return_value = {
            "message": {
                "content": """{
                    "reasoning": "Cannot map this query",
                    "filters": [],
                    "summary": "This query does not map to any available filters"
                }"""
            }
        }

        with patch.object(svc._http, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = mock_response

            result = await svc.generate_filters(
                query="something unmappable",
                model="gemma4:26b",
            )

            assert result["filters"] == []
            assert len(result["summary"]) > 0

        await svc.shutdown()

    @pytest.mark.asyncio
    async def test_echoes_back_raw_query(self):
        """Test that the raw query is echoed back in the response."""
        svc = ScreenerAiService()

        mock_response = MagicMock()
        mock_response.json.return_value = {
            "message": {
                "content": """{
                    "reasoning": "Test",
                    "filters": [],
                    "summary": "Test"
                }"""
            }
        }

        with patch.object(svc._http, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = mock_response

            query = "oversold large caps with strong earnings"
            result = await svc.generate_filters(
                query=query,
                model="gemma4:26b",
            )

            assert result["raw_query"] == query

        await svc.shutdown()

    @pytest.mark.asyncio
    async def test_preset_context_included_in_prompt(self):
        """Test that preset_context is passed to the AI prompt."""
        svc = ScreenerAiService()

        mock_response = MagicMock()
        mock_response.json.return_value = {
            "message": {
                "content": '{"reasoning": "Test", "filters": [], "summary": "Test"}'
            }
        }

        with patch.object(svc._http, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = mock_response

            await svc.generate_filters(
                query="test",
                model="gemma4:26b",
                preset_context="Most Active — US Stocks",
            )

            # Verify the prompt included the preset context
            call_args = mock_post.call_args
            payload = call_args.kwargs.get("json")
            messages = payload.get("messages", [])
            user_message = next(m for m in messages if m["role"] == "user")
            assert "Most Active — US Stocks" in user_message["content"]

        await svc.shutdown()

    @pytest.mark.asyncio
    async def test_connect_error_raises_ai_error(self):
        """Test that connection errors are converted to AIError."""
        svc = ScreenerAiService()

        with patch.object(svc._http, "post", new_callable=AsyncMock) as mock_post:
            mock_post.side_effect = Exception("connection error")
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


# ── Tests for models ──────────────────────────────────────────


class TestAiFilterModels:

    def test_ai_filter_request_required_fields(self):
        """Test AiFilterRequest requires query and model."""
        req = AiFilterRequest(query="test", model="gemma4:26b")
        assert req.query == "test"
        assert req.model == "gemma4:26b"
        assert req.preset_context is None

    def test_ai_filter_request_with_context(self):
        """Test AiFilterRequest with preset_context."""
        req = AiFilterRequest(
            query="test",
            model="gemma4:26b",
            preset_context="Most Active — US Stocks",
        )
        assert req.preset_context == "Most Active — US Stocks"

    def test_ai_filter_suggestion(self):
        """Test AiFilterSuggestion model."""
        suggestion = AiFilterSuggestion(
            code="marketCapAbove1e6",
            value="10000",
            display_label="Market Cap ≥ $10B",
            reasoning="User wants large caps",
        )
        assert suggestion.code == "marketCapAbove1e6"
        assert suggestion.value == "10000"
        assert suggestion.display_label == "Market Cap ≥ $10B"

    def test_ai_filter_response(self):
        """Test AiFilterResponse model."""
        filters = [
            AiFilterSuggestion(
                code="marketCapAbove1e6",
                value="10000",
                display_label="Market Cap ≥ $10B",
                reasoning="User wants large caps",
            )
        ]
        response = AiFilterResponse(
            filters=filters,
            summary="Large cap stocks",
            raw_query="large cap",
        )
        assert len(response.filters) == 1
        assert response.summary == "Large cap stocks"
        assert response.raw_query == "large cap"

    def test_ai_filter_response_empty_filters(self):
        """Test AiFilterResponse with empty filters."""
        response = AiFilterResponse(
            filters=[],
            summary="No filters matched",
            raw_query="unmappable query",
        )
        assert response.filters == []


# ── Tests for filter catalogue ────────────────────────────────


class TestFilterCatalogue:

    def test_catalogue_has_minimum_filters(self):
        """Test that the catalogue has a reasonable number of filters."""
        assert len(FILTER_CATALOGUE) >= 30

    def test_all_filters_have_required_fields(self):
        """Test that all filters have code, label, example."""
        for f in FILTER_CATALOGUE:
            assert "code" in f
            assert "label" in f
            assert "example" in f
            assert len(f["code"]) > 0
            assert len(f["label"]) > 0
            assert len(f["example"]) > 0

    def test_filters_have_unique_codes(self):
        """Test that no two filters have the same code."""
        codes = [f["code"] for f in FILTER_CATALOGUE]
        assert len(codes) == len(set(codes))

    def test_sample_fundamental_filters(self):
        """Test that key fundamental filters are in the catalogue."""
        codes = {f["code"] for f in FILTER_CATALOGUE}
        assert "marketCapAbove1e6" in codes
        assert "minPeRatio" in codes
        assert "maxPeRatio" in codes

    def test_sample_technical_filters(self):
        """Test that key technical filters are in the catalogue."""
        codes = {f["code"] for f in FILTER_CATALOGUE}
        assert "volumeAbove" in codes
        assert "lastVsEMAChangeRatio20Above" in codes
        assert "changePercAbove" in codes

    def test_sample_analyst_filters(self):
        """Test that analyst filters are in the catalogue."""
        codes = {f["code"] for f in FILTER_CATALOGUE}
        assert "avgRatingAbove" in codes
        assert "avgAnalystTarget2PriceRatioAbove" in codes


# ── Integration tests ──────────────────────────────────────────


class TestScreenerAiIntegration:

    @pytest.mark.asyncio
    async def test_full_flow_large_cap_value(self):
        """Test full flow for 'large cap value stocks' query."""
        svc = ScreenerAiService()

        mock_response = MagicMock()
        mock_response.json.return_value = {
            "message": {
                "content": """{
                    "reasoning": "User wants large cap stocks with low valuation",
                    "filters": [
                        {"code": "marketCapAbove1e6", "value": "10000", "display_label": "Market Cap ≥ $10B", "reasoning": "Large cap definition"},
                        {"code": "maxPeRatio", "value": "15", "display_label": "P/E ≤ 15", "reasoning": "Value stock criterion"}
                    ],
                    "summary": "Large cap stocks with P/E under 15"
                }"""
            }
        }

        with patch.object(svc._http, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = mock_response

            result = await svc.generate_filters(
                query="large cap value stocks",
                model="gemma4:26b",
            )

            assert isinstance(result, dict)
            assert len(result["filters"]) == 2
            assert result["summary"] == "Large cap stocks with P/E under 15"

        await svc.shutdown()

    @pytest.mark.asyncio
    async def test_full_flow_oversold_momentum(self):
        """Test full flow for 'oversold momentum' query."""
        svc = ScreenerAiService()

        mock_response = MagicMock()
        mock_response.json.return_value = {
            "message": {
                "content": """{
                    "reasoning": "User wants stocks that are oversold but showing momentum",
                    "filters": [
                        {"code": "lastVsEMAChangeRatio20Below", "value": "-5", "display_label": "Price 5% Below EMA(20)", "reasoning": "Oversold condition"},
                        {"code": "changePercAbove", "value": "2", "display_label": "Day Change ≥ 2%", "reasoning": "Momentum indicator"}
                    ],
                    "summary": "Oversold stocks with upward momentum"
                }"""
            }
        }

        with patch.object(svc._http, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = mock_response

            result = await svc.generate_filters(
                query="oversold momentum stocks",
                model="gemma4:26b",
            )

            assert len(result["filters"]) == 2
            codes = {f["code"] for f in result["filters"]}
            assert "lastVsEMAChangeRatio20Below" in codes
            assert "changePercAbove" in codes

        await svc.shutdown()


# ── Canonical-catalogue wiring ─────────────────────────────────


class TestCanonicalCatalogueWiring:
    """
    The AI service must pull its catalogue from `constants.ibkr_filters`,
    not keep a local duplicate. These tests lock that contract in place so
    the next time someone tries to fork the catalogue, a test goes red.
    """

    def test_ai_catalogue_is_canonical_catalogue(self):
        """`services.screener_ai.FILTER_CATALOGUE` must be the canonical list."""
        from constants.ibkr_filters import FILTER_CATALOGUE as CANONICAL
        from services.screener_ai import FILTER_CATALOGUE as AI_CATALOGUE

        # Same object, not just same contents — proves it's a re-export.
        assert AI_CATALOGUE is CANONICAL

    @pytest.mark.asyncio
    async def test_unknown_code_drop_logs_the_code_string(self, caplog):
        """
        When Ollama returns a code outside FILTER_CODES, we must log the
        *actual code string* (not just a count) so prompt drift is diagnosable.
        """
        import logging

        svc = ScreenerAiService()

        mock_response = MagicMock()
        mock_response.json.return_value = {
            "message": {
                "content": """{
                    "reasoning": "Mix of valid and bogus codes",
                    "filters": [
                        {"code": "marketCapAbove1e6", "value": "10000", "display_label": "Market Cap >= $10B", "reasoning": "valid"},
                        {"code": "totallyFakeCodeABC", "value": "1", "display_label": "bogus", "reasoning": "invalid"}
                    ],
                    "summary": "mixed"
                }"""
            }
        }

        with patch.object(svc._http, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = mock_response

            with caplog.at_level(logging.WARNING, logger="parallax.screener_ai"):
                result = await svc.generate_filters(
                    query="test",
                    model="gemma4:26b",
                )

        # The valid code survives validation, the bogus one is dropped.
        assert len(result["filters"]) == 1
        assert result["filters"][0]["code"] == "marketCapAbove1e6"

        # The dropped code string appears in the warning log record.
        warning_messages = [
            rec.getMessage()
            for rec in caplog.records
            if rec.levelno == logging.WARNING
        ]
        assert any("totallyFakeCodeABC" in msg for msg in warning_messages), (
            f"expected dropped code in log, got: {warning_messages}"
        )

        await svc.shutdown()
