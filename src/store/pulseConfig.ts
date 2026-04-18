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
import { queryClient } from "@/lib/query";

/**
 * Query keys whose cached results become stale whenever the pulse
 * ticker list changes. They use `staleTime: Infinity` in MarketPulse,
 * so a ticker swap (e.g. SLV → XAGUSD) would otherwise keep showing
 * the previous session's conid / quote / sparkline until a hard
 * restart. We flush them after every save()/reset().
 */
const PULSE_DEPENDENT_QUERY_KEYS: readonly (readonly string[])[] = [
  ["conid"],   // resolver → conid (staleTime: Infinity)
  ["quote"],   // live price
  ["candles"], // sparkline
];

function invalidatePulseQueries(): void {
  for (const key of PULSE_DEPENDENT_QUERY_KEYS) {
    queryClient.removeQueries({ queryKey: key as unknown as readonly unknown[] });
  }
}

// Mirrors backend services/db.py DEFAULT_PULSE_ITEMS.
// Gold/Silver use XAUUSD/XAGUSD (metal spot) rather than GLD/SLV ETFs —
// the user preferred the spot contract. DXY is intentionally omitted:
// IBKR Client Portal Web API doesn't expose the ICE Dollar Index.
export const DEFAULT_PULSE_ITEMS: readonly PulseItem[] = [
  { label: "SPX", resolve: "SPX", sec_type: "" },
  { label: "SPY", resolve: "SPY", sec_type: "" },
  { label: "QQQ", resolve: "QQQ", sec_type: "" },
  { label: "DIA", resolve: "DIA", sec_type: "" },
  { label: "IWM", resolve: "IWM", sec_type: "" },
  { label: "BTC", resolve: "BTC", sec_type: "" },
  { label: "ETH", resolve: "ETH", sec_type: "" },
  { label: "Gold", resolve: "XAUUSD", sec_type: "" },
  { label: "Silver", resolve: "XAGUSD", sec_type: "" },
  { label: "USO", resolve: "USO", sec_type: "" },
  { label: "TLT", resolve: "TLT", sec_type: "" },
  { label: "USD/ILS", resolve: "USD.ILS", sec_type: "" },
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
      // Drop cached conid/quote/candle entries — the new list may have
      // different `resolve` strings whose previous resolution is now stale.
      invalidatePulseQueries();
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
      // Same rationale as save() — flush cached resolver/quote entries
      // so the restored defaults actually rehydrate from the server.
      invalidatePulseQueries();
    } catch (e) {
      set({
        isSaving: false,
        error: e instanceof Error ? e.message : "Failed to reset pulse config",
      });
      throw e;
    }
  },
}));
