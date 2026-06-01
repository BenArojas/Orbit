import { cn } from "@/lib/utils";
import { formatSignedMoney } from "./format";
import type { InflectCalendarDay } from "./types";

/**
 * One day cell in the calendar grid. Blank padding days (outside the month)
 * render as an empty muted tile. Days with closed trades are tinted green/red
 * by net P&L; days inside the month with no trades stay neutral.
 */
export function DayCell({ day, data }: { day: number | null; data?: InflectCalendarDay }) {
  if (day == null) {
    return <div className="rounded-md border border-transparent bg-[var(--bg-1)]" aria-hidden />;
  }

  const pnl = data?.net_pnl ?? null;
  const positive = pnl != null && pnl > 0;
  const negative = pnl != null && pnl < 0;

  return (
    <div
      className={cn(
        "flex min-h-[64px] flex-col rounded-md border p-1.5 transition-colors",
        positive && "border-[var(--clr-green)]/40 bg-[var(--clr-green)]/10",
        negative && "border-[var(--clr-red)]/40 bg-[var(--clr-red)]/10",
        !positive && !negative && "border-border bg-[var(--bg-2)]",
      )}
    >
      <div className="text-[10px] text-[var(--text-3)]">{day}</div>
      {data ? (
        <div className="mt-auto">
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
            {data.trade_count} {data.trade_count === 1 ? "trade" : "trades"}
          </div>
        </div>
      ) : null}
    </div>
  );
}
