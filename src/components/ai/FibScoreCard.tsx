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
import type { FibonacciResult, FibonacciCandidate } from "@/lib/api";

interface FibScoreCardProps {
  fibonacci: FibonacciResult | null;
}

export default function FibScoreCard({ fibonacci }: FibScoreCardProps) {
  const [showCandidates, setShowCandidates] = useState(false);

  if (!fibonacci) return null;

  const scoreColor =
    fibonacci.score >= 70
      ? "var(--clr-green)"
      : fibonacci.score >= 40
        ? "var(--clr-orange)"
        : "var(--clr-red)";

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-1)] p-3">
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
  return (
    <div className="flex items-center gap-2 rounded border border-[var(--border)] bg-[var(--bg-0)] px-2 py-1 font-data text-[10px]">
      <span className="w-4 text-[var(--text-4)]">#{index + 1}</span>
      <span className="text-[var(--text-2)]">
        {c.score.toFixed(1)}
      </span>
      <span className="text-[var(--text-4)]">
        {c.direction} ${c.swing_low.toFixed(2)}→${c.swing_high.toFixed(2)}
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
