/**
 * App Shell — Root component with pill navigation
 *
 * Zustand-based tab routing between Dashboard, Analysis, and Screener.
 * Wraps the app with TanStack QueryClientProvider and TooltipProvider.
 *
 * Matches the approved Layout A v2 mockup:
 *   - 44px nav bar with gradient logo, pill nav, connection status
 *   - Cyan glow line below nav
 *   - Full viewport height below nav for page content
 *
 * Hub integration: When Parallax moves into the IBKR Hub, this shell becomes
 * a nested route under the Hub's top-level navigation. The nav bar will be
 * replaced by the Hub's global nav, and these pills become sub-tabs.
 */

import { lazy, Suspense, useEffect } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { queryClient } from "@/lib/query";
import { useNavigationStore, useSettingsStore, type Screen } from "@/store";
import { useSidecar } from "@/hooks/useSidecar";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useTriggerAlerts } from "@/hooks/useTriggerAlerts";
import { GatewayProvider } from "@/context/GatewayContext";
import { IbkrReconnectBanner } from "@/components/gateway/IbkrReconnectBanner";
import { HealthStrip } from "@/components/ui/HealthStrip";
import { Toaster } from "@/components/ui/Toaster";
// Dashboard and Settings are small — keep them eager so the shell feels instant.
import { DashboardPage, SettingsPage } from "@/pages";
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
  const { addHandler } = useWebSocket();

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useTriggerAlerts(addHandler);

  return { addHandler };
}

const NAV_ITEMS: { id: Screen; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "analysis", label: "Analysis" },
  { id: "screener", label: "Screener" },
  { id: "settings", label: "Settings" },
];

/** Renders the active page based on navigation state */
function ActivePage() {
  const screen = useNavigationStore((s) => s.activeScreen);
  switch (screen) {
    case "dashboard":
      return <DashboardPage />;
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

/** Connection status dot */
function ConnectionStatus() {
  const sidecar = useSidecar();

  const statusMap = {
    starting: { color: "text-[var(--clr-orange)]", label: "Starting..." },
    ready: { color: "text-[var(--clr-green)]", label: "Connected" },
    error: { color: "text-[var(--clr-red)]", label: "Error" },
    dev: { color: "text-[var(--clr-cyan)]", label: "Dev Mode" },
  } as const;

  const { color, label } = statusMap[sidecar.status];

  return (
    <div className="flex items-center gap-1.5 font-data text-[10px] text-[var(--text-3)]">
      <div
        className={`h-1.5 w-1.5 rounded-full ${color} animate-glow`}
        style={{ color: "inherit" }}
      />
      {label}
    </div>
  );
}

/**
 * AppShell — renders nav, reconnect banner, and active page.
 * Must be a child of GatewayProvider so it can read gateway context.
 */
function AppShell() {
  const { activeScreen, navigate } = useNavigationStore();
  const { addHandler } = useGlobalEffects();

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* ── Nav bar (44px) ── */}
      <nav className="relative z-10 flex h-11 items-center border-b border-border bg-gradient-to-b from-[var(--bg-1)]/95 to-[var(--bg-1)] px-5">
        {/* Cyan glow line */}
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[var(--clr-cyan)] to-transparent opacity-30" />

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

        {/* Connection status */}
        <ConnectionStatus />
      </nav>

      {/* ── IBKR session-dropped banner (7.1) ── */}
      <IbkrReconnectBanner addHandler={addHandler} />

      {/* ── Page content ── */}
      <main className="flex-1 overflow-hidden">
        <ActivePage />
      </main>

      {/* ── Health status strip (7.5) ── */}
      <HealthStrip />
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      {/* GatewayProvider must be inside QueryClientProvider so useGateway
          can use TanStack Query internally if needed, and so all child
          components can call useIbkrReady() to gate IBKR queries. */}
      <GatewayProvider>
        <TooltipProvider>
          <AppShell />
          {/* Global toast overlay — rendered outside AppShell so it's always on top */}
          <Toaster />
        </TooltipProvider>
      </GatewayProvider>
    </QueryClientProvider>
  );
}
