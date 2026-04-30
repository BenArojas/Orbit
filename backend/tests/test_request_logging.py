"""
Tests for RequestLoggingMiddleware — Phase 8 dashboard fan-out instrumentation.

Covers:
  - HTTP requests append a parseable JSONL line with the expected fields
  - The status code on the line matches the response status
  - duration_ms is present and non-negative
  - WebSocket connect / disconnect each emit one line, in that order
  - Failed handshakes (no accept) do NOT log a connect/disconnect pair
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest.mock import MagicMock

# Same dance as test_health.py — stub heavy deps that aren't always installed
# in the sandbox before importing the backend modules.
sys.modules.setdefault("pandas_ta", MagicMock())
sys.modules.setdefault("pandas", MagicMock())

import pytest
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.testclient import TestClient

from request_logging import RequestLoggingMiddleware, _resolve_log_path


# ── Helpers ────────────────────────────────────────────────────────────────


def _read_log_lines() -> list[dict]:
    """Read the JSONL log file from disk and parse each line."""
    path = _resolve_log_path()
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def _truncate_log() -> None:
    """Reset the log file between tests so assertions are scoped to the call."""
    path = _resolve_log_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("", encoding="utf-8")


def _build_app() -> FastAPI:
    """Tiny FastAPI app with the middleware mounted and a couple of routes."""
    app = FastAPI()
    app.add_middleware(RequestLoggingMiddleware)

    @app.get("/ping")
    async def ping() -> dict:
        return {"ok": True}

    @app.get("/boom")
    async def boom() -> dict:
        # HTTPException is caught by Starlette's ExceptionMiddleware and
        # converted to a real response — our middleware (mounted outside)
        # observes the resulting status code, which is the realistic path
        # for typed app errors via the @app.exception_handler registrations.
        raise HTTPException(status_code=500, detail="boom")

    @app.websocket("/ws-ok")
    async def ws_ok(ws: WebSocket) -> None:
        await ws.accept()
        try:
            while True:
                await ws.receive_text()
        except WebSocketDisconnect:
            return

    @app.websocket("/ws-reject")
    async def ws_reject(ws: WebSocket) -> None:
        # Close without accepting — handshake fails.
        await ws.close(code=4000)

    return app


# ── Fixtures ───────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _isolate_log_file():
    """Each test starts with a clean log file."""
    _truncate_log()
    yield
    # Leave the file in place for inspection after the suite runs — it's
    # gitignored anyway. Truncation on entry is enough.


# ── HTTP ──────────────────────────────────────────────────────────────────


def test_http_request_appends_one_jsonl_line():
    app = _build_app()
    client = TestClient(app)

    res = client.get("/ping?x=1")

    assert res.status_code == 200
    lines = _read_log_lines()
    assert len(lines) == 1, f"expected exactly one line, got {lines}"
    line = lines[0]
    assert line["kind"] == "http"
    assert line["method"] == "GET"
    assert line["path"] == "/ping"
    assert line["query"] == "x=1"
    assert line["status"] == 200
    assert isinstance(line["duration_ms"], (int, float))
    assert line["duration_ms"] >= 0
    assert "ts" in line and isinstance(line["ts"], str)
    assert "client" in line


def test_http_500_is_logged_with_status_500():
    """Even when the route raises, the middleware should log status 500."""
    app = _build_app()
    client = TestClient(app, raise_server_exceptions=False)

    client.get("/boom")
    lines = _read_log_lines()
    assert len(lines) == 1
    assert lines[0]["path"] == "/boom"
    assert lines[0]["status"] == 500


def test_http_multiple_requests_each_get_their_own_line():
    app = _build_app()
    client = TestClient(app)

    client.get("/ping")
    client.get("/ping?x=2")
    client.get("/ping?x=3")

    lines = _read_log_lines()
    assert len(lines) == 3
    assert all(line["kind"] == "http" for line in lines)
    assert [line["query"] for line in lines] == ["", "x=2", "x=3"]


# ── WebSocket ─────────────────────────────────────────────────────────────


def test_ws_connect_and_disconnect_each_log_a_line():
    app = _build_app()
    client = TestClient(app)

    with client.websocket_connect("/ws-ok") as ws:
        # Open and immediately close — server side returns on disconnect.
        ws.close()

    lines = _read_log_lines()
    kinds = [line["kind"] for line in lines]
    assert kinds == ["ws_connect", "ws_disconnect"], kinds
    assert lines[0]["path"] == "/ws-ok"
    assert lines[1]["path"] == "/ws-ok"
    assert lines[1]["duration_ms"] >= 0


def test_ws_rejected_handshake_logs_neither_connect_nor_disconnect():
    """If the server never accepts, we shouldn't fabricate a connect line."""
    app = _build_app()
    client = TestClient(app)

    with pytest.raises(Exception):
        # Starlette raises WebSocketDisconnect when the server closes
        # before accept; either way the context manager exits.
        with client.websocket_connect("/ws-reject"):
            pass

    lines = _read_log_lines()
    # No accept ⇒ no connect/disconnect rows from the middleware.
    ws_lines = [line for line in lines if line["kind"].startswith("ws_")]
    assert ws_lines == []
