import CompareModeHeader from "./CompareModeHeader";
import ComparePane from "./ComparePane";
import { useCompareStore } from "@/store/compare";

export default function CompareView() {
  const panes = useCompareStore((s) => s.panes);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CompareModeHeader />
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto bg-[var(--bg-1)] p-1">
        {panes.map((pane) => (
          <ComparePane key={pane.id} pane={pane} />
        ))}
      </div>
    </div>
  );
}
