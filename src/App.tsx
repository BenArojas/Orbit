/**
 * App Shell — Root component with pill navigation
 *
 * Zustand-based tab routing across Connection / Today / Market / Analysis / Screener / Settings.
 * Wraps the app with TanStack QueryClientProvider and TooltipProvider.
 *
 * Matches the approved Layout A v2 mockup:
 *   - 44px nav bar with gradient logo, pill nav, connection status
 *   - Cyan glow line below nav
 *   - Full viewport height below nav for page content
 *
 * Orbit integration: When Parallax moves into the Orbit, this shell becomes
 * a nested route under Orbit's top-level navigation. The nav bar will be
 * replaced by Orbit's global nav, and these pills become sub-tabs.
 */

import { lazy, Suspense, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { LayoutGrid } from "lucide-react";
import { queryClient } from "@/lib/query";
import { initNetworkMonitor } from "@/lib/network";
import {
  useNavigationStore,
  useSettingsStore,
  usePulseConfigStore,
  type Screen,
} from "@/store";
import { useSidecar } from "@/hooks/useSidecar";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useTriggerAlerts } from "@/hooks/useTriggerAlerts";
import { useGatewayContext } from "@/context/GatewayContext";
import { IbkrReconnectBanner } from "@/components/gateway/IbkrReconnectBanner";
import { HealthStrip } from "@/components/ui/HealthStrip";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { AuthGuard } from "@/components/shell/AuthGuard";
// Connection + Settings are small — keep eager so the shell feels instant.
import { SettingsPage } from "@/pages";
import ConnectionPage from "@/pages/ConnectionPage";
// Today and Market are lazy — they'll grow as Tasks 2/9 land.
const TodayPage = lazy(() => import("@/pages/TodayPage"));
const MarketPage = lazy(() => import("@/pages/MarketPage"));
// Analysis and Screener are heavy (TradingView charts, screener logic).
// Lazy-load so their JS is only parsed when the user first navigates there.
const AnalysisPage = lazy(() => import("@/pages/AnalysisPage"));
const ScreenerPage = lazy(() => import("@/pages/ScreenerPage"));
import "./styles.css";

/** Minimal full-screen skeleton shown while a lazy page chunk loads. */
function PageSkeleton() {
  return (
    <div className="flex h-full items-center justify-center">
      <span className="font-data text-[11px] text-[var(--text-3)] animate-pulse">
        Loading…
      </span>
    </div>
  );
}

/**
 * Global side-effects: settings hydration + WS trigger-alert bridge.
 * Mounted inside the providers so the stores are available.
 *
 * Returns addHandler so the reconnect banner can subscribe to WS events
 * through the same shared socket connection.
 */
function useGlobalEffects() {
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const loadPulseConfig = usePulseConfigStore((s) => s.load);
  const themeMode = useSettingsStore((s) => s.themeMode);
  const { addHandler } = useWebSocket();

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  // Phase 8.9+ — hydrate the user's Market Pulse ticker list.
  // Kept separate from `loadSettings` so a failing /pulse-config request
  // doesn't block unrelated settings state.
  useEffect(() => {
    void loadPulseConfig();
  }, [loadPulseConfig]);

  // Phase 8.1-F — wire browser offline/online events to the singleton
  // toast + auto-refetch on recovery. Cleanup returned so StrictMode
  // double-mount in dev doesn't leak listeners.
  useEffect(() => {
    return initNetworkMonitor(queryClient);
  }, []);

  // Phase 8.9+ — keep `<html>` class in sync with the persisted theme.
  // CSS palette switches off `.dark` vs `.light` on :root, so this is
  // the single source of truth for theme application.
  useEffect(() => {
    const html = document.documentElement;
    html.classList.remove("dark", "light");
    html.classList.add(themeMode);
  }, [themeMode]);

  useTriggerAlerts(addHandler);

  return { addHandler };
}

// The "connection" screen is intentionally absent from this list — it's
// surfaced by <AuthGuard> when the IBKR session is missing, not via a tab.
const NAV_ITEMS: { id: Screen; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "market", label: "Market" },
  { id: "analysis", label: "Analysis" },
  { id: "screener", label: "Screener" },
  { id: "settings", label: "Settings" },
];

/** Renders the active page based on navigation state */
function ActivePage() {
  const screen = useNavigationStore((s) => s.activeScreen);
  switch (screen) {
    case "connection":
      return <ConnectionPage />;
    case "today":
      return (
        <Suspense fallback={<PageSkeleton />}>
          <TodayPage />
        </Suspense>
      );
    case "market":
      return (
        <Suspense fallback={<PageSkeleton />}>
          <MarketPage />
        </Suspense>
      );
    case "analysis":
      return (
        <Suspense fallback={<PageSkeleton />}>
          <AnalysisPage />
        </Suspense>
      );
    case "screener":
      return (
        <Suspense fallback={<PageSkeleton />}>
          <ScreenerPage />
        </Suspense>
      );
    case "settings":
      return <SettingsPage />;
  }
}

