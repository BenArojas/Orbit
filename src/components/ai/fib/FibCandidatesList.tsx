/**
 * FibCandidatesList — clickable candidate rows in the FibScoreCard.
 *
 * Clicking a row swaps the rendered fib on the chart to that candidate
 * (via setDisplayedFib in the chart store). The currently displayed
 * candidate is highlighted; clicking it again is a no-op (idempotent
 * from the user's perspective).
 *
 * Each row also shows the candidate's status chip (active / played out
 * / broken) — same colors as the Branch 1 chip on FibScoreCard.
 *
 * Branch 3, plan decision 4A.
 */

import type {
  FibonacciCandidate,
  FibonacciCandidateStatus,
} from "@/lib/api";

interface FibCandidatesListProps {
  candidates: FibonacciCandidate[];
  /** The candidate currently rendered on the chart (null = auto primary). */
  activeOverride: FibonacciCandidate | null;
  /** Called when the user clicks a candidate row. */
  onPickCandidate: (candidate: FibonacciCandidate) => void;
}

const STATUS_STYLE: Record<
  FibonacciCandidateStatus,
  { color: string; bg: string; label: string }
> = {
  active: {
    color: "var(--clr-green)",
    bg: "rgba(0,255,136,0.12)",
    label: "active",
  },
  played_out: {
    color: "var(--text-3)",
    bg: "rgba(255,255,255,0.06)",
    label: "played out",
  },
  broken: {
    color: "var(--clr-red)",
    bg: "rgba(255,68,102,0.12)",
    label: "broken",
  },
};

export default function FibCandidatesList({
  candidates,
  activeOverride,
  onPickCandidate,
}: FibCandidatesListProps) {
  if (candidates.length === 0) {
    return null;
  }

  return (
    <div data-testid="fib-candidates-list" className="mt-2 space-y-1">
      {candidates.map((c, i) => {
        const isActive =
          activeOverride !== null
          && activeOverride.swing_high === c.swing_high
          && activeOverride.swing_low === c.swing_low
          && activeOverride.direction === c.direction;

        const statusStyle = STATUS_STYLE[c.status];

        return (
          <button
            type="button"
            key={`${c.direction}-${c.swing_low}-${c.swing_high}-${i}`}
            onClick={() => onPickCandidate(c)}
            data-testid={`fib-candidate-row-${i}`}
            data-status={c.status}
            data-active={isActive ? "true" : "false"}
            aria-pressed={isActive}
            className={`flex w-full items-center gap-2 rounded border px-2 py-1 text-left font-data text-[10px] transition-colors ${
              isActive
                ? "border-[var(--clr-cyan)] bg-[var(--glow-cyan)]"
                : "border-[var(--border)] bg-[var(--bg-0)] hover:border-[var(--clr-cyan)]"
            }`}
          >
            <span className="w-4 text-[var(--text-4)]">#{i + 1}</span>
            <span className="text-[var(--text-2)]">
              {c.score.toFixed(1)}
            </span>
            <span className="flex-1 truncate text-[var(--text-4)]">
              {c.direction} ${c.swing_low.toFixed(2)}→${c.swing_high.toFixed(2)}
            </span>
            <span
              className="rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wider"
              style={{ color: statusStyle.color, background: statusStyle.bg }}
            >
              {statusStyle.label}
            </span>
            {c.is_nested && (
              <span className="text-[var(--clr-purple)]">nested</span>
            )}
            {c.multi_touch_count > 0 && (
              <span className="text-[var(--clr-cyan)]">
                {c.multi_touch_count}T
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
