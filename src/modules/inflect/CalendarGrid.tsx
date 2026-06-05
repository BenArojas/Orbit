import { DayCell } from "./DayCell";
import { WeekRail } from "./WeekRail";
import { cn } from "@/lib/utils";
import type { InflectCalendarDay, InflectWeekRollup } from "./types";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Split a 1-based month into Sunday-start grid rows of 7 cells, padding leading
 * and trailing positions with null. Row N corresponds to backend week_index
 * N+1 (the matcher uses the same Sunday-start offset), so the WeekRail lines up.
 */
export function buildMonthGrid(year: number, month: number): (number | null)[][] {
  const firstWeekday = new Date(year, month - 1, 1).getDay(); // 0 = Sunday
  const daysInMonth = new Date(year, month, 0).getDate();

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(day);
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** ISO YYYY-MM-DD key for a given day in the selected month. */
function dayKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dayLabel(year: number, month: number, day: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

function rowClass(rows: number): string {
  if (rows === 4) return "grid-rows-4";
  if (rows === 6) return "grid-rows-6";
  return "grid-rows-5";
}

export function CalendarGrid({
  year,
  month,
  days,
  weeks,
  selectedDate,
  onSelectDate,
}: {
  year: number;
  month: number;
  days: InflectCalendarDay[];
  weeks: InflectWeekRollup[];
  selectedDate?: string | null;
  onSelectDate?: (date: string) => void;
}) {
  const grid = buildMonthGrid(year, month);
  const dayMap = new Map(days.map((d) => [d.date, d]));
  const weekMap = new Map(weeks.map((w) => [w.week_index, w]));
  const rows = rowClass(grid.length);

  return (
    <div className="flex h-full min-h-0 gap-3">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-1 grid shrink-0 grid-cols-7 gap-2">
          {WEEKDAY_LABELS.map((label) => (
            <div key={label} className="text-center text-[10px] uppercase text-[var(--text-3)]">
              {label}
            </div>
          ))}
        </div>
        <div className={cn("grid min-h-0 flex-1 grid-cols-7 gap-2", rows)}>
          {grid.flat().map((day, index) => {
            const key = day != null ? dayKey(year, month, day) : undefined;
            return (
              <DayCell
                key={index}
                day={day}
                data={key ? dayMap.get(key) : undefined}
                dateKey={key}
                dateLabel={day != null ? dayLabel(year, month, day) : undefined}
                selected={key === selectedDate}
                onSelectDate={onSelectDate}
              />
            );
          })}
        </div>
      </div>

      <div className="flex w-32 shrink-0 flex-col">
        <div className="mb-1 shrink-0 text-center text-[10px] uppercase text-[var(--text-3)]">
          Weekly
        </div>
        <div className={cn("grid min-h-0 flex-1 gap-2", rows)}>
          {grid.map((_week, rowIndex) => (
            <div key={rowIndex} className="h-full [&>*]:h-full">
              <WeekRail weekIndex={rowIndex + 1} rollup={weekMap.get(rowIndex + 1)} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
