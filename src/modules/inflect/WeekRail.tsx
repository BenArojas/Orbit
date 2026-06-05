import { cn } from "@/lib/utils";
import { formatSignedMoney } from "./format";
import type { InflectWeekRollup } from "./types";

/**
 * Right-rail weekly rollups, one cell per grid row. `weekIndex` is 1-based and
 * matches the backend's week_index (grid row N → week N). A row with no closed
 * trades renders a muted placeholder so the rail stays aligned with the grid.
 */
export function WeekRail({
  weekIndex,
  rollup,
}: {
  weekIndex: number;
  rollup?: InflectWeekRollup;
}) {
  const pnl = rollup?.net_pnl ?? null;
  const positive = pnl != null && pnl > 0;
  const negative = pnl != null && pnl < 0;

  return (
    <div
      className={cn(
        "flex min-h-[64px] flex-col justify-center rounded-md border px-2 py-1.5",
        positive && "border-[var(--clr-green)]/30 bg-[var(--clr-green)]/5",
        negative && "border-[var(--clr-red)]/30 bg-[var(--clr-red)]/5",
        !positive && !negative && "border-border bg-[var(--bg-2)]",
      )}
    >
      <div className="text-[9px] uppercase text-[var(--text-3)]">Week {weekIndex}</div>
      {rollup ? (
        <>
          <div
            className={cn(
              "font-data text-[12px] leading-tight",
              positive && "text-[var(--clr-green)]",
              negative && "text-[var(--clr-red)]",
            )}
          >
            {formatSignedMoney(pnl)}
          </div>
          <div className="text-[9px] text-[var(--text-3)]">
            {rollup.trading_days} {rollup.trading_days === 1 ? "day" : "days"}
          </div>
        </>
      ) : (
        <div className="font-data text-[12px] leading-tight text-[var(--text-3)]">--</div>
      )}
    </div>
  );
}
