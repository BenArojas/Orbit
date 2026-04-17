/**
 * WebSocket hook — real-time market data from the Python sidecar.
 *
 * Connects to ws://localhost:8000/ws and dispatches incoming messages
 * to registered handlers. Components subscribe to specific conids
 * for live price updates.
 *
 * ── Phase 8 / Task 8.9 — singleton + 10 s teardown grace period ──
 * The connection is now a **module-level singleton**. Every call to
 * `useWebSocket()` shares the same WebSocket, subscriptions, and status.
 *
 * When the last consumer unmounts, the socket is NOT closed immediately.
 * Instead it enters a 10 s grace window. If a new consumer mounts within
 * that window (e.g. navigating Dashboard → Analysis → Dashboard), the
 * scheduled close is cancelled and the existing connection is reused.
 * This eliminates reconnect flicker on route changes, which was causing
 * live Alert Log updates to stall for ~1 s after every navigation.
 *
 * Features:
 *   - Auto-reconnect with exponential backoff (1s → 2s → 4s → max 30s)
 *   - Auto-resubscribe after reconnect (re-sends all active conid subscriptions)
 *   - Connection status tracking (components can show "connecting..." states)
 *   - Shared handlers + subscriptions across consumers
 *   - 10-second grace period on last unmount (route-change-safe)
 *
 * Usage (unchanged):
 *   const { status, subscribe, unsubscribe, addHandler } = useWebSocket();
 *
 *   subscribe(265598);                       // live data for AAPL
 *   addHandler((msg) => { ... });            // returns an unsubscribe fn
 *
 * Hub integration:
 *   When the Hub consolidates Parallax + MoonMarket, this singleton stays
 *   as-is — Hub modules just register their own handlers for their types.
 */

import { useEffect, useState, useCallback } from "react";

import { WS_URL } from "@/config/endpoints";

// ── Types ───────────────────────────────────────────────────

export type WsStatus = "disconnected" | "connecting" | "connected";

export interface WsMessage {
  type: string;
  conid?: number;
  [key: string]: unknown;
}

type MessageHandler = (msg: WsMessage) => void;
type StatusListener = (s: WsStatus) => void;

// ── Constants ───────────────────────────────────────────────

const MAX_RECONNECT_DELAY = 30_000;
/**
 * When the final consumer unmounts we wait this long before closing the
 * socket — so quick route changes (Dashboard ↔ Analysis) don't reconnect.
 */
const TEARDOWN_GRACE_MS = 10_000;

// ── Singleton state ─────────────────────────────────────────

const handlers = new Set<MessageHandler>();
const subscriptions = new Set<number>();
const statusListeners = new Set<StatusListener>();

let ws: WebSocket | null = null;
let currentStatus: WsStatus = "disconnected";
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let teardownTimer: ReturnType<typeof setTimeout> | null = null;
let refCount = 0;

function setStatus(s: WsStatus) {
  currentStatus = s;
  for (const l of statusListeners) l(s);
}

function send(data: Record<string, unknown>) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function connect() {
  if (ws?.readyState === WebSocket.OPEN) return;
  if (ws?.readyState === WebSocket.CONNECTING) return;

  setStatus("connecting");
  const sock = new WebSocket(WS_URL);
  ws = sock;

  sock.onopen = () => {
    reconnectAttempt = 0;
    setStatus("connected");
    // Re-subscribe to all active conids after (re)connect
    for (const conid of subscriptions) {
      sock.send(JSON.stringify({ action: "subscribe", conid }));
    }
  };

  sock.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data) as WsMessage;
      for (const handler of handlers) handler(msg);
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn("[useWebSocket] malformed message dropped:", event.data, err);
      }
    }
  };

  sock.onclose = () => {
    // Only reconnect if the close wasn't intentional (ws is still the active socket).
    const wasActive = ws === sock;
    ws = null;
    setStatus("disconnected");
    if (!wasActive) return;

    // Auto-reconnect with exponential backoff
    const attempt = reconnectAttempt++;
    const delay = Math.min(1000 * Math.pow(2, attempt), MAX_RECONNECT_DELAY);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      // Only try to reconnect if someone still cares.
      if (refCount > 0) connect();
    }, delay);
  };

  sock.onerror = () => {
    // onclose will fire after this — reconnect handled there.
  };
}

function closeSocket() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    // Detach handlers first so onclose's reconnect branch doesn't fire.
    ws.onclose = null;
    ws.onerror = null;
    try {
      ws.close();
    } catch {
      /* no-op */
    }
    ws = null;
  }
  setStatus("disconnected");
}

function acquire() {
  refCount += 1;
  // Cancel any pending grace-period teardown — a new consumer just mounted.
  if (teardownTimer) {
    clearTimeout(teardownTimer);
    teardownTimer = null;
  }
  if (!ws && currentStatus !== "connecting") {
    connect();
  }
}

function release() {
  refCount = Math.max(0, refCount - 1);
  if (refCount === 0) {
    // Last consumer gone — schedule a soft teardown in TEARDOWN_GRACE_MS.
    // Quick remounts (route change) will cancel this timer in acquire().
    if (teardownTimer) clearTimeout(teardownTimer);
    teardownTimer = setTimeout(() => {
      teardownTimer = null;
      if (refCount === 0) closeSocket();
    }, TEARDOWN_GRACE_MS);
  }
}

// ── Public hook ─────────────────────────────────────────────

export function useWebSocket() {
  const [status, setLocalStatus] = useState<WsStatus>(currentStatus);

  useEffect(() => {
    acquire();
    statusListeners.add(setLocalStatus);
    // Sync the initial local status with the current singleton state.
    setLocalStatus(currentStatus);

    return () => {
      statusListeners.delete(setLocalStatus);
      release();
    };
  }, []);

  const subscribe = useCallback((conid: number) => {
    subscriptions.add(conid);
    send({ action: "subscribe", conid });
  }, []);

  const unsubscribe = useCallback((conid: number) => {
    subscriptions.delete(conid);
    send({ action: "unsubscribe", conid });
  }, []);

  const addHandler = useCallback((handler: MessageHandler) => {
    handlers.add(handler);
    return () => {
      handlers.delete(handler);
    };
  }, []);

  const sendCmd = useCallback((data: Record<string, unknown>) => send(data), []);

  return {
    status,
    subscribe,
    unsubscribe,
    send: sendCmd,
    addHandler,
  };
}

// ── Test / debug helpers ────────────────────────────────────

/**
 * Force-close the singleton and reset counters. Test-only.
 * Not exported from the main barrel — import directly when needed.
 */
export function __resetWebSocketSingletonForTests() {
  if (teardownTimer) {
    clearTimeout(teardownTimer);
    teardownTimer = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  handlers.clear();
  subscriptions.clear();
  statusListeners.clear();
  refCount = 0;
  if (ws) {
    ws.onclose = null;
    ws.onerror = null;
    try {
      ws.close();
    } catch {
      /* no-op */
    }
    ws = null;
  }
  currentStatus = "disconnected";
  reconnectAttempt = 0;
}
