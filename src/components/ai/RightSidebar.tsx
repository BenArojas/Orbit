/**
 * RightSidebar — Tabbed right-sidebar for the Analysis page.
 *
 * Three tabs:
 *   AI         — AiChatPanel (config, signal, streaming chat)
 *   Watchlists — WatchlistTab (checkbox list, add/remove conid)
 *   Triggers   — TriggersTab  (rules for this stock, enable toggle)
 *
 * The tab bar sits at the very top of the 340px sidebar column. Each tab
 * mounts its content lazily — the AI panel is visible on first load.
 */

import { useState } from "react";
import type { IndicatorId } from "@/store/chart";
import type { FibonacciResult } from "@/lib/api";
import AiChatPanel from "./AiChatPanel";
import WatchlistTab from "./WatchlistTab";
import TriggersTab from "./TriggersTab";

/* ── Types ── */

type Tab = "ai" | "watchlists" | "triggers";

const TABS: { id: Tab; label: string }[] = [
  { id: "ai", label: "AI" },
  { id: "watchlists", label: "Watchlists" },
  { id: "triggers", label: "Triggers" },
];

interface RightSidebarProps {
  /** Currently active instrument conid (from chart store) */
  activeConid: number | null;
  /** Currently active symbol string */
  activeSymbol: string;
  /** Current Fibonacci auto-detection result */
  fibonacci?: FibonacciResult | null;
  /** Currently active indicators on the chart */
  chartIndicators?: Set<IndicatorId>;
}

/* ── Component ── */

export default function RightSidebar({
  activeConid,
  activeSymbol,
  fibonacci,
  chartIndicators,
}: RightSidebarProps) {
  const [activeTab, setActiveTab] = useState<Tab>("ai");

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden border-l border-[var(--border)] bg-[var(--bg-1)]">
      {/* ── Tab bar ── */}
      <div className="flex border-b border-[var(--border)]">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            data-testid={`tab-${tab.id}`}
            className={`flex-1 py-2 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
              activeTab === tab.id
                ? "border-b-2 border-[var(--clr-cyan)] text-[var(--clr-cyan)]"
                : "text-[var(--text-3)] hover:text-[var(--text-2)]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* AI panel — always mounted so chat state is preserved when switching tabs */}
        <div className={activeTab === "ai" ? "flex h-full min-h-0 flex-col overflow-hidden" : "hidden"}>
          <AiChatPanel
            activeConid={activeConid}
            activeSymbol={activeSymbol}
            fibonacci={fibonacci}
            chartIndicators={chartIndicators}
          />
        </div>

        {activeTab === "watchlists" && (
          <WatchlistTab activeConid={activeConid} activeSymbol={activeSymbol} />
        )}

        {activeTab === "triggers" && (
          <TriggersTab activeConid={activeConid} activeSymbol={activeSymbol} />
        )}
      </div>
    </div>
  );
}
