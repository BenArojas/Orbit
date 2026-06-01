import { DayCell } from "./DayCell";
import { WeekRail } from "./WeekRail";
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

export function CalendarGrid({
  year,
  month,
  days,
  weeks,
}: {
  year: number;
  month: number;
  days: InflectCalendarDay[];
  weeks: InflectWeekRollup[];
}) {
  const grid = buildMonthGrid(year, month);
  const dayMap = new Map(days.map((d) => [d.date, d]));
  const weekMap = new Map(weeks.map((w) => [w.week_index, w]));

  return (
    <div className="flex gap-3">
      <div className="flex-1">
        <div className="mb-1 grid grid-cols-7 gap-2">
          {WEEKDAY_LABELS.map((label) => (
            <div key={label} className="text-center text-[10px] uppercase text-[var(--text-3)]">
              {label}
            </div>
          ))}
        </div>
        <div className="space-y-2">
          {grid.map((week, rowIndex) => (
            <div key={rowIndex} className="grid grid-cols-7 gap-2">
              {week.map((day, colIndex) => (
                <DayCell
                  key={colIndex}
                  day={day}
                  data={day != null ? dayMap.get(dayKey(year, month, day)) : undefined}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="w-32 shrink-0">
        <div className="mb-1 text-center text-[10px] uppercase text-[var(--text-3)]">Weekly</div>
        <div className="space-y-2">
          {grid.map((_week, rowIndex) => (
            <WeekRail key={rowIndex} weekIndex={rowIndex + 1} rollup={weekMap.get(rowIndex + 1)} />
          ))}
        </div>
      </div>
    </div>
  );
}
