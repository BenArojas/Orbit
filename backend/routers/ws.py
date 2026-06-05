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

    # Start the IBKR WS task if possible (no-op if it's already running or
    # the session token isn't set yet — start_ibkr_websocket guards both).
    if ibkr.state.authenticated:
        await ibkr.start_ibkr_websocket()

    # Accept the frontend connection immediately. We used to gate on
    # wait_for_ws_ready() but that produced a 30s+ rejection loop on cold
    # boot when the tickle hadn't yet populated the session token: the FE
    # would reconnect 3-4 times with 10s ASGI timeouts in between. Better
    # to accept and let the frontend handle the "connected to backend,
    # not yet to IBKR" intermediate state — the connection_status message
    # below + the pending-subscribe queue make this clean.
    await ws.accept()
    _clients.add(ws)
    log.info("Frontend client connected (%d total)", len(_clients))

    # Initial status snapshot. ws_ready may flip from false → true later
    # when the IBKR loop comes online; a follow-up connection_status push
    # could announce that, but for now the frontend just polls.
    await ws.send_text(json.dumps({
        "type": "connection_status",
        "ibkr_connected": ibkr.state.authenticated,
        "ws_ready": ibkr.state.ws_connected,
    }))

    # Background task: once IBKR becomes ready (if not already), push a
    # second connection_status so the FE can flip its UI without polling.
    if not ibkr.state.ws_connected:
        async def _notify_ready() -> None:
            try:
                ready = await ibkr.wait_for_ws_ready(timeout=60.0)
                if ready:
                    try:
                        await ws.send_text(json.dumps({
                            "type": "connection_status",
                            "ibkr_connected": True,
                            "ws_ready": True,
                        }))
                    except (WebSocketDisconnect, RuntimeError):
                        pass  # client disconnected before IBKR came up
            except Exception as exc:
                log.debug("ws_ready notifier exited: %s", exc)
        asyncio.create_task(_notify_ready())

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
