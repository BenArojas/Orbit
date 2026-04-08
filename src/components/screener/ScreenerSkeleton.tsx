/**
 * Skeleton loaders for the screener page.
 *
 * - TableSkeleton: shimmer rows for the results table while scanning
 * - SlideOverSkeleton: shimmer for the quick-peek panel while loading
 * - PresetSkeleton: inline shimmer for the preset dropdown on first mount
 */

// ── Shimmer bar ───────────────────────────────────────────────

function Shimmer({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded bg-[var(--bg-3)] ${className}`}
    />
  );
}

// ── Results table skeleton ────────────────────────────────────

export function TableSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header row */}
      <div className="flex items-center gap-4 border-b border-border px-4 py-3">
        <Shimmer className="h-3 w-[60px]" />
        <Shimmer className="h-3 w-[120px]" />
        <Shimmer className="h-3 w-[40px]" />
        <div className="flex-1" />
        <Shimmer className="h-3 w-[50px]" />
        <Shimmer className="h-3 w-[50px]" />
        <Shimmer className="h-3 w-[60px]" />
        <Shimmer className="h-3 w-[60px]" />
      </div>

      {/* Data rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 border-b border-border/30 px-4 py-2.5"
          style={{ opacity: 1 - i * 0.07 }}
        >
          <Shimmer className="h-3 w-[50px]" />
          <Shimmer className="h-3 w-[100px]" />
          <Shimmer className="h-2.5 w-[30px]" />
          <div className="flex-1" />
          <Shimmer className="h-3 w-[45px]" />
          <Shimmer className="h-3 w-[45px]" />
          <Shimmer className="h-3 w-[55px]" />
          <Shimmer className="h-3 w-[55px]" />
        </div>
      ))}
    </div>
  );
}

// ── Slide-over skeleton ───────────────────────────────────────

export function SlideOverSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Shimmer className="h-5 w-[80px]" />
        <Shimmer className="h-4 w-[140px]" />
      </div>

      {/* Mini chart placeholder */}
      <Shimmer className="h-[120px] w-full rounded-lg" />

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-1">
            <Shimmer className="h-2.5 w-[60px]" />
            <Shimmer className="h-4 w-[80px]" />
          </div>
        ))}
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 pt-2">
        <Shimmer className="h-8 flex-1 rounded-md" />
        <Shimmer className="h-8 flex-1 rounded-md" />
      </div>
    </div>
  );
}

// ── Preset dropdown skeleton ──────────────────────────────────

export function PresetSkeleton() {
  return <Shimmer className="h-[28px] w-[180px] rounded-md" />;
}
