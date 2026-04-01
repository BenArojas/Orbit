/**
 * Navigation Store — Zustand tab-based routing
 *
 * Parallax has 3 fixed screens: Dashboard, Analysis, Screener.
 * No need for React Router — a simple Zustand store drives which
 * page component renders. Desktop app, no URL routing needed.
 */

import { create } from "zustand";

export type Screen = "dashboard" | "analysis" | "screener";

interface NavigationState {
  /** Currently active screen */
  activeScreen: Screen;

  /** Navigate to a screen */
  navigate: (screen: Screen) => void;

  /**
   * Navigate to analysis with a specific instrument pre-loaded.
   * Used when clicking a stock in the watchlist or screener results.
   * Sets the chart store's active conid (see chart store).
   */
  navigateToAnalysis: (conid: number) => void;
}

export const useNavigationStore = create<NavigationState>()((set) => ({
  activeScreen: "dashboard",

  navigate: (screen) => set({ activeScreen: screen }),

  navigateToAnalysis: (conid) => {
    // Import chart store dynamically to avoid circular deps
    // The chart store will be set via its own action
    import("./chart").then(({ useChartStore }) => {
      useChartStore.getState().setActiveConid(conid);
    });
    set({ activeScreen: "analysis" });
  },
}));
