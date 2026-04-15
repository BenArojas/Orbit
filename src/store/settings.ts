/**
 * Settings Store — App configuration persisted to SQLite
 *
 * Settings are loaded from SQLite on app start and written back on change.
 * The backend settings table (key-value store) is the source of truth.
 * This store is the in-memory mirror for the frontend.
 *
 * Backend API shape:
 *   GET  /settings         → { key: value, ... }   (plain object)
 *   PUT  /settings/{key}   → body { value: "..." }
 *
 * Hub integration: Settings are per-module. When Parallax runs inside the Hub,
 * its settings keys are namespaced (e.g. "parallax.scan_interval").
 * MoonMarket and Inflect have their own settings.
 */

import { create } from "zustand";
import { API_BASE } from "@/config/endpoints";

interface SettingsState {
  /** Scanner polling interval in seconds */
  scanInterval: number;

  /** Default timeframe for new charts */
  defaultTimeframe: string;

  /** Default candle period for history fetch */
  defaultPeriod: string;

  /** Global on/off toggle for native desktop notifications on trigger alerts */
  notificationsEnabled: boolean;

  /** Whether settings have been loaded from backend */
  isLoaded: boolean;

  /** Actions */
  setScanInterval: (v: number) => void;
  setDefaultTimeframe: (v: string) => void;
  setDefaultPeriod: (v: string) => void;
  setNotificationsEnabled: (v: boolean) => void;

  /** Load all settings from backend SQLite */
  loadSettings: () => Promise<void>;

  /** Persist a single setting to backend */
  persistSetting: (key: string, value: string) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  scanInterval: 300,
  defaultTimeframe: "1D",
  defaultPeriod: "3M",
  notificationsEnabled: true,
  isLoaded: false,

  setScanInterval: (v) => {
    set({ scanInterval: v });
    get().persistSetting("scan_interval", String(v));
  },

  setDefaultTimeframe: (v) => {
    set({ defaultTimeframe: v });
    get().persistSetting("default_timeframe", v);
  },

  setDefaultPeriod: (v) => {
    set({ defaultPeriod: v });
    get().persistSetting("default_period", v);
  },

  setNotificationsEnabled: (v) => {
    set({ notificationsEnabled: v });
    get().persistSetting("notifications_enabled", v ? "true" : "false");
  },

  loadSettings: async () => {
    try {
      const response = await fetch(`${API_BASE}/settings`);
      if (response.ok) {
        const settings = (await response.json()) as Record<string, string>;

        set({
          scanInterval: Number(settings["scan_interval"] ?? 300),
          defaultTimeframe: settings["default_timeframe"] ?? "1D",
          defaultPeriod: settings["default_period"] ?? "3M",
          notificationsEnabled: (settings["notifications_enabled"] ?? "true") === "true",
          isLoaded: true,
        });
      }
    } catch {
      // Backend not ready yet — use defaults
      console.warn("Settings: backend not available, using defaults");
      set({ isLoaded: true });
    }
  },

  persistSetting: async (key, value) => {
    try {
      await fetch(`${API_BASE}/settings/${encodeURIComponent(key)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
    } catch {
      console.warn(`Settings: failed to persist ${key}=${value}`);
    }
  },
}));
