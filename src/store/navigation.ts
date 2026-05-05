/**
 * Navigation Store — Zustand tab-based routing
 *
 * Parallax has 3 fixed screens: Dashboard, Analysis, Screener.
 * No need for React Router — a simple Zustand store drives which
 * page component renders. Desktop app, no URL routing needed.
 */

import { create } from "zustand";

export type Screen = "dashboard" | "analysis" | "screener" | "settings";

interface NavigationState {
  /** Currently active screen */
  activeScreen: Screen;

  /** Navigate to a screen */
  navigate: (screen: Screen) => void;

  /**
   * Navigate to analysis with a specific instrument pre-loaded.
   * Used when clicking a stock in the watchlist or screener results.
   * Sets both activeConid and activeSymbol in the chart store so the
   * symbol input doesn't go stale between navigations.
   *
   * `symbol` defaults to "" — callers should pass it when available.
   * The AnalysisPage will re-sync from the store on mount.
   */
  navigateToAnalysis: (conid: number, symbol?: string) => void;
}

export const useNavigationStore = create<NavigationState>()((set) => ({
  activeScreen: "dashboard",

  navigate: (screen) => set({ activeScreen: screen }),

  navigateToAnalysis: (conid, symbol = "") => {
    // Import chart store dynamically to avoid circular deps
    import("./chart").then(({ useChartStore }) => {
      useChartStore.getState().setActiveConid(conid);
      if (symbol) {
        useChartStore.getState().setActiveSymbol(symbol);
      }
    });
    set({ activeScreen: "analysis" });
  },
}));
