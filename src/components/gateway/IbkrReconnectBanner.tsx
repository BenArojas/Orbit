/**
 * IbkrReconnectBanner — mid-session disconnect prompt (Phase 7.1)
 *
 * Displayed when a previously-authenticated IBKR session has dropped.
 * Detected via two signals (first one wins):
 *   1. WebSocket `session_dropped` event from the backend tickle loop
 *   2. `session_dropped: true` in the /gateway/status poll response
 *
 * The banner sits between the nav bar and the page content so the user
 * can't miss it. It auto-dismisses when re-authentication is detected
 * (poll returns `authenticated: true`). The user can also dismiss it
 * manually — non-IBKR features remain usable while disconnected.
 *
 * Design: amber warning strip matching the gateway amber colour theme.
 */

import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useGatewayContext } from "@/context/GatewayContext";
import { IBKR_GATEWAY_BASE_URL } from "@/config/endpoints";
import type { WsMessage } from "@/hooks/useWebSocket";

interface IbkrReconnectBannerProps {
  /** addHandler from useWebSocket — used to detect the session_dropped WS event */
  addHandler: (handler: (msg: WsMessage) => void) => () => void;
}

export function IbkrReconnectBanner({ addHandler }: IbkrReconnectBannerProps) {
  const { status, isAuthenticated, refetch } = useGatewayContext();
  const [visible, setVisible] = useState(false);
  const dismissedRef = useRef(false);

  // ── Detect session drop from WS event (immediate) ─────────────────────────
  // The WS event tells us the drop happened, but the full status payload
  // (authenticated, session_dropped, auth_required) only refreshes on the
  // /gateway/status poll — which may be on the 30 s SLOW interval. Force an
  // immediate refetch so every downstream consumer of useGatewayContext
  // (GatewaySetup, useIbkrReady gates, etc.) sees the new truth right away.
  useEffect(() => {
    const off = addHandler((msg: WsMessage) => {
      if (msg.type === "session_dropped") {
        dismissedRef.current = false;
        setVisible(true);
        void refetch();
      }
    });
    return off;
  }, [addHandler, refetch]);

  // ── Detect session drop from gateway status poll (backup) ─────────────────
  useEffect(() => {
    if (status?.session_dropped && !dismissedRef.current) {
      setVisible(true);
    }
  }, [status?.session_dropped]);

  // ── Auto-dismiss when the user re-authenticates ───────────────────────────
  useEffect(() => {
    if (isAuthenticated && visible) {
      setVisible(false);
      dismissedRef.current = false;
    }
  }, [isAuthenticated, visible]);

  if (!visible) return null;

  const gatewayUrl = status?.gateway_url ?? IBKR_GATEWAY_BASE_URL;

  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 border-b px-5 py-2 text-[11px]"
      style={{
        borderColor: "var(--clr-orange)",
        background: "rgba(255,165,0,0.07)",
        color: "var(--clr-orange)",
      }}
    >
      {/* Icon + message */}
      <div className="flex items-center gap-2">
        {/* Amber warning dot */}
        <span
          className="inline-block h-2 w-2 shrink-0 rounded-full"
          style={{
            background: "var(--clr-orange)",
            boxShadow: "0 0 6px var(--clr-orange)",
          }}
        />
        <span className="font-medium">IBKR session expired.</span>
        <span className="text-[var(--text-2)]">
          Re-open the login page to reconnect.
        </span>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-3">
        <button
          type="button"
          onClick={() => {
            openUrl(gatewayUrl).catch((err) => {
              console.error("Failed to open IBKR login URL:", err);
            });
          }}
          className="rounded border px-3 py-1 font-medium transition-colors hover:opacity-80"
          style={{
            borderColor: "var(--clr-orange)",
            color: "var(--clr-orange)",
          }}
        >
          Open IBKR Login
        </button>
        <button
          className="text-[var(--text-3)] transition-colors hover:text-[var(--text-2)]"
          onClick={() => {
            dismissedRef.current = true;
            setVisible(false);
          }}
          aria-label="Dismiss reconnect banner"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
