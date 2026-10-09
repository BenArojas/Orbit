/**
 * Analysis sidebar for Fibonacci, Watchlists, and Triggers.
 */

import { ChevronRight } from "lucide-react";
import FibStackPanel from "@/components/fibonacci/fib/FibStackPanel";
import WatchlistTab from "./WatchlistTab";
import TriggersTab from "./TriggersTab";
import { useChartStore } from "@/store/chart";
import { SetupPlanPanel, type SetupPlanEditor } from "./SetupPlanPanel";

type Tab = "fibonacci" | "watchlists" | "triggers" | "setup";

const TABS: { id: Tab; label: string }[] = [
  { id: "fibonacci", label: "Fibonacci" },
  { id: "watchlists", label: "Watchlists" },
  { id: "triggers", label: "Triggers" },
  { id: "setup", label: "Setup" },
];

interface RightSidebarProps {
  activeConid: number | null;
  activeSymbol: string;
  activeTimeframe?: string;
  setupPlanEditor: SetupPlanEditor;
  onCollapse?: () => void;
}

export default function RightSidebar({
  activeConid,
  activeSymbol,
  activeTimeframe,
  setupPlanEditor,
  onCollapse,
}: RightSidebarProps) {
  const activeTab = useChartStore((state) => state.rightPanelActiveTab);
  const setActiveTab = useChartStore((state) => state.setRightPanelActiveTab);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-l border-[var(--border)] bg-[var(--bg-1)]">
      <div className="flex border-b border-[var(--border)]">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            data-testid={`tab-${tab.id}`}
            aria-pressed={activeTab === tab.id}
            className={`min-w-0 flex-1 py-3 text-xs font-semibold transition-colors ${
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
            aria-label="Close analysis panel"
            className="ml-auto px-2 text-[var(--text-3)] transition-colors hover:text-[var(--clr-cyan)]"
          >
            <ChevronRight size={12} />
          </button>
        )}
      </div>

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-3">
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
        {activeTab === "setup" && <SetupPlanPanel conid={activeConid} symbol={activeSymbol} editor={setupPlanEditor} />}
      </div>
    </div>
  );
}
