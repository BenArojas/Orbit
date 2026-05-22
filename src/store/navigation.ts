/**
 * Navigation Store — Zustand tab-based routing
 *
 * Parallax tabs are driven by Zustand (no React Router — desktop app, no URLs).
 *
 * The `connection` screen is special: it's only shown while the IBKR gateway
 * is not authenticated. `<AuthGuard>` forces it on when unauthenticated and
 * always lands on Today once authenticated.
 */

import { create } from "zustand";

export type Screen =
  | "connection"
  | "today"
  | "market"
  | "analysis"
  | "screener"
  | "settings";

interface NavigationState {
  activeScreen: Screen;

  navigate: (screen: Screen) => void;
  navigateToAnalysis: (conid: number, symbol?: string) => void;
}

export const useNavigationStore = create<NavigationState>()((set) => ({
  // Boots on the connection screen; AuthGuard flips to Today once the
  // gateway probe reports authenticated.
  activeScreen: "connection",

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
