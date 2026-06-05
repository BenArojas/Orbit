"""
Request-logging middleware — writes every HTTP + WS event to a JSONL file.

Why this exists:
    Phase 8 dashboard tuning — we want to see the full post-login fan-out
    so we can decide which queries to coalesce, defer, or drop.

Output format (one JSON object per line, append-only):
    {"ts": "2026-04-29T13:01:22.341Z", "kind": "http", "method": "GET",
     "path": "/gateway/status", "query": "", "status": 200,
     "duration_ms": 12.4, "client": "127.0.0.1"}

WS connect / disconnect appear as:
    {"ts": ..., "kind": "ws_connect", "path": "/ws", "client": "127.0.0.1"}
    {"ts": ..., "kind": "ws_disconnect", "path": "/ws", "duration_ms": 42173.1,
     "client": "127.0.0.1"}

Design notes:
    - Pure ASGI middleware so it can observe both HTTP and WebSocket scopes.
    - Writes via a dedicated logger ("parallax.requests") that does NOT
      propagate to the root logger — request lines stay out of the
      console / stderr stream.
    - Best-effort writes: if logging itself fails (disk full, permission
      issue) the request is still served. Error is dropped silently to
      avoid taking down the API for an observability concern.
"""

from __future__ import annotations

import json
import logging
import re
import time
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any, Awaitable, Callable
from urllib.parse import parse_qsl, urlencode

# Type aliases — keep the ASGI signature explicit and grep-able.
Scope = dict[str, Any]
Message = dict[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]
ASGIApp = Callable[[Scope, Receive, Send], Awaitable[None]]


# ── Logger setup ───────────────────────────────────────────────────────────

_LOGGER_NAME = "parallax.requests"
_LOG_FILENAME = "requests.log"
# 10 MB rotation cap × 5 backups — plenty for a 2-minute capture session
# without growing unbounded across days of dev sessions.
_MAX_BYTES = 10 * 1024 * 1024
_BACKUP_COUNT = 5


def _resolve_log_path() -> Path:
    """Return ``backend/logs/requests.log`` regardless of cwd at runtime."""
    return Path(__file__).resolve().parent / "logs" / _LOG_FILENAME


def _build_logger() -> logging.Logger:
    """Singleton logger wired to the rotating file handler.

    Idempotent: importing the module twice (test runs, hot reload) does NOT
    duplicate handlers. We attach exactly one handler whose ``baseFilename``
    matches our resolved log path.
    """
    logger = logging.getLogger(_LOGGER_NAME)
    logger.setLevel(logging.INFO)
    # Don't bubble up to root — request lines should not appear in
    # the regular uvicorn / parallax console stream.
    logger.propagate = False

    target = _resolve_log_path()
    target.parent.mkdir(parents=True, exist_ok=True)

    # Skip if a handler for this file is already attached.
    for h in logger.handlers:
        if isinstance(h, RotatingFileHandler) and Path(h.baseFilename) == target:
            return logger

    handler = RotatingFileHandler(
        target,
        maxBytes=_MAX_BYTES,
        backupCount=_BACKUP_COUNT,
        encoding="utf-8",
    )
    # We emit a fully-formed JSON line — no extra formatter prefix.
    handler.setFormatter(logging.Formatter("%(message)s"))
    logger.addHandler(handler)
    return logger


_log = _build_logger()
_REDACTED = "[REDACTED]"
_INFLECT_TRADE_PATH_RE = re.compile(r"(/inflect/trades/)([^/?]+)")


def _now_iso() -> str:
    """UTC timestamp with millisecond precision and trailing ``Z``."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + (
        f"{datetime.now(timezone.utc).microsecond // 1000:03d}Z"
    )


def _client_ip(scope: Scope) -> str:
    client = scope.get("client") or ()
    return client[0] if client else "-"


def _emit(record: dict[str, Any]) -> None:
    """Best-effort write — never raise back into the request path."""
    try:
        _log.info(json.dumps(record, separators=(",", ":")))
    except (OSError, ValueError, TypeError):
        # Disk full, encoding error, etc. We can't take down requests for this.
        pass


def _redact_path(path: str) -> str:
    return _INFLECT_TRADE_PATH_RE.sub(rf"\1{_REDACTED}", path)


def _redact_query(query: str) -> str:
    if not query:
        return ""
    pairs = [
        (key, _REDACTED if key == "account_id" else value)
        for key, value in parse_qsl(query, keep_blank_values=True)
    ]
    return urlencode(pairs, doseq=True, safe="[]")


# ── ASGI middleware ────────────────────────────────────────────────────────


class RequestLoggingMiddleware:
    """ASGI middleware that records HTTP requests and WS connect/disconnect.

    Mounted as app middleware in ``main.py``. Order does not strictly matter
    — we record what hits the ASGI entrypoint, including responses produced
    by exception handlers further inside the stack.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        kind = scope.get("type")
        if kind == "http":
            await self._handle_http(scope, receive, send)
        elif kind == "websocket":
            await self._handle_ws(scope, receive, send)
        else:
            # lifespan and any future scopes pass through unobserved.
            await self.app(scope, receive, send)

    # ── HTTP ──────────────────────────────────────────────────────────────

    async def _handle_http(self, scope: Scope, receive: Receive, send: Send) -> None:
        start = time.perf_counter()
        status_code: int = 0

        async def send_wrapper(message: Message) -> None:
            nonlocal status_code
            if message.get("type") == "http.response.start":
                status_code = int(message.get("status", 0))
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            duration_ms = (time.perf_counter() - start) * 1000.0
            _emit({
                "ts": _now_iso(),
                "kind": "http",
                "method": scope.get("method", ""),
                "path": _redact_path(scope.get("path", "")),
                "query": _redact_query(
                    (scope.get("query_string") or b"").decode("latin-1")
                ),
                "status": status_code,
                "duration_ms": round(duration_ms, 2),
                "client": _client_ip(scope),
            })

    # ── WebSocket ─────────────────────────────────────────────────────────

    async def _handle_ws(self, scope: Scope, receive: Receive, send: Send) -> None:
        path = scope.get("path", "")
        client = _client_ip(scope)
        start = time.perf_counter()
        accepted = False

        async def send_wrapper(message: Message) -> None:
            nonlocal accepted
            mtype = message.get("type")
            if mtype == "websocket.accept" and not accepted:
                accepted = True
                _emit({
                    "ts": _now_iso(),
                    "kind": "ws_connect",
                    "path": path,
                    "client": client,
                })
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            # Only log disconnect if we ever recorded a connect — otherwise
            # this was a rejected handshake (already noisy enough on its own).
            if accepted:
                duration_ms = (time.perf_counter() - start) * 1000.0
                _emit({
                    "ts": _now_iso(),
                    "kind": "ws_disconnect",
                    "path": path,
                    "duration_ms": round(duration_ms, 2),
                    "client": client,
                })
