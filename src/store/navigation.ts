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
  leadersPage: number;
  selectedLeaderConid: number | null;
  brokerSessionEpoch: number;
}

export interface AnalysisContext {
  returnTo: Screen;
  setupPlanId: number | null;
  conid: number | null;
}

export type TodayPlanFilter = "all" | "review" | "watching";
export type TodayHitFilter =
  | { kind: "all" }
  | { kind: "watchlist"; name: string }
  | { kind: "high-conf" };

export interface TodayContext {
  view: "plans" | "alerts";
  alertsScrollTop: number;
  planFilter: TodayPlanFilter;
  hitFilter: TodayHitFilter;
  selectedPlanId: number | null;
  scrollTop: number;
}

const INITIAL_NAMES_CONTEXT: NamesContext = {
  mainTab: "discover",
  discoverTab: "leaders",
  selectedWatchlistId: "",
  watchlistFilter: "",
  scrollTop: 0,
  leadersPage: 0,
  selectedLeaderConid: null,
  brokerSessionEpoch: 0,
};

const INITIAL_TODAY_CONTEXT: TodayContext = {
  view: "plans",
  alertsScrollTop: 0,
  planFilter: "all",
  hitFilter: { kind: "all" },
  selectedPlanId: null,
  scrollTop: 0,
};

interface NavigationState {
  activeScreen: Screen;
  namesContext: NamesContext;
  analysisContext: AnalysisContext;
  todayContext: TodayContext;
  analysisDraftDirty: boolean;

  navigate: (screen: Screen) => void;
  navigateToAnalysis: (conid: number, symbol?: string, setupPlanId?: number) => boolean;
  setAnalysisSetupPlanId: (id: number | null) => void;
  setAnalysisDraftDirty: (dirty: boolean) => void;
  resetAnalysisContext: () => void;
  setTodayContext: (context: Partial<TodayContext>) => void;
  setNamesContext: (context: Partial<NamesContext>) => void;
  resetNamesBrokerContext: () => void;
}

export const useNavigationStore = create<NavigationState>()((set, get) => ({
  // Boots on the connection screen; AuthGuard flips to Market once the
  // gateway probe reports authenticated.
  activeScreen: "connection",
  namesContext: INITIAL_NAMES_CONTEXT,
  analysisContext: { returnTo: "screener", setupPlanId: null, conid: null },
  todayContext: INITIAL_TODAY_CONTEXT,
  analysisDraftDirty: false,

  navigate: (screen) => {
    const state = get();
    if (
      state.activeScreen === "analysis" && screen !== "analysis" &&
      state.analysisDraftDirty &&
      typeof window !== "undefined" &&
      !window.confirm("Discard unsaved setup plan changes?")
    ) return;
    set({
      activeScreen: screen,
      ...(state.activeScreen === "analysis" && screen !== "analysis"
        ? { analysisDraftDirty: false, analysisContext: { ...state.analysisContext, setupPlanId: null, conid: null } }
        : {}),
    });
  },
  setNamesContext: (context) => set((state) => ({
    namesContext: { ...state.namesContext, ...context },
  })),
  setTodayContext: (context) => set((state) => ({
    todayContext: { ...state.todayContext, ...context },
  })),
  resetNamesBrokerContext: () => set((state) => ({
    namesContext: {
      ...state.namesContext,
      selectedWatchlistId: "",
      watchlistFilter: "",
      selectedLeaderConid: null,
      brokerSessionEpoch: state.namesContext.brokerSessionEpoch + 1,
    },
  })),
  setAnalysisSetupPlanId: (id) => set((state) => ({
    analysisContext: { ...state.analysisContext, setupPlanId: id },
  })),
  setAnalysisDraftDirty: (dirty) => set({ analysisDraftDirty: dirty }),
  resetAnalysisContext: () => set({
    analysisContext: { returnTo: "market", setupPlanId: null, conid: null },
    analysisDraftDirty: false,
  }),

  navigateToAnalysis: (conid, symbol = "", setupPlanId) => {
    const state = get();
    const nextPlanId = setupPlanId ?? null;
    const sameTarget = state.activeScreen === "analysis" &&
      state.analysisContext.setupPlanId === nextPlanId && state.analysisContext.conid === conid;
    if (
      state.activeScreen === "analysis" &&
      (state.analysisContext.setupPlanId !== nextPlanId || state.analysisContext.conid !== conid) &&
      state.analysisDraftDirty &&
      typeof window !== "undefined" &&
      !window.confirm("Discard unsaved setup plan changes?")
    ) return false;
    // Import chart store dynamically to avoid circular deps
    import("./chart").then(({ useChartStore }) => {
      useChartStore.getState().setActiveConid(conid);
      if (symbol) {
        useChartStore.getState().setActiveSymbol(symbol);
      }
      if (setupPlanId != null) useChartStore.getState().setRightPanelActiveTab("setup");
    });
    set((current) => ({
      activeScreen: "analysis",
      analysisContext: {
        returnTo: current.activeScreen === "analysis" ? current.analysisContext.returnTo : current.activeScreen,
        setupPlanId: nextPlanId,
        conid,
      },
      analysisDraftDirty: sameTarget ? current.analysisDraftDirty : false,
    }));
    return true;
  },
}));
