import { ChevronLeft, ChevronRight } from "lucide-react";
import { useInflectStore } from "@/store/inflect";
import { useInflectCalendar } from "@/hooks/useInflectCalendar";
import { cn } from "@/lib/utils";
import { CalendarGrid } from "./CalendarGrid";
import { formatMonthLabel, formatSignedMoney } from "./format";

export function CalendarPage({ accountId }: { accountId: string | null }) {
  const year = useInflectStore((state) => state.year);
  const month = useInflectStore((state) => state.month);
  const stepMonth = useInflectStore((state) => state.stepMonth);

  const calendarQuery = useInflectCalendar(year, month, accountId ?? undefined);
  const data = calendarQuery.data;
  const totalPnl = data?.total_net_pnl ?? 0;
  const daysTraded = data?.days_traded ?? 0;

  return (
    <main className="space-y-4 p-4 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => stepMonth(-1)}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-[var(--bg-2)] text-[var(--text-2)] transition-colors hover:bg-[var(--bg-3)]"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={1.7} />
          </button>
          <h2 className="min-w-40 text-center text-[16px] font-semibold">
            {formatMonthLabel(year, month)}
          </h2>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => stepMonth(1)}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-[var(--bg-2)] text-[var(--text-2)] transition-colors hover:bg-[var(--bg-3)]"
          >
            <ChevronRight className="h-4 w-4" strokeWidth={1.7} />
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="rounded-md border border-border bg-[var(--bg-2)] px-3 py-2 text-right">
            <div className="text-[10px] uppercase text-[var(--text-3)]">Net P&amp;L</div>
            <div
              className={cn(
                "font-data text-[15px]",
                totalPnl > 0 && "text-[var(--clr-green)]",
                totalPnl < 0 && "text-[var(--clr-red)]",
              )}
            >
              {formatSignedMoney(totalPnl)}
            </div>
          </div>
          <div className="rounded-md border border-border bg-[var(--bg-2)] px-3 py-2 text-right">
            <div className="text-[10px] uppercase text-[var(--text-3)]">Days Traded</div>
            <div className="font-data text-[15px]">{daysTraded}</div>
          </div>
        </div>
      </div>

      {calendarQuery.error ? (
        <div className="rounded-md border border-[var(--clr-red)]/50 bg-[var(--clr-red)]/10 p-4 text-[12px] text-[var(--clr-red)]">
          Inflect calendar data is unavailable.
        </div>
      ) : calendarQuery.isLoading ? (
        <div className="min-h-[420px] animate-pulse rounded-md border border-border bg-[var(--bg-2)]" />
      ) : (
        <CalendarGrid year={year} month={month} days={data?.days ?? []} weeks={data?.weeks ?? []} />
      )}
    </main>
  );
}
