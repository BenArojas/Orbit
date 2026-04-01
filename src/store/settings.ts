/**
 * Settings Store — App configuration persisted to SQLite
 *
 * Settings are loaded from SQLite on app start and written back on change.
 * The backend settings table (key-value store) is the source of truth.
 * This store is the in-memory mirror for the frontend.
 *
 * Hub integration: Settings are per-module. When Parallax runs inside the Hub,
 * its settings keys are namespaced (e.g. "parallax.scan_interval").
 * MoonMarket and Inflect have their own settings.
 */

import { create } from "zustand";
interface SettingsState {
  /** Scanner polling interval in seconds */
  scanInterval: number;

  /** Default timeframe for new charts */
  defaultTimeframe: string;

  /** Default candle period for history fetch */
  defaultPeriod: string;

  /** Whether settings have been loaded from backend */
  isLoaded: boolean;

  /** Actions */
  setScanInterval: (v: number) => void;
  setDefaultTimeframe: (v: string) => void;
  setDefaultPeriod: (v: string) => void;

  /** Load all settings from backend SQLite */
  loadSettings: () => Promise<void>;

  /** Persist a single setting to backend */
  persistSetting: (key: string, value: string) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  scanInterval: 300,
  defaultTimeframe: "1D",
  defaultPeriod: "3M",
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

  loadSettings: async () => {
    try {
      // Fetch all settings from backend
      // The backend seeds defaults on first run, so these should always exist
      const response = await fetch("http://localhost:8000/settings");
      if (response.ok) {
        const settings: Array<{ key: string; value: string }> =
          await response.json();
        const map = new Map(settings.map((s) => [s.key, s.value]));

        set({
          scanInterval: Number(map.get("scan_interval") ?? 300),
          defaultTimeframe: map.get("default_timeframe") ?? "1D",
          defaultPeriod: map.get("default_period") ?? "3M",
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
      await fetch("http://localhost:8000/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      });
    } catch {
      console.warn(`Settings: failed to persist ${key}=${value}`);
    }
  },
}));
