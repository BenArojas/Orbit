"""Compatibility stream for existing product callers, backed by TWS events."""

import json
from datetime import datetime

from fastapi import WebSocket, WebSocketDisconnect

from models.tws_execution_assistant import TwsStreamSubscribeRequest


class ProductSocket:
    def __init__(self, ws: WebSocket, adapter) -> None:
        self.ws = ws
        self.adapter = adapter
        self.pending: set[int] = set()

    @property
    def client_state(self):
        return self.ws.client_state

    @property
    def application_state(self):
        return self.ws.application_state

    async def send_json(self, event: dict) -> None:
        if event["type"] == "tws_stream_status":
            connected = event["connected"]
            await self.ws.send_json({
                "type": "connection_status", "ibkr_connected": connected, "ws_ready": connected,
            })
            await self.ws.send_json({
                "type": "auth_state", "authenticated": connected, "session_dropped": not connected,
            })
            if connected:
                for conid in list(self.pending):
                    await self.adapter.stream_subscribe(self, TwsStreamSubscribeRequest(
                        action="subscribe", channel="quote", conid=conid,
                    ))
        elif event["type"] == "tws_quote":
            received = event.get("received_at")
            timestamp = datetime.fromisoformat(received).timestamp() if received else None
            availability = {
                "live": "RB", "frozen": "Z", "delayed": "D", "delayed_frozen": "Y",
            }.get(event.get("entitlement"), "")
            await self.ws.send_json({
                **event, "type": "market_data", "availability": availability,
                "market_data_type": event.get("entitlement", "unknown"),
                "timestamp": timestamp,
            })


async def product_ws(ws: WebSocket, adapter, clients: set) -> None:
    await ws.accept()
    bridge = ProductSocket(ws, adapter)
    clients.add(ws)
    adapter.stream_register_socket(bridge)
    await bridge.send_json({"type": "tws_stream_status", "connected": adapter.is_connected()})
    try:
        while True:
            try:
                message = json.loads(await ws.receive_text())
                if not isinstance(message, dict):
                    raise ValueError("Expected a subscription object")
                action, conid = message.get("action"), int(message.get("conid", 0))
                if action not in ("subscribe", "unsubscribe") or conid <= 0:
                    raise ValueError("Invalid quote subscription")
                if action == "subscribe":
                    bridge.pending.add(conid)
                    if adapter.is_connected():
                        await adapter.stream_subscribe(bridge, TwsStreamSubscribeRequest(
                            action=action, channel="quote", conid=conid,
                        ))
                else:
                    bridge.pending.discard(conid)
                    await adapter.stream_unsubscribe(bridge, TwsStreamSubscribeRequest(
                        action=action, channel="quote", conid=conid,
                    ))
                await ws.send_json({"type": "subscription_status", "action": action, "conid": conid})
            except (ValueError, TypeError, json.JSONDecodeError):
                await ws.send_json({"type": "error", "message": "Invalid quote subscription"})
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        clients.discard(ws)
        adapter.stream_cleanup(bridge)
