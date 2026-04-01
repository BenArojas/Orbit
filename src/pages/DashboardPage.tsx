/**
 * Dashboard Page — Market pulse, gauges, sectors, watchlists
 *
 * This is a thin page shell. All business logic and heavy components
 * will be built in Phase 3 (tasks 3.1–3.8). For now it's a placeholder
 * that proves routing works.
 *
 * Layout from mockup: grid with main content + 310px sidebar
 *   Main: Market pulse bar (top), gauge row, sector panels, RRG
 *   Sidebar: Master watchlist, trigger watchlists, trigger rules
 */

export default function DashboardPage() {
  return (
    <div className="grid h-full grid-cols-[1fr_310px] grid-rows-[54px_1fr]">
      {/* Market Pulse bar — spans full width */}
      <div className="col-span-2 flex items-center border-b border-border bg-[var(--bg-1)] px-4">
        <span className="font-data text-xs text-[var(--text-3)]">
          Market Pulse — Phase 3
        </span>
      </div>

      {/* Main content area */}
      <div className="flex flex-col gap-4 overflow-y-auto p-4">
        {/* Gauge row placeholder */}
        <div className="flex gap-3">
          {["Market Strength", "VIX Fear", "Sector Rotation", "Active Triggers"].map(
            (label) => (
              <div
                key={label}
                className="flex min-w-[140px] flex-1 flex-col items-center rounded-lg border border-border bg-card p-4"
              >
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
                  {label}
                </span>
                <span className="font-data mt-2 text-2xl font-bold text-[var(--text-2)]">
                  --
                </span>
              </div>
            )
          )}
        </div>

        {/* Sector performance placeholder */}
        <div className="rounded-lg border border-border bg-card p-4">
          <span className="text-xs font-semibold text-[var(--text-2)]">
            Sector Performance — Phase 3
          </span>
        </div>

        {/* RRG placeholder */}
        <div className="rounded-lg border border-border bg-card p-4">
          <span className="text-xs font-semibold text-[var(--text-2)]">
            Relative Rotation Graph — Phase 3
          </span>
        </div>
      </div>

      {/* Sidebar */}
      <div className="flex flex-col overflow-y-auto border-l border-border bg-[var(--bg-1)]">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-[var(--bg-1)]/80 px-3.5 py-2.5 backdrop-blur">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
            Watchlist
          </span>
          <span className="rounded-full bg-[var(--bg-3)] px-1.5 py-0.5 font-data text-[9px] text-[var(--text-3)]">
            0
          </span>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <span className="text-xs text-[var(--text-3)]">
            Connect IBKR to load watchlist
          </span>
        </div>
      </div>
    </div>
  );
}
