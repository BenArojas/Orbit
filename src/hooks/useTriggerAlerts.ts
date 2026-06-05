/**
 * useTriggerAlerts — desktop notifications for trigger hits (Phase 6.5)
 *
 * Listens on the shared WebSocket for `trigger_alert` messages emitted by
 * the backend scanner whenever a rule fires. When the global
 * `notificationsEnabled` setting is on, it dispatches a native OS
 * notification via Tauri's notification plugin.
 *
 * Click behaviour: do-nothing (per product decision). The alert is also
 * recorded in SQLite so the user can see it in the trigger watchlist / log.
 *
 * Mount once at the app root (App.tsx) so a single subscription handles
 * every WS client.
 */

import { useEffect, useRef } from "react";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

import { useSettingsStore } from "@/store/settings";
import type { WsMessage } from "./useWebSocket";

interface TriggerAlertMessage extends WsMessage {
  type: "trigger_alert";
  hit_id: number;
  rule_id: number;
  rule_name?: string;
  symbol: string;
  conid: number;
  indicator: string;
  condition: string;
  threshold: number;
  actual_value: number;
  source_watchlist?: string;
  target_watchlist?: string;
}

type AddHandler = (handler: (msg: WsMessage) => void) => () => void;

/** Format an alert payload into a human-readable notification body. */
function formatBody(msg: TriggerAlertMessage): string {
  const cond = msg.condition.replace(/_/g, " ");
  const val = Number.isFinite(msg.actual_value)
    ? msg.actual_value.toFixed(2)
    : String(msg.actual_value);
  const where = msg.target_watchlist ? ` → ${msg.target_watchlist}` : "";
  return `${msg.symbol} ${msg.indicator} ${cond} ${msg.threshold} (${val})${where}`;
}

/** Ask the OS for notification permission once, lazily. */
let permissionChecked = false;
async function ensurePermission(): Promise<boolean> {
  try {
    if (permissionChecked) {
      return await isPermissionGranted();
    }
    permissionChecked = true;
    let granted = await isPermissionGranted();
    if (!granted) {
      const result = await requestPermission();
      granted = result === "granted";
    }
    return granted;
  } catch (err) {
    console.warn("Notification permission check failed:", err);
    return false;
  }
}

export function useTriggerAlerts(addHandler: AddHandler) {
  // Keep the latest enabled flag in a ref so the handler closure never
  // captures a stale value when the user toggles the setting.
  const enabledRef = useRef(
    useSettingsStore.getState().notificationsEnabled,
  );

  useEffect(() => {
    const unsub = useSettingsStore.subscribe((state) => {
      enabledRef.current = state.notificationsEnabled;
    });
    return unsub;
  }, []);

  useEffect(() => {
    const off = addHandler((msg) => {
      if (msg.type !== "trigger_alert") return;
      if (!enabledRef.current) return;

      const alert = msg as TriggerAlertMessage;
      void (async () => {
        const granted = await ensurePermission();
        if (!granted) return;
        try {
          sendNotification({
            title: alert.rule_name
              ? `Trigger: ${alert.rule_name}`
              : `Trigger: ${alert.symbol}`,
            body: formatBody(alert),
          });
        } catch (err) {
          console.warn("sendNotification failed:", err);
        }
      })();
    });

    return off;
  }, [addHandler]);
}
