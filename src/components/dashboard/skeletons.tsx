/**
 * Dashboard skeleton loaders — Phase 8 / Task 8.9
 *
 * Pulse-animated placeholder UI shown while:
 *   - IBKR is connecting
 *   - A component's tier gate hasn't fired yet
 *   - A query is actively fetching
 *
 * Every skeleton matches the rough visual footprint of the real component so
 * the dashboard doesn't jump when data arrives.
 *
 * Style follows the existing screener skeletons: animate-pulse + bg-[var(--bg-3)].
 */

// ── Atomic pulse bar ──────────────────────────────────────────

export function Pulse({
  className = "",
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`animate-pulse rounded bg-[var(--bg-3)] ${className}`}
      style={style}
    />
  );
}

// ── Market Pulse bar (13 tickers) ────────────────────────────

export function MarketPulseSkeleton({ count = 13 }: { count?: number }) {
  return (
    <div className="col-span-2 flex items-center justify-center overflow-hidden border-b border-border bg-[var(--bg-1)]">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex min-w-[115px] flex-col gap-1 px-[18px] py-2"
        >
          <div className="flex items-center justify-between gap-2">
            <Pulse className="h-2.5 w-[30px]" />
            <Pulse className="h-3 w-[44px]" />
          </div>
          <div className="flex items-center justify-between gap-2">
            <Pulse className="h-2 w-[36px]" />
            <Pulse className="h-[14px] w-[32px]" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Arc Gauge Row (4 gauges) ─────────────────────────────────

export function ArcGaugeRowSkeleton() {
  return (
    <div className="flex gap-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="flex min-w-[140px] flex-1 flex-col items-center gap-2 rounded-[10px] border border-border bg-card p-3"
        >
          <div className="flex w-full items-center justify-between">
            <Pulse className="h-2.5 w-[60px]" />
            <Pulse className="h-3 w-[38px] rounded-full" />
          </div>
          {/* SVG arc placeholder — matches 120x65 viewBox */}
          <Pulse className="h-[40px] w-[110px] rounded-t-full" />
          <Pulse className="h-4 w-[38px]" />
          <Pulse className="h-2 w-[80px]" />
        </div>
      ))}
    </div>
  );
}

// ── Sector Performance (horizontal bars) ─────────────────────

export function SectorPerformanceSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <Pulse className="h-3 w-[110px]" />
        <Pulse className="h-3 w-[60px] rounded-full" />
      </div>
      <div className="flex flex-col gap-2 p-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-2">
            <Pulse className="h-3 w-[40px]" />
            <Pulse className="h-3 flex-1" style={{ opacity: 1 - i * 0.12 } as React.CSSProperties} />
            <Pulse className="h-3 w-[40px]" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── RRG scatter plot ─────────────────────────────────────────

export function RRGSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <Pulse className="h-3 w-[150px]" />
        <Pulse className="h-3 w-[50px] rounded-full" />
      </div>
      <div className="relative h-[220px] bg-[var(--bg-1)] overflow-hidden">
        {/* Crosshairs */}
        <div className="absolute top-1/2 left-0 right-0 h-px bg-[var(--border)]" />
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-[var(--border)]" />
        {/* Scattered fake dots */}
        {[
          { top: "20%", left: "68%" },
          { top: "35%", left: "78%" },
          { top: "60%", left: "30%" },
          { top: "72%", left: "55%" },
          { top: "42%", left: "22%" },
        ].map((pos, i) => (
          <Pulse
            key={i}
            className="absolute h-2 w-2 rounded-full"
            style={pos as React.CSSProperties}
          />
        ))}
      </div>
    </div>
  );
}

// ── Watchlist sidebar ────────────────────────────────────────

export function WatchlistSidebarSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="flex h-full flex-col gap-2 p-3">
      {/* Dropdown + search */}
      <Pulse className="h-7 w-full rounded-md" />
      <Pulse className="h-7 w-full rounded-md" />
      {/* Rows */}
      <div className="flex flex-col gap-1 pt-2">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-2 py-1.5"
            style={{ opacity: 1 - i * 0.08 }}
          >
            <Pulse className="h-3 w-[50px]" />
            <div className="flex-1" />
            <Pulse className="h-3 w-[45px]" />
            <Pulse className="h-2.5 w-[35px]" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Compact sidebar panel (trigger hits / rules / config) ────

export function SidebarPanelSkeleton({
  title = true,
  rows = 3,
}: {
  title?: boolean;
  rows?: number;
}) {
  return (
    <div className="flex flex-col gap-1 border-t border-border p-2">
      {title && <Pulse className="h-2.5 w-[90px]" />}
      {Array.from({ length: rows }).map((_, i) => (
        <Pulse
          key={i}
          className="h-3 w-full"
          style={{ opacity: 1 - i * 0.15 } as React.CSSProperties}
        />
      ))}
    </div>
  );
}

// ── Alert Log row (single line) ──────────────────────────────

export function AlertLogSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-1 p-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-2 py-1"
          style={{ opacity: 1 - i * 0.2 }}
        >
          <Pulse className="h-3 w-[60px]" />
          <Pulse className="h-3 w-[50px]" />
          <Pulse className="h-3 flex-1" />
          <Pulse className="h-3 w-[80px]" />
        </div>
      ))}
    </div>
  );
}
