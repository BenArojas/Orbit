import { useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useInflectStore } from "@/store/inflect";
import { useInflectCalendar } from "@/hooks/useInflectCalendar";
import { selectedDateRangeMs, useInflectTrades } from "@/hooks/useInflectTrades";
import { cn } from "@/lib/utils";
import { CalendarGrid } from "./CalendarGrid";
import { formatMonthLabel, formatSignedMoney } from "./format";
import { TradeDetail } from "./TradeDetail";
import { TradesTable } from "./TradesTable";

function selectedDateLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

export function CalendarPage({ accountId }: { accountId: string | null }) {
  const year = useInflectStore((state) => state.year);
  const month = useInflectStore((state) => state.month);
  const stepMonth = useInflectStore((state) => state.stepMonth);
  const selectedDate = useInflectStore((state) => state.selectedDate);
  const selectedTradeId = useInflectStore((state) => state.selectedTradeId);
  const selectDay = useInflectStore((state) => state.selectDay);
  const selectTrade = useInflectStore((state) => state.selectTrade);

  const calendarQuery = useInflectCalendar(year, month, accountId ?? undefined);
  const data = calendarQuery.data;
  const totalPnl = data?.total_net_pnl ?? 0;
  const daysTraded = data?.days_traded ?? 0;
  const selectedRange = selectedDate ? selectedDateRangeMs(selectedDate) : undefined;
  const selectedDayQuery = useInflectTrades(
    accountId ?? undefined,
    "CLOSED",
    selectedRange,
    selectedDate != null,
  );
  const selectedDayTrades = selectedDayQuery.data?.trades ?? [];

  useEffect(() => {
    selectDay(null);
  }, [accountId, selectDay]);

  return (
    <main className="flex h-full min-h-0 flex-col gap-4 p-4 pb-8">
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
        <div className="min-h-0 flex-1 animate-pulse rounded-md border border-border bg-[var(--bg-2)]" />
      ) : (
        <div className="flex min-h-0 flex-1 gap-3">
          <div className="min-h-0 flex-1">
            <CalendarGrid
              year={year}
              month={month}
              days={data?.days ?? []}
              weeks={data?.weeks ?? []}
              selectedDate={selectedDate}
              onSelectDate={selectDay}
            />
          </div>

          {selectedDate ? (
            <aside
              role="region"
              aria-label={`Trades on ${selectedDateLabel(selectedDate)}`}
              className="flex w-[420px] shrink-0 flex-col rounded-md border border-border bg-[var(--bg-2)]"
            >
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <div>
                  <h3 className="text-[13px] font-semibold">
                    Trades on {selectedDateLabel(selectedDate)}
                  </h3>
                  <p className="text-[10px] text-[var(--text-3)]">Closed trades for the selected day.</p>
                </div>
                <button
                  type="button"
                  onClick={() => selectDay(null)}
                  className="h-7 rounded-md border border-border px-2 text-[11px] text-[var(--text-3)] hover:text-[var(--text-1)]"
                >
                  Clear
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {selectedDayQuery.error ? (
                  <div className="rounded-md border border-[var(--clr-red)]/50 bg-[var(--clr-red)]/10 p-3 text-[12px] text-[var(--clr-red)]">
                    Selected day trades are unavailable.
                  </div>
                ) : selectedDayQuery.isLoading ? (
                  <div className="min-h-[160px] animate-pulse rounded-md border border-border bg-[var(--bg-1)]" />
                ) : (
                  <TradesTable
                    trades={selectedDayTrades}
                    selectedTradeId={selectedTradeId}
                    onSelect={selectTrade}
                  />
                )}
              </div>
            </aside>
          ) : null}

          {selectedTradeId ? (
            <TradeDetail
              tradeId={selectedTradeId}
              accountId={accountId}
              onClose={() => selectTrade(null)}
            />
          ) : null}
        </div>
      )}
    </main>
  );
}
