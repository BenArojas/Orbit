/**
 * Screener Page — Filter stocks by indicator criteria
 *
 * Thin page shell. Components built in Phase 5 (tasks 5.1–5.6).
 *
 * Layout: filter bar (top) + results table (main)
 * Clicking a result navigates to Analysis with that ticker.
 */

export default function ScreenerPage() {
  return (
    <div className="flex h-full flex-col">
      {/* Filter bar placeholder */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-[var(--bg-1)] px-4 py-2.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
          Screener Filters
        </span>
        <span className="font-data text-[9px] text-[var(--text-3)]">
          — Phase 5
        </span>
      </div>

      {/* Results table placeholder */}
      <div className="flex flex-1 items-center justify-center">
        <span className="text-sm text-[var(--text-3)]">
          Screener results — Phase 5
        </span>
      </div>
    </div>
  );
}
