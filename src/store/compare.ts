/**
 * Compare Store — Analysis-page Compare Mode state.
 *
 * Owns the active flag, shared reference symbol, and the stack of
 * configurable panes. Persisted to localStorage so the user's reference
 * + last pane configuration survives a reload.
 *
 * Reference conid is intentionally NOT persisted (cleared on rehydrate)
 * because IBKR can re-issue conids — we always re-resolve on entry.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import type { Timeframe } from "@/store/chart";

export type Layout = "overlay" | "stockOnly" | "refOnly";

export interface ComparePane {
  id: string;
  layout: Layout;
  timeframe: Timeframe;
}

export interface CompareReference {
  symbol: string;
  conid: number | null;
}

export interface CompareMarker {
  id: string;
  time: number; // unix seconds, same as candle.time
}

interface CompareState {
  active: boolean;
  reference: CompareReference;
  panes: ComparePane[];
  markerMode: boolean;
  markers: CompareMarker[];

  enter: (initialTimeframe: Timeframe) => void;
  exit: () => void;
  setReference: (symbol: string, conid: number) => void;
  /** Internal — used when symbol changes before resolution completes. */
  setReferenceSymbol: (symbol: string) => void;
  addPane: () => void;
  removePane: (id: string) => void;
  setPaneLayout: (id: string, layout: Layout) => void;
  setPaneTimeframe: (id: string, tf: Timeframe) => void;
  toggleMarkerMode: () => void;
  addMarker: (time: number) => void;
  removeMarker: (id: string) => void;
  clearMarkers: () => void;

  /** Test-only reset. Not part of the runtime API. */
  __resetForTests: () => void;
}

export const MAX_PANES = 3;
export const DEFAULT_REFERENCE: CompareReference = { symbol: "SPY", conid: null };

function newPaneId(): string {
  // crypto.randomUUID is available in modern browsers and Tauri's webview.
  return crypto.randomUUID();
}

const initialState = {
  active: false,
  reference: { ...DEFAULT_REFERENCE },
  panes: [] as ComparePane[],
  markerMode: false,
  markers: [] as CompareMarker[],
};

export const useCompareStore = create<CompareState>()(
  persist(
    (set) => ({
      ...initialState,

      enter: (initialTimeframe) =>
        set((state) => {
          if (state.panes.length > 0) {
            // Sticky re-entry — keep the last configuration.
            return { active: true };
          }
          return {
            active: true,
            panes: [
              {
                id: newPaneId(),
                layout: "overlay" as Layout,
                timeframe: initialTimeframe,
              },
            ],
          };
        }),

      exit: () => set({ active: false, markerMode: false }),

      setReference: (symbol, conid) =>
        set({ reference: { symbol, conid } }),

      setReferenceSymbol: (symbol) =>
        set((state) => ({
          reference: {
            symbol,
            conid: state.reference.symbol === symbol ? state.reference.conid : null,
          },
        })),

      addPane: () =>
        set((state) => {
          if (state.panes.length >= MAX_PANES) return {};
          const last = state.panes[state.panes.length - 1];
          const timeframe = last?.timeframe ?? "1D";
          return {
            panes: [
              ...state.panes,
              { id: newPaneId(), layout: "overlay" as Layout, timeframe },
            ],
          };
        }),

      removePane: (id) =>
        set((state) => {
          if (state.panes.length <= 1) return {};
          return { panes: state.panes.filter((p) => p.id !== id) };
        }),

      setPaneLayout: (id, layout) =>
        set((state) => ({
          panes: state.panes.map((p) => (p.id === id ? { ...p, layout } : p)),
        })),

      setPaneTimeframe: (id, tf) =>
        set((state) => ({
          panes: state.panes.map((p) => (p.id === id ? { ...p, timeframe: tf } : p)),
        })),

      toggleMarkerMode: () => set((s) => ({ markerMode: !s.markerMode })),

      addMarker: (time) =>
        set((s) => ({ markers: [...s.markers, { id: crypto.randomUUID(), time }] })),

      removeMarker: (id) =>
        set((s) => ({ markers: s.markers.filter((m) => m.id !== id) })),

      clearMarkers: () => set({ markers: [] }),

      __resetForTests: () =>
        set({ ...initialState, reference: { ...DEFAULT_REFERENCE }, markers: [], markerMode: false }),
    }),
    {
      name: "parallax-compare-store",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        // Persist the user's preferences but NOT the live `active` flag
        // (compare mode shouldn't auto-resume on reload) and NOT the
        // resolved conid (IBKR can re-issue them — always re-resolve).
        // markerMode is transient UI state — not persisted.
        reference: { symbol: state.reference.symbol, conid: null },
        panes: state.panes,
        markers: state.markers,
      }),
    },
  ),
);
