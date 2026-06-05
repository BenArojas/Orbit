/**
 * FibLockedCard — compact representation of a locked fib in the
 * FibStackPanel.
 *
 * Locked fibs are read-only references the user pinned to the chart.
 * They don't carry a score or candidates list (they were never run
 * through the scorer), so this card only shows:
 *   - color swatch (matching the chart line color)
 *   - swing range
 *   - source label ("locked")
 *   - delete (×) button
 *   - optional user note
 *
 * Branch 4 / plan decision 8.
 */

import type { ActiveFib } from "@/store/chart";
import { FIB_COLOR_PALETTE } from "@/store/chart";

interface FibLockedCardProps {
  fib: ActiveFib;
  index: number;            // 1-based position among LOCKED fibs (for "L1", "L2"...)
  onDelete: (fib: ActiveFib) => void;
  onToggleVisibility: (fib: ActiveFib) => void;
  isDeleting?: boolean;
}

export default function FibLockedCard({
  fib,
  index,
  onDelete,
  onToggleVisibility,
  isDeleting = false,
}: FibLockedCardProps) {
  const palette = FIB_COLOR_PALETTE[fib.colorIndex] ?? FIB_COLOR_PALETTE[0];

  return (
    <div
      data-testid={`fib-locked-card-${fib.lockId ?? fib.id}`}
      data-hidden={fib.hidden ? "true" : "false"}
      className={`flex items-center gap-2 rounded border border-[var(--border)] bg-[var(--bg-0)] px-2 py-1.5 ${
        fib.hidden ? "opacity-45" : ""
      }`}
    >
      {/* Color swatch — matches the chart palette */}
      <span
        aria-hidden="true"
        className="h-3 w-3 shrink-0 rounded-full border border-[var(--border)]"
        style={{ background: palette.goldenPocket }}
        title={`Chart color: ${palette.name}`}
      />

      {/* Label + swing */}
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="font-data text-[10px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
          L{index}
        </span>
        <span className="truncate font-data text-[10px] text-[var(--text-2)]">
          {fib.result.direction.toUpperCase()}{" "}
          ${fib.result.swing_low.toFixed(2)}→${fib.result.swing_high.toFixed(2)}
        </span>
      </div>

      {/* Show/hide toggle — keeps the fib in the list but off the chart */}
      <button
        type="button"
        onClick={() => onToggleVisibility(fib)}
        data-testid={`fib-locked-visibility-${fib.lockId ?? fib.id}`}
        title={fib.hidden ? "Show on chart" : "Hide from chart"}
        aria-label={
          fib.hidden ? `Show locked fib L${index}` : `Hide locked fib L${index}`
        }
        aria-pressed={!fib.hidden}
        className="rounded border border-transparent px-1 py-0.5 font-data text-[11px] leading-none text-[var(--text-3)] transition-colors hover:border-[var(--clr-cyan)] hover:text-[var(--clr-cyan)]"
      >
        {fib.hidden ? "🚫" : "👁"}
      </button>

      {/* Delete button */}
      <button
        type="button"
        onClick={() => onDelete(fib)}
        disabled={isDeleting}
        data-testid={`fib-locked-delete-${fib.lockId ?? fib.id}`}
        title="Remove this locked fib"
        aria-label={`Remove locked fib L${index}`}
        className="rounded border border-transparent px-1 py-0.5 font-data text-[10px] text-[var(--text-3)] transition-colors hover:border-[var(--clr-red)] hover:text-[var(--clr-red)] disabled:opacity-40 disabled:cursor-not-allowed"
      >
        ×
      </button>
    </div>
  );
}
