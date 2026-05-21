/**
 * Navigation Store — Zustand tab-based routing
 *
 * Parallax tabs are driven by Zustand (no React Router — desktop app, no URLs).
 *
 * The `connection` screen is special: it's only shown while the IBKR gateway
 * is not authenticated. `<AuthGuard>` forces it on/off based on auth state,
 * so we persist `previousAuthenticatedTab` (the last tab the user was on
 * while authenticated) and use it to restore after re-auth.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Screen =
  | "connection"
  | "today"
  | "market"
  | "analysis"
  | "screener"
  | "settings";

interface NavigationState {
  activeScreen: Screen;
  /** Last screen the user was on while authenticated. Used to restore on re-auth. */
  previousAuthenticatedTab: Screen;

  navigate: (screen: Screen) => void;
  navigateToAnalysis: (conid: number, symbol?: string) => void;
}

export const useNavigationStore = create<NavigationState>()(
  persist(
    (set, get) => ({
      activeScreen: "connection",
      previousAuthenticatedTab: "today",

      navigate: (screen) => {
        const current = get().activeScreen;
        if (current !== "connection") {
          set({ previousAuthenticatedTab: current });
        }
        set({ activeScreen: screen });
      },

      navigateToAnalysis: (conid, symbol = "") => {
        // Import chart store dynamically to avoid circular deps
        import("./chart").then(({ useChartStore }) => {
          useChartStore.getState().setActiveConid(conid);
          if (symbol) {
            useChartStore.getState().setActiveSymbol(symbol);
          }
        });
        const current = get().activeScreen;
        if (current !== "connection") {
          set({ previousAuthenticatedTab: "analysis" });
        }
        set({ activeScreen: "analysis" });
      },
    }),
    {
      name: "parallax-nav",
      version: 1,
      partialize: (s) => ({ previousAuthenticatedTab: s.previousAuthenticatedTab }),
    },
  ),
);
