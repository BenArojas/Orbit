/**
 * FibScoreCard — Displays the Fibonacci confidence score, swing details,
 * and candidate breakdown in the AI panel sidebar.
 *
 * This is a read-only display of the auto-detected fib result. It sits
 * in the AI panel (right sidebar) and gives the trader:
 *   - Score badge (0-100) with color coding
 *   - Swing high/low + direction
 *   - Timeframe clarity flag
 *   - Reasoning text (same text the LLM sees)
 *   - Expandable candidates list
 *
 * Ofek's spec: "AI panel only. The fib confidence score, reasoning, and
 * candidate swings are displayed in the AI analysis panel. No score
 * badges on the chart itself — keep the chart clean."
 */

import { useState } from "react";
import type {
  FibonacciResult,
  FibonacciCandidate,
  FibonacciCandidateStatus,
} from "@/lib/api";

interface FibScoreCardProps {
  fibonacci: FibonacciResult | null;
}

// ── Status chip styling — Branch 1 ──────────────────────────
//
// active     → green (this candidate could be the primary)
// played_out → gray  (price has reached its target; historical only)
// broken     → red   (swing was invalidated)
//
// Color tokens reference the existing CSS variables so the chips
// blend with the rest of the panel theme.
const STATUS_STYLE: Record<FibonacciCandidateStatus, { color: string; bg: string; label: string }> = {
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

export default function FibScoreCard({ fibonacci }: FibScoreCardProps) {
  const [showCandidates, setShowCandidates] = useState(false);

  if (!fibonacci) return null;

  // ── No-active-fib state (plan decision 1B) ────────────────
  //
  // Backend signals there is no entry-quality fib on this timeframe.
  // Render an info card explaining why, skip the score badge / swing
  // line (those values are placeholders from a historical swing), but
  // STILL render the Candidates section so the user can study
  // historical swings.
  if (fibonacci.no_active_fib) {
    return (
      <div
        data-testid="fib-no-active-card"
        className="rounded-lg border border-[var(--clr-amber,#ff9f1c)] bg-[var(--bg-1)] p-3"
      >
        <div className="flex items-center gap-2">
          <span
            className="rounded px-2 py-0.5 font-data text-[10px] font-semibold uppercase tracking-wider"
            style={{
              color: "var(--clr-amber,#ff9f1c)",
              background: "rgba(255,159,28,0.12)",
            }}
          >
            No active fib
          </span>
          <span className="font-data text-[11px] text-[var(--text-3)]">
            on this timeframe
          </span>
        </div>

        <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-3)]">
          {fibonacci.no_active_fib_reason ||
            "Current price is outside every detected swing's tolerance band."}
          {" "}
          Pick a historical swing below to study, or switch timeframes.
        </p>

        {fibonacci.candidates.length > 0 && (
          <>
            <button
              onClick={() => setShowCandidates((v) => !v)}
              className="mt-2 font-data text-[10px] text-[var(--text-4)] underline decoration-dotted transition-colors hover:text-[var(--text-2)]"
            >
              {showCandidates
                ? "Hide candidates"
                : `${fibonacci.candidates.length} historical candidates ▸`}
            </button>
            {showCandidates && (
              <div className="mt-2 space-y-1">
                {fibonacci.candidates.map((c, i) => (
                  <CandidateRow key={i} candidate={c} index={i} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  // ── Normal state ──────────────────────────────────────────

  const scoreColor =
    fibonacci.score >= 70
      ? "var(--clr-green)"
      : fibonacci.score >= 40
        ? "var(--clr-orange)"
        : "var(--clr-red)";

  return (
    <div
      data-testid="fib-score-card"
      className="rounded-lg border border-[var(--border)] bg-[var(--bg-1)] p-3"
    >
      {/* Header row: score badge + swing info */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className="rounded px-2 py-0.5 font-data text-xs font-bold"
            style={{
              color: scoreColor,
              background: `color-mix(in srgb, ${scoreColor} 15%, transparent)`,
            }}
          >
            {fibonacci.score.toFixed(0)}
          </span>
          <span className="font-data text-xs text-[var(--text-2)]">
            Fib {fibonacci.direction.toUpperCase()}
          </span>
        </div>

        {/* Clarity badge */}
        <span
          className="rounded px-1.5 py-0.5 font-data text-[10px]"
          style={{
            color:
              fibonacci.timeframe_clarity === "clean"
                ? "var(--clr-green)"
                : "var(--clr-orange)",
            background:
              fibonacci.timeframe_clarity === "clean"
                ? "rgba(0,255,136,0.1)"
                : "rgba(255,159,28,0.1)",
          }}
        >
          {fibonacci.timeframe_clarity}
        </span>
      </div>

      {/* Swing range */}
      <div className="mt-2 font-data text-[11px] text-[var(--text-3)]">
        ${fibonacci.swing_low.toFixed(2)} → ${fibonacci.swing_high.toFixed(2)}
        <span className="ml-2 text-[var(--text-4)]">
          clarity {(fibonacci.swing_clarity * 100).toFixed(0)}%
        </span>
        {fibonacci.is_nested && (
          <span className="ml-2 rounded bg-[rgba(136,68,255,0.15)] px-1 text-[10px] text-[var(--clr-purple)]">
            nested
          </span>
        )}
      </div>

      {/* Reasoning */}
      {fibonacci.reasoning && (
        <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-3)]">
          {fibonacci.reasoning}
        </p>
      )}

      {/* Candidates toggle */}
      {fibonacci.candidates.length > 1 && (
        <button
          onClick={() => setShowCandidates((v) => !v)}
          className="mt-2 font-data text-[10px] text-[var(--text-4)] underline decoration-dotted transition-colors hover:text-[var(--text-2)]"
        >
          {showCandidates
            ? "Hide candidates"
            : `${fibonacci.candidates.length} candidates ▸`}
        </button>
      )}

      {/* Candidates list */}
      {showCandidates && (
        <div className="mt-2 space-y-1">
          {fibonacci.candidates.map((c, i) => (
            <CandidateRow key={i} candidate={c} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Candidate row ────────────────────────────────────────────

function CandidateRow({
  candidate: c,
  index,
}: {
  candidate: FibonacciCandidate;
  index: number;
}) {
  const statusStyle = STATUS_STYLE[c.status];
  return (
    <div
      data-testid={`fib-candidate-row-${index}`}
      data-status={c.status}
      className="flex items-center gap-2 rounded border border-[var(--border)] bg-[var(--bg-0)] px-2 py-1 font-data text-[10px]"
    >
      <span className="w-4 text-[var(--text-4)]">#{index + 1}</span>
      <span className="text-[var(--text-2)]">
        {c.score.toFixed(1)}
      </span>
      <span className="text-[var(--text-4)]">
        {c.direction} ${c.swing_low.toFixed(2)}→${c.swing_high.toFixed(2)}
      </span>
      <span
        className="rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wider"
        style={{ color: statusStyle.color, background: statusStyle.bg }}
        title={`Swing status: ${statusStyle.label}`}
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
    </div>
  );
}
