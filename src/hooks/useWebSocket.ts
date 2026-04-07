/**
 * WebSocket hook — real-time market data from the Python sidecar.
 *
 * Connects to ws://localhost:8000/ws and dispatches incoming messages
 * to registered handlers. Components subscribe to specific conids
 * for live price updates.
 *
 * Features:
 *   - Auto-reconnect with exponential backoff (1s → 2s → 4s → max 30s)
 *   - Auto-resubscribe after reconnect (re-sends all active conid subscriptions)
 *   - Connection status tracking (components can show "connecting..." states)
 *   - Clean teardown on unmount
 *
 * Usage:
 *   const { status, subscribe, unsubscribe, addHandler } = useWebSocket();
 *
 *   // Subscribe to live data for AAPL (conid 265598)
 *   subscribe(265598);
 *
 *   // Handle incoming market data
 *   addHandler((msg) => {
 *     if (msg.type === "market_data" && msg.conid === 265598) {
 *       console.log("AAPL last:", msg.last);
 *     }
 *   });
 *
 * Hub integration:
 *   When the Hub consolidates Parallax + MoonMarket, this hook will be
 *   lifted to the Hub level so both modules share one WS connection.
 *   The message protocol stays the same — modules just register different
 *   handlers for their own message types.
 */

import { useEffect, useRef, useCallback, useState } from "react";

import { WS_URL } from "@/config/endpoints";

// ── Types ───────────────────────────────────────────────────

export type WsStatus = "disconnected" | "connecting" | "connected";

export interface WsMessage {
  type: string;
  conid?: number;
  [key: string]: unknown;
}

type MessageHandler = (msg: WsMessage) => void;
const MAX_RECONNECT_DELAY = 30_000;

// ── Hook ────────────────────────────────────────────────────

export function useWebSocket() {
  const [status, setStatus] = useState<WsStatus>("disconnected");
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Set<MessageHandler>>(new Set());
  const subscriptionsRef = useRef<Set<number>>(new Set());
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  // ── Send a JSON command to the backend ──

  const send = useCallback((data: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }, []);

  // ── Subscribe to live data for a conid ──

  const subscribe = useCallback((conid: number) => {
    subscriptionsRef.current.add(conid);
    send({ action: "subscribe", conid });
  }, [send]);

  // ── Unsubscribe from live data for a conid ──

  const unsubscribe = useCallback((conid: number) => {
    subscriptionsRef.current.delete(conid);
    send({ action: "unsubscribe", conid });
  }, [send]);

  // ── Register a message handler ──

  const addHandler = useCallback((handler: MessageHandler) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  // ── Connect (with auto-reconnect) ──

  const connect = useCallback(() => {
    // Don't connect if already connected or component unmounted
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    if (wsRef.current?.readyState === WebSocket.CONNECTING) return;
    if (!mountedRef.current) return;

    setStatus("connecting");
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      reconnectAttemptRef.current = 0;
      setStatus("connected");

      // Re-subscribe to all active conids after reconnect
      for (const conid of subscriptionsRef.current) {
        ws.send(JSON.stringify({ action: "subscribe", conid }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as WsMessage;
        for (const handler of handlersRef.current) {
          handler(msg);
        }
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setStatus("disconnected");
      wsRef.current = null;

      // Auto-reconnect with exponential backoff
      const attempt = reconnectAttemptRef.current++;
      const delay = Math.min(1000 * Math.pow(2, attempt), MAX_RECONNECT_DELAY);
      reconnectTimerRef.current = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      // onclose will fire after this — reconnect handled there
    };
  }, []);

  // ── Lifecycle ──

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null; // Prevent reconnect on intentional close
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  return { status, subscribe, unsubscribe, send, addHandler };
}
