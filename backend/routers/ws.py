"""
WebSocket endpoint — real-time data bridge between frontend and IBKR.

The flow:
  1. Frontend connects to our /ws endpoint
  2. We relay market data from the IBKR WebSocket to all connected frontends
  3. Frontend can send subscribe/unsubscribe commands

This is a FastAPI-native WebSocket broadcaster (no Socket.IO needed).
"""

import asyncio
import json
import logging
import math
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from services.ibkr import IBKRService

log = logging.getLogger("parallax.ws")

router = APIRouter()

# Connected frontend clients
_clients: set[WebSocket] = set()


# ── Broadcast function (injected into IBKRService) ───────────


async def broadcast(payload: dict[str, Any]) -> None:
    """
    Send a message to all connected frontend WebSocket clients.
    Cleans NaN values before serializing (IBKR sometimes sends them).
    """
    if not isinstance(payload, dict):
        return

    cleaned = _clean_nan(payload)
    text = json.dumps(cleaned)

    dead: list[WebSocket] = []
    for ws in _clients:
        try:
            await ws.send_text(text)
        except (WebSocketDisconnect, RuntimeError):
            dead.append(ws)

    for ws in dead:
        _clients.discard(ws)


def _clean_nan(obj: Any) -> Any:
    """Recursively replace NaN/Inf float values with None."""
    if isinstance(obj, dict):
        return {k: _clean_nan(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_clean_nan(v) for v in obj]
    if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
        return None
    return obj


# ── WebSocket endpoint ───────────────────────────────────────


@router.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    """
    Frontend WebSocket connection.

    On connect: starts the IBKR WebSocket if not already running.
    Messages from frontend: JSON with {action, conid} for subscribe/unsubscribe.
    Messages to frontend: real-time market data updates.
    """
    app = ws.scope["app"]
    ibkr: IBKRService = app.state.ibkr

    # Wire up the broadcast callback if not already set
    if not hasattr(ibkr, "_broadcast") or ibkr._broadcast is None:
        ibkr.set_broadcast(broadcast)

    # Start IBKR WebSocket if authenticated. The FE→BE gate below waits
    # for it to actually connect before we accept the browser connection.
    # If the user isn't authenticated we refuse the connection outright —
    # frontend reconnect loop will retry once auth completes.
    if not ibkr.state.authenticated:
        log.info("Frontend WS rejected: IBKR session not authenticated")
        return  # do not accept

    await ibkr.start_ibkr_websocket()

    # Gate: wait for the IBKR WS to be fully up (initial subscribes flushed)
    # before accepting the frontend. Ports MoonMarket's wait_for_connection
    # pattern — eliminates the "connected to backend, not to IBKR" UX wart.
    # Frontend has indefinite reconnect, so a rejected connection just makes
    # it try again with backoff. 10 s timeout matches MoonMarket.
    ibkr_ready = await ibkr.wait_for_ws_ready()
    if not ibkr_ready:
        log.warning("Frontend WS rejected: IBKR WebSocket did not become ready in time")
        return  # do not accept

    # Accept the frontend connection
    await ws.accept()
    _clients.add(ws)
    log.info("Frontend client connected (%d total)", len(_clients))

    # Send initial connection status — both flags are True at this point
    # because the gate above guarantees IBKR readiness before we accept.
    await ws.send_text(json.dumps({
        "type": "connection_status",
        "ibkr_connected": True,
        "ws_ready": True,
    }))

    try:
        while True:
            data = await ws.receive_text()
            try:
                command = json.loads(data)
                action = command.get("action")
                conid = command.get("conid")

                if action == "subscribe" and conid:
                    await ibkr.ws_subscribe(int(conid))
                elif action == "unsubscribe" and conid:
                    await ibkr.ws_unsubscribe(int(conid))
                else:
                    log.warning("Unknown WebSocket command: %s", action)

            except json.JSONDecodeError:
                log.warning("Invalid JSON from frontend: %s", data[:100])
            except (ValueError, KeyError, TypeError) as exc:
                log.error("Error processing WebSocket command: %s", exc)

    except (WebSocketDisconnect, RuntimeError):
        pass  # Clean disconnect
    finally:
        _clients.discard(ws)
        log.info("Frontend client disconnected (%d remaining)", len(_clients))
