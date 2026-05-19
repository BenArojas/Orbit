/**
 * Compare Store — Analysis-page Compare Mode state.
 *
 * Owns the active flag and the stack of configurable panes. Each pane
 * has its own reference symbol so the user can compare against multiple
 * relative tickers simultaneously (e.g. AAPL vs SPY, AAPL vs QQQ,
 * AAPL vs XLK in three panes side-by-side).
 *
 * Persisted to localStorage so per-pane references + layout + timeframe
 * survive a reload. Resolved conids are intentionally NOT persisted (IBKR
 * can re-issue them — always re-resolve on entry).
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import type { Timeframe } from "@/store/chart";

export type Layout = "overlay" | "stockOnly" | "refOnly";

export interface CompareReference {
  symbol: string;
  conid: number | null;
}

export interface ComparePane {
  id: string;
  layout: Layout;
  timeframe: Timeframe;
  /** Per-pane reference symbol — independent across panes. */
  reference: CompareReference;
}

export interface CompareMarker {
  id: string;
  time: number; // unix seconds, same as candle.time — identifies the bar
  /**
   * Sub-bar click position as a 0..1 ratio of bar width. 0 = bar's left
   * edge, 1 = bar's right edge. Persisted so the marker survives zoom
   * (the absolute pixel offset would drift when barSpacing changes).
   * Optional — older persisted markers default to 0.5 (bar center).
   */
  xRatio?: number;
}

interface CompareState {
  active: boolean;
  panes: ComparePane[];
  markerMode: boolean;
  markers: CompareMarker[];

  enter: (initialTimeframe: Timeframe) => void;
  exit: () => void;
  /** Per-pane reference setter — used by each pane's resolver. */
  setPaneReference: (paneId: string, symbol: string, conid: number) => void;
  /** Per-pane symbol-only setter; clears conid when symbol changes so
   *  the next resolve-on-mount cycle picks up the new symbol. */
  setPaneReferenceSymbol: (paneId: string, symbol: string) => void;
  addPane: () => void;
  removePane: (id: string) => void;
  setPaneLayout: (id: string, layout: Layout) => void;
  setPaneTimeframe: (id: string, tf: Timeframe) => void;
  toggleMarkerMode: () => void;
  addMarker: (time: number, xRatio?: number) => void;
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
                reference: { ...DEFAULT_REFERENCE },
              },
            ],
          };
        }),

      exit: () => set({ active: false, markerMode: false }),

      setPaneReference: (paneId, symbol, conid) =>
        set((state) => ({
          panes: state.panes.map((p) =>
            p.id === paneId ? { ...p, reference: { symbol, conid } } : p,
          ),
        })),

      setPaneReferenceSymbol: (paneId, symbol) =>
        set((state) => ({
          panes: state.panes.map((p) => {
            if (p.id !== paneId) return p;
            // Preserve conid if the symbol didn't actually change (the
            // resolver shouldn't have to fire again). Otherwise drop the
            // conid so the next mount/effect picks up the new symbol.
            const conid = p.reference.symbol === symbol ? p.reference.conid : null;
            return { ...p, reference: { symbol, conid } };
          }),
        })),

      addPane: () =>
        set((state) => {
          if (state.panes.length >= MAX_PANES) return {};
          const last = state.panes[state.panes.length - 1];
          const timeframe = last?.timeframe ?? "1D";
          // New panes inherit the previous pane's reference (symbol only —
          // conid will be re-resolved on mount). Matches how timeframe is
          // inherited and gives a natural "add another pane like this one"
          // feel; the user can change it via the pane's own input.
          const reference: CompareReference = last
            ? { symbol: last.reference.symbol, conid: null }
            : { ...DEFAULT_REFERENCE };
          return {
            panes: [
              ...state.panes,
              {
                id: newPaneId(),
                layout: "overlay" as Layout,
                timeframe,
                reference,
              },
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

      addMarker: (time, xRatio) =>
        set((s) => ({
          markers: [
            ...s.markers,
            { id: crypto.randomUUID(), time, xRatio: xRatio ?? 0.5 },
          ],
        })),

      removeMarker: (id) =>
        set((s) => ({ markers: s.markers.filter((m) => m.id !== id) })),

      clearMarkers: () => set({ markers: [] }),

      __resetForTests: () =>
        set({ ...initialState, panes: [], markers: [], markerMode: false }),
    }),
    {
      name: "parallax-compare-store",
      storage: createJSONStorage(() => localStorage),
      version: 2,
      // Migration: v0/v1 stored a single top-level `reference` shared
      // across all panes. v2 stores reference per-pane. Spread the
      // legacy top-level reference into any pane that doesn't have its
      // own. Future-proof: unknown versions fall through unchanged.
      migrate: (persisted, version) => {
        if (!persisted || typeof persisted !== "object") return persisted;
        if (version < 2) {
          const p = persisted as {
            reference?: CompareReference;
            panes?: Array<Partial<ComparePane>>;
          };
          const legacyRef = p.reference ?? { ...DEFAULT_REFERENCE };
          const migratedPanes = (p.panes ?? []).map((pane) => ({
            ...pane,
            reference: pane.reference ?? {
              symbol: legacyRef.symbol,
              conid: null,
            },
          }));
          // Drop the legacy top-level reference field on its way through.
          const { reference: _drop, ...rest } = p;
          return { ...rest, panes: migratedPanes };
        }
        return persisted;
      },
      partialize: (state) => ({
        // Persist user preferences but NOT the live `active` flag (compare
        // mode shouldn't auto-resume on reload) and NOT resolved conids
        // (IBKR can re-issue them — always re-resolve on mount).
        // markerMode is transient UI state — not persisted.
        panes: state.panes.map((p) => ({
          ...p,
          reference: { symbol: p.reference.symbol, conid: null },
        })),
        markers: state.markers,
      }),
    },
  ),
);
