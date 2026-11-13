"""Local sidecar trust boundary. No HTTP endpoint reveals the launch credential."""

from __future__ import annotations

import hmac
import os
import secrets

from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

SESSION_HEADER = "x-orbit-session"
WS_PROTOCOL = "orbit-session"
PUBLIC_READS = frozenset({"/health", "/.well-known/agent.json", "/openapi.json", "/docs", "/redoc"})


def launch_secret() -> str:
    # Native launch passes this only to the sidecar, never its descendants.
    value = os.environ.pop("ORBIT_SESSION_SECRET", None)
    if value is not None and (len(value) != 64 or any(c not in "0123456789abcdef" for c in value)):
        raise RuntimeError("Invalid sidecar session credential")
    # Standalone diagnostic launches have no authorized mutation client.
    return value if value is not None else secrets.token_hex(32)


def legacy_order_route(path: str) -> bool:
    """All Client Portal order mutations and the old TWS live paths stay closed."""
    return (
        path == "/moonmarket/orders"
        or path.startswith("/moonmarket/orders/")
        or path.startswith("/execution-assistant/live/")
        or (path.startswith("/execution-assistant/") and path.endswith(("-live", "/preview-live")))
    )


class SidecarSecurityMiddleware:
    def __init__(self, app: ASGIApp, secret: str) -> None:
        self.app = app
        self.secret = secret

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        kind = scope["type"]
        if kind not in {"http", "websocket"}:
            await self.app(scope, receive, send)
            return
        headers = Headers(scope=scope)
        origin = headers.get("origin")
        allowed_origins = {
            "tauri://localhost", "http://tauri.localhost", "https://tauri.localhost",
            "http://localhost:1420", "http://127.0.0.1:1420",
        }
        path = scope["path"].rstrip("/") or "/"
        if kind == "websocket":
            # Browser WebSocket cannot set an Authorization header. Carry the
            # secret as an offered subprotocol, not in a logged query string.
            offered = scope.get("subprotocols", [])
            valid = len(offered) == 2 and offered[0] == WS_PROTOCOL and hmac.compare_digest(offered[1].encode(), self.secret.encode())
            if not valid or (origin and origin not in allowed_origins):
                await send({"type": "websocket.close", "code": 4401})
                return
        else:
            method = scope["method"]
            # Preflights carry no credential or application effects.
            public = method in {"GET", "HEAD"} and path in PUBLIC_READS
            credential = headers.get(SESSION_HEADER, "")
            if method != "OPTIONS" and not public:
                if not hmac.compare_digest(credential.encode(), self.secret.encode()) or (origin and origin not in allowed_origins):
                    await JSONResponse({"error": "sidecar_session_required"}, status_code=401)(scope, receive, send)
                    return
            if method not in {"GET", "HEAD", "OPTIONS"} and legacy_order_route(path):
                await JSONResponse(
                    {"error": "legacy_trading_disabled", "message": "Live and Client Portal order actions are disabled. Use the Orbit paper workflow."},
                    status_code=403,
                )(scope, receive, send)
                return
        await self.app(scope, receive, send)
