/**
 * Pulse Config Store — Phase 8.9+
 *
 * User-configurable ticker list for the dashboard's Market Pulse bar.
 * Persisted to SQLite via the `/pulse-config` backend router (see
 * `backend/routers/pulse_config.py`). The store is the in-memory mirror
 * for the frontend — the backend is the source of truth.
 *
 * Default fallback list matches backend `DEFAULT_PULSE_ITEMS`. It's used
 * while the initial GET is in flight so the bar doesn't flash empty on
 * app start.
 */

import { create } from "zustand";
import { api, type PulseItem } from "@/lib/api";

export const DEFAULT_PULSE_ITEMS: readonly PulseItem[] = [
  { label: "SPX", resolve: "SPX" },
  { label: "SPY", resolve: "SPY" },
  { label: "QQQ", resolve: "QQQ" },
  { label: "DIA", resolve: "DIA" },
  { label: "IWM", resolve: "IWM" },
  { label: "BTC", resolve: "BTC" },
  { label: "ETH", resolve: "ETH" },
  { label: "GLD", resolve: "GLD" },
  { label: "SLV", resolve: "SLV" },
  { label: "USO", resolve: "USO" },
  { label: "TLT", resolve: "TLT" },
  { label: "DXY", resolve: "DXY" },
  { label: "USD/ILS", resolve: "USD.ILS" },
];

interface PulseConfigState {
  /** Ordered ticker list currently rendered on the bar. */
  items: PulseItem[];

  /** True once we've loaded (or tried to load) from backend. */
  isLoaded: boolean;

  /** Transient save state — used by the Settings UI for button feedback. */
  isSaving: boolean;

  /** Last error message from a save/reset/load, or null. */
  error: string | null;

  // ── Actions ──────────────────────────────────────────────

  /** GET /pulse-config — called once on app start. */
  load: () => Promise<void>;

  /** Optimistically set items locally without persisting. */
  setItemsLocal: (items: PulseItem[]) => void;

  /** PUT /pulse-config — replace + persist. Reverts on failure. */
  save: (items: PulseItem[]) => Promise<void>;

  /** POST /pulse-config/reset — restore backend defaults. */
  reset: () => Promise<void>;
}

export const usePulseConfigStore = create<PulseConfigState>()((set, get) => ({
  items: [...DEFAULT_PULSE_ITEMS],
  isLoaded: false,
  isSaving: false,
  error: null,

  load: async () => {
    try {
      const { items } = await api.getPulseConfig();
      // Guard: if the backend returns an empty list for some reason, fall
      // back to defaults so the bar isn't blank on first boot.
      set({
        items: items.length > 0 ? items : [...DEFAULT_PULSE_ITEMS],
        isLoaded: true,
        error: null,
      });
    } catch (e) {
      console.warn("PulseConfig: load failed, using defaults", e);
      set({ isLoaded: true });
    }
  },

  setItemsLocal: (items) => set({ items }),

  save: async (items) => {
    const previous = get().items;
    // Optimistic update so the bar rerenders immediately.
    set({ items, isSaving: true, error: null });
    try {
      const { items: saved } = await api.setPulseConfig(items);
      set({ items: saved, isSaving: false });
    } catch (e) {
      // Revert — user keeps what they see if the backend refuses.
      set({
        items: previous,
        isSaving: false,
        error: e instanceof Error ? e.message : "Failed to save pulse config",
      });
      throw e;
    }
  },

  reset: async () => {
    set({ isSaving: true, error: null });
    try {
      const { items } = await api.resetPulseConfig();
      set({ items, isSaving: false });
    } catch (e) {
      set({
        isSaving: false,
        error: e instanceof Error ? e.message : "Failed to reset pulse config",
      });
      throw e;
    }
  },
}));
