import { BarChart3, Circle, GitBranch, LayoutGrid, PieChart } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GraphType } from "./types";

const OPTIONS: { type: GraphType; label: string; icon: typeof LayoutGrid }[] = [
  { type: "treemap", label: "Treemap", icon: LayoutGrid },
  { type: "donut", label: "Donut", icon: PieChart },
  { type: "bubbles", label: "Bubbles", icon: Circle },
  { type: "leaders", label: "Leaders", icon: BarChart3 },
  { type: "flow", label: "Flow", icon: GitBranch },
];

export function GraphSwitcher({
  value,
  onChange,
}: {
  value: GraphType;
  onChange: (value: GraphType) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-md border border-border bg-[var(--bg-2)] p-1">
      {OPTIONS.map(({ type, label, icon: Icon }) => (
        <button
          key={type}
          type="button"
          aria-pressed={value === type}
          onClick={() => onChange(type)}
          className={cn(
            "flex h-8 items-center gap-1.5 rounded px-2 text-[11px] font-medium transition-colors",
            value === type
              ? "bg-[var(--clr-cyan)]/15 text-[var(--clr-cyan)]"
              : "text-[var(--text-3)] hover:bg-[var(--bg-3)] hover:text-[var(--text-1)]",
          )}
        >
          <Icon className="h-3.5 w-3.5" strokeWidth={1.7} />
          {label}
        </button>
      ))}
    </div>
  );
}

