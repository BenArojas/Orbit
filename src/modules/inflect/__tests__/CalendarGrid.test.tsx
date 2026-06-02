/**
 * CalendarGrid tests — the Sunday-start month-grid math and day/week wiring.
 *
 * buildMonthGrid must place day 1 under the correct weekday and pad to whole
 * weeks; the rendered grid must tint days by net P&L and align WeekRail rows
 * 1:1 with grid rows (row N → week_index N+1, matching the backend matcher).
 */

import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { buildMonthGrid, CalendarGrid } from "../CalendarGrid";
import type { InflectCalendarDay, InflectWeekRollup } from "../types";

describe("buildMonthGrid", () => {
  it("places June 2026 (Jun 1 = Monday) with one leading blank", () => {
    const grid = buildMonthGrid(2026, 6);
    // Sunday-start: Monday is column index 1, so exactly one leading null.
    expect(grid[0][0]).toBeNull();
    expect(grid[0][1]).toBe(1);
    // Every row is a full week of 7.
    grid.forEach((week) => expect(week).toHaveLength(7));
    // 30 days + 1 leading blank = 31 cells → padded to 35 (5 rows).
    expect(grid.flat().filter((d) => d != null)).toHaveLength(30);
  });

  it("starts February 2026 (Feb 1 = Sunday) with no leading blank", () => {
    const grid = buildMonthGrid(2026, 2);
    expect(grid[0][0]).toBe(1);
  });
});

describe("CalendarGrid", () => {
  const days: InflectCalendarDay[] = [
    { date: "2026-06-02", net_pnl: 150, trade_count: 2 },
    { date: "2026-06-03", net_pnl: -75, trade_count: 1 },
  ];
  const weeks: InflectWeekRollup[] = [
    { week_index: 1, net_pnl: 75, trading_days: 2 },
  ];

  it("renders day P&L and weekly rollups", () => {
    render(<CalendarGrid year={2026} month={6} days={days} weeks={weeks} />);
    expect(screen.getByText("+$150.00")).toBeInTheDocument();
    expect(screen.getByText("-$75.00")).toBeInTheDocument();
    expect(screen.getByText("Week 1")).toBeInTheDocument();
    // The week 1 rollup P&L (+$75.00) appears in the rail.
    expect(screen.getByText("+$75.00")).toBeInTheDocument();
  });

  it("renders weekday headers", () => {
    render(<CalendarGrid year={2026} month={6} days={[]} weeks={[]} />);
    expect(screen.getByText("Sun")).toBeInTheDocument();
    expect(screen.getByText("Sat")).toBeInTheDocument();
  });

  it("uses the available vertical space instead of fixed-height rows", () => {
    const { container } = render(<CalendarGrid year={2026} month={6} days={days} weeks={weeks} />);
    expect(container.firstElementChild).toHaveClass("h-full");
    expect(screen.getByRole("button", { name: /june 2, 2026/i })).toHaveClass("h-full");
  });

  it("selects a traded day by click and keyboard", () => {
    const onSelectDate = vi.fn();
    render(
      <CalendarGrid
        year={2026}
        month={6}
        days={days}
        weeks={weeks}
        selectedDate="2026-06-03"
        onSelectDate={onSelectDate}
      />,
    );

    const tradedDay = screen.getByRole("button", { name: /june 2, 2026.+2 trades/i });
    fireEvent.click(tradedDay);
    expect(onSelectDate).toHaveBeenCalledWith("2026-06-02");

    const selectedDay = screen.getByRole("button", { name: /june 3, 2026.+selected/i });
    fireEvent.keyDown(selectedDay, { key: "Enter" });
    expect(onSelectDate).toHaveBeenCalledWith("2026-06-03");
  });
});
