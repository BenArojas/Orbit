/**
 * Navigation Store — Zustand tab-based routing
 *
 * Parallax tabs are driven by Zustand (no React Router — desktop app, no URLs).
 *
 * The `connection` screen is special: it's only shown while the IBKR gateway
 * is not authenticated. `<AuthGuard>` forces it on when unauthenticated and
 * always lands on Market once authenticated.
 */

import { create } from "zustand";

export type Screen =
  | "connection"
  | "today"
  | "market"
  | "analysis"
  | "screener"
  | "settings";

export interface NamesContext {
  mainTab: "watchlist" | "discover";
  discoverTab: "leaders" | "custom";
  selectedWatchlistId: string;
  watchlistFilter: string;
  scrollTop: number;
  brokerSessionEpoch: number;
}

const INITIAL_NAMES_CONTEXT: NamesContext = {
  mainTab: "discover",
  discoverTab: "leaders",
  selectedWatchlistId: "",
  watchlistFilter: "",
  scrollTop: 0,
  brokerSessionEpoch: 0,
};

interface NavigationState {
  activeScreen: Screen;
  namesContext: NamesContext;

  navigate: (screen: Screen) => void;
  navigateToAnalysis: (conid: number, symbol?: string) => void;
  setNamesContext: (context: Partial<NamesContext>) => void;
  resetNamesBrokerContext: () => void;
}

export const useNavigationStore = create<NavigationState>()((set) => ({
  // Boots on the connection screen; AuthGuard flips to Market once the
  // gateway probe reports authenticated.
  activeScreen: "connection",
  namesContext: INITIAL_NAMES_CONTEXT,

  navigate: (screen) => set({ activeScreen: screen }),
  setNamesContext: (context) => set((state) => ({
    namesContext: { ...state.namesContext, ...context },
  })),
  resetNamesBrokerContext: () => set((state) => ({
    namesContext: {
      ...state.namesContext,
      selectedWatchlistId: "",
      watchlistFilter: "",
      brokerSessionEpoch: state.namesContext.brokerSessionEpoch + 1,
    },
  })),

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
