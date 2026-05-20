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

interface CompareState {
  active: boolean;
  panes: ComparePane[];

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
};

export const useCompareStore = create<CompareState>()(
  persist(
    (set) => ({
      ...initialState,

      enter: (initialTimeframe) =>
        // Always open compare mode with a single fresh pane. The user can
        // add more via addPane(). Prior sticky-re-entry behavior was removed
        // because re-entering should feel like a clean start, not resume.
        set(() => ({
          active: true,
          panes: [
            {
              id: newPaneId(),
              layout: "overlay" as Layout,
              timeframe: initialTimeframe,
              reference: { ...DEFAULT_REFERENCE },
            },
          ],
        })),

      exit: () => set({ active: false }),

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

      __resetForTests: () => set({ ...initialState, panes: [] }),
    }),
    {
      name: "parallax-compare-store",
      storage: createJSONStorage(() => localStorage),
      version: 3,
      // Migration history:
      //   v0/v1 → v2: single top-level reference spread per-pane
      //   v2 → v3: marker feature removed (markers/markerMode dropped silently)
      migrate: (persisted, version) => {
        if (!persisted || typeof persisted !== "object") return persisted;
        let p = persisted as {
          reference?: CompareReference;
          panes?: Array<Partial<ComparePane>>;
          markers?: unknown;
          markerMode?: unknown;
        };
        if (version < 2) {
          const legacyRef = p.reference ?? { ...DEFAULT_REFERENCE };
          const migratedPanes = (p.panes ?? []).map((pane) => ({
            ...pane,
            reference: pane.reference ?? {
              symbol: legacyRef.symbol,
              conid: null,
            },
          }));
          const { reference: _drop, ...rest } = p;
          p = { ...rest, panes: migratedPanes };
        }
        if (version < 3) {
          // Drop the marker fields entirely — the feature was removed
          // because the click-position math kept misaligning. Future
          // marker-like features should pick a new field name.
          const { markers: _m, markerMode: _mm, ...rest } = p;
          p = rest;
        }
        return p;
      },
      partialize: (state) => ({
        // Persist user preferences but NOT the live `active` flag (compare
        // mode shouldn't auto-resume on reload) and NOT resolved conids
        // (IBKR can re-issue them — always re-resolve on mount).
        panes: state.panes.map((p) => ({
          ...p,
          reference: { symbol: p.reference.symbol, conid: null },
        })),
      }),
    },
  ),
);
