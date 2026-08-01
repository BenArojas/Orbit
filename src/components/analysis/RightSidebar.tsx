/**
 * Analysis sidebar for Fibonacci, Watchlists, and Triggers.
 */

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import FibStackPanel from "@/components/fibonacci/fib/FibStackPanel";
import WatchlistTab from "./WatchlistTab";
import TriggersTab from "./TriggersTab";

type Tab = "fibonacci" | "watchlists" | "triggers";

const TABS: { id: Tab; label: string }[] = [
  { id: "fibonacci", label: "Fibonacci" },
  { id: "watchlists", label: "Watchlists" },
  { id: "triggers", label: "Triggers" },
];

interface RightSidebarProps {
  activeConid: number | null;
  activeSymbol: string;
  activeTimeframe?: string;
  onCollapse?: () => void;
}

export default function RightSidebar({
  activeConid,
  activeSymbol,
  activeTimeframe,
  onCollapse,
}: RightSidebarProps) {
  const [activeTab, setActiveTab] = useState<Tab>("fibonacci");

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden border-l border-[var(--border)] bg-[var(--bg-1)]">
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
        {onCollapse && (
          <button
            onClick={onCollapse}
            title="Collapse panel (\\)"
            className="ml-auto px-2 text-[var(--text-3)] transition-colors hover:text-[var(--clr-cyan)]"
          >
            <ChevronRight size={12} />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {activeTab === "fibonacci" && <FibStackPanel />}
        {activeTab === "watchlists" && (
          <WatchlistTab activeConid={activeConid} activeSymbol={activeSymbol} />
        )}
        {activeTab === "triggers" && (
          <TriggersTab
            activeConid={activeConid}
            activeSymbol={activeSymbol}
            activeTimeframe={activeTimeframe}
          />
        )}
      </div>
    </div>
  );
}
