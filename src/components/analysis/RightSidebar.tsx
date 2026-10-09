/**
 * Analysis sidebar for Fibonacci, Watchlists, and Triggers.
 */

import { ChevronRight } from "lucide-react";
import FibStackPanel from "@/components/fibonacci/fib/FibStackPanel";
import WatchlistTab from "./WatchlistTab";
import TriggersTab from "./TriggersTab";
import { useChartStore } from "@/store/chart";
import { SetupPlanPanel } from "./SetupPlanPanel";
import type { SetupPlanEditor } from "./useSetupPlanEditor";
import { QuickAlertReview } from "./QuickAlertReview";
import { useNavigationStore } from "@/store/navigation";

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
  const hitId = useNavigationStore((state) => state.analysisContext.triggerHitId);
  const activeTab = useChartStore((state) => state.rightPanelActiveTab);
  const setActiveTab = useChartStore((state) => state.setRightPanelActiveTab);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-l border-[var(--border)] bg-[var(--bg-1)]">
      <div className="flex gap-1 border-b border-[var(--border)] p-1.5">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            data-testid={`tab-${tab.id}`}
            aria-pressed={activeTab === tab.id}
            className={`min-w-0 flex-1 rounded-md px-1 py-2.5 text-[15px] font-medium focus-visible:outline-2 focus-visible:outline-[var(--clr-cyan)] ${
              activeTab === tab.id
                ? "bg-[var(--bg-0)] text-[var(--clr-cyan)] shadow-sm"
                : "text-[var(--text-2)] hover:bg-[var(--bg-2)]"
            }`}
          >
            {tab.id === "setup" && hitId != null ? "Alert" : tab.label}
          </button>
        ))}
        {onCollapse && (
          <button
            onClick={onCollapse}
            title="Collapse panel (\\)"
            aria-label="Close analysis panel"
            className="ml-auto rounded-md px-2 text-[var(--text-2)] hover:bg-[var(--bg-2)] focus-visible:outline-2 focus-visible:outline-[var(--clr-cyan)]"
          >
            <ChevronRight size={16} />
          </button>
        )}
      </div>

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4">
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
        {activeTab === "setup" && (hitId != null ? <QuickAlertReview hitId={hitId} conid={activeConid} /> : <SetupPlanPanel conid={activeConid} symbol={activeSymbol} editor={setupPlanEditor} />)}
      </div>
    </div>
  );
}
