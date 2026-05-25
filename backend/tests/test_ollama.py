"""Tests for OllamaLifecycle — show_model method."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest


class TestShowModel:
    @pytest.mark.asyncio
    async def test_show_returns_model_info_dict(self):
        from services.ollama import OllamaLifecycle

        lifecycle = OllamaLifecycle()
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "model_info": {"llama.context_length": 8192, "general.architecture": "llama"},
        }

        async_post = AsyncMock(return_value=mock_response)
        with patch("services.ollama.httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__.return_value.post = async_post
            info = await lifecycle.show_model("gemma3:4b")

        assert info is not None
        assert info.get("llama.context_length") == 8192

    @pytest.mark.asyncio
    async def test_show_returns_none_on_offline(self):
        from services.ollama import OllamaLifecycle
        import httpx

        lifecycle = OllamaLifecycle()
        async_post = AsyncMock(side_effect=httpx.ConnectError("offline"))
        with patch("services.ollama.httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__.return_value.post = async_post
            info = await lifecycle.show_model("missing:tag")

        assert info is None

    @pytest.mark.asyncio
    async def test_show_returns_none_on_404(self):
        from services.ollama import OllamaLifecycle

        lifecycle = OllamaLifecycle()
        mock_response = MagicMock()
        mock_response.status_code = 404
        mock_response.json.return_value = {}

        async_post = AsyncMock(return_value=mock_response)
        with patch("services.ollama.httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__.return_value.post = async_post
            info = await lifecycle.show_model("no-such-model")

        assert info is None

    @pytest.mark.asyncio
    async def test_show_returns_none_when_model_info_missing(self):
        from services.ollama import OllamaLifecycle

        lifecycle = OllamaLifecycle()
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {}  # no model_info key

        async_post = AsyncMock(return_value=mock_response)
        with patch("services.ollama.httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__.return_value.post = async_post
            info = await lifecycle.show_model("gemma3:4b")

        assert info is None