/**
 * Connection status dot — reflects the Python sidecar (FastAPI backend),
 * NOT the IBKR gateway session. IBKR state is surfaced separately by
 * GatewaySetup and the IbkrReconnectBanner. We label it "Backend" to
 * avoid the ambiguity of a plain "Connected" badge when a user's IBKR
 * session has actually dropped.
 */
function ConnectionStatus() {
  const sidecar = useSidecar();

  const statusMap = {
    starting: { color: "text-[var(--clr-orange)]", label: "API: starting…" },
    ready: { color: "text-[var(--clr-green)]", label: "API: ready" },
    error: { color: "text-[var(--clr-red)]", label: "API: error" },
    dev: { color: "text-[var(--clr-cyan)]", label: "API: dev" },
  } as const;

  const { color, label } = statusMap[sidecar.status];

  return (
    <div
      className="flex items-center gap-1.5 font-data text-[10px] text-[var(--text-3)]"
      title="Python sidecar (FastAPI) status — IBKR auth state is shown separately"
    >
      <div
        className={`h-1.5 w-1.5 rounded-full ${color} animate-glow`}
        style={{ color: "inherit" }}
      />
      {label}
    </div>
  );
}

/**
 * NavLogoutButton — soft IBKR logout, shown in the navbar only while
 * authenticated. Drops the IBKR session (JVM stays up); AuthGuard then
 * routes back to the Connection screen.
 */
function NavLogoutButton() {
  const { isAuthenticated, logout, actionLoading } = useGatewayContext();
  if (!isAuthenticated) return null;
  return (
    <button
      type="button"
      onClick={logout}
      disabled={actionLoading}
      title="Log out of IBKR (gateway stays running)"
      className="rounded-md border border-border px-2.5 py-[3px] text-[10px] font-medium text-[var(--text-3)] transition-colors hover:border-[var(--clr-red)] hover:text-[var(--clr-red)] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {actionLoading ? "…" : "Logout"}
    </button>
  );
}

/**
 * AppShell — renders nav, reconnect banner, and active page.
 * Must be a child of GatewayProvider so it can read gateway context.
 */
function AppShell() {
  const { activeScreen, navigate } = useNavigationStore();
  const toLauncher = useNavigate();
  const { addHandler } = useGlobalEffects();

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* ── Nav bar (min-h 44px, 8px vertical padding) ── */}
      <nav className="relative z-10 flex min-h-11 items-center border-b border-border bg-gradient-to-b from-[var(--bg-1)]/95 to-[var(--bg-1)] px-5 py-2">
        {/* Cyan glow line */}
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[var(--clr-cyan)] to-transparent opacity-30" />

        {/* Back to Orbit launcher */}
        <button
          type="button"
          onClick={() => toLauncher("/")}
          title="Back to Orbit launcher"
          className="mr-4 flex items-center gap-1.5 rounded-md border border-border px-2.5 py-[3px] text-[10px] font-medium text-[var(--text-3)] transition-colors hover:border-[var(--clr-cyan)] hover:text-[var(--clr-cyan)]"
        >
          <LayoutGrid className="h-3 w-3" />
          Orbit
        </button>

        {/* Logo */}
        <span className="text-[15px] font-extrabold tracking-[3px] text-gradient-brand">
          PARALLAX
        </span>

        {/* Pill navigation — centered */}
        <div className="mx-auto flex gap-0.5 rounded-[22px] border border-border bg-[var(--bg-2)] p-[3px]">
          {NAV_ITEMS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => navigate(id)}
              className={`rounded-[18px] px-5 py-[5px] text-[11px] font-medium transition-all ${
                id === activeScreen
                  ? "bg-[var(--bg-4)] text-foreground shadow-[0_0_12px_var(--glow-cyan)]"
                  : "text-[var(--text-3)] hover:text-[var(--text-2)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Connection status + logout + theme toggle (top-right) */}
        <div className="flex items-center gap-3">
          <ConnectionStatus />
          <NavLogoutButton />
          <ThemeToggle />
        </div>
      </nav>

      {/* ── IBKR session-dropped banner (7.1) ── */}
      <IbkrReconnectBanner addHandler={addHandler} />

      {/* ── Page content ── */}
      {/* min-h-0 lets <main> shrink below its content's intrinsic height in
          this flex column. Without it, a tall page (e.g. a long AI response
          in the Analysis right sidebar) could push <main> past its flex-1
          share and trigger window-level scroll — which then becomes the
          target for any descendant scrollIntoView call. */}
      <main className="min-h-0 flex-1 overflow-hidden">
        <AuthGuard>
          <ActivePage />
        </AuthGuard>
      </main>

      {/* ── Health status strip (7.5) ── */}
      <HealthStrip />
    </div>
  );
}

export default function App() {
  return <AppShell />;
}
