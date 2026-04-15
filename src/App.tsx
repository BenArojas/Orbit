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

import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { queryClient } from "@/lib/query";
import { useNavigationStore, type Screen } from "@/store";
import { useSidecar } from "@/hooks/useSidecar";
import { GatewayProvider } from "@/context/GatewayContext";
import { DashboardPage, AnalysisPage, ScreenerPage } from "@/pages";
import "./styles.css";

const NAV_ITEMS: { id: Screen; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "analysis", label: "Analysis" },
  { id: "screener", label: "Screener" },
];

/** Renders the active page based on navigation state */
function ActivePage() {
  const screen = useNavigationStore((s) => s.activeScreen);
  switch (screen) {
    case "dashboard":
      return <DashboardPage />;
    case "analysis":
      return <AnalysisPage />;
    case "screener":
      return <ScreenerPage />;
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

export default function App() {
  const { activeScreen, navigate } = useNavigationStore();

  return (
    <QueryClientProvider client={queryClient}>
      {/* GatewayProvider must be inside QueryClientProvider so useGateway
          can use TanStack Query internally if needed, and so all child
          components can call useIbkrReady() to gate IBKR queries. */}
      <GatewayProvider>
      <TooltipProvider>
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

          {/* ── Page content ── */}
          <main className="flex-1 overflow-hidden">
            <ActivePage />
          </main>
        </div>
      </TooltipProvider>
      </GatewayProvider>
    </QueryClientProvider>
  );
}
