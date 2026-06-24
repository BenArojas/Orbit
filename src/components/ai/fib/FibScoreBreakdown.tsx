/**
 * FibScoreBreakdown — collapsible "How is this score calculated?" panel.
 *
 * Shows the composite formula with the active weights and the current
 * top candidate's factor values plugged in. Educational — helps the
 * trader see WHY the score is what it is, not just the number.
 *
 * Plan decisions 3A/3B (live numbers from the current top candidate).
 *
 * Branch 3.
 */

import { useState } from "react";

import type { FibFactorName } from "@/modules/parallax/api";
import { FIB_FACTOR_ORDER, FIB_GLOSSARY } from "./glossary";

interface FibScoreBreakdownProps {
  /** The active weight vector (already normalized to sum=1). */
  weights: Record<FibFactorName, number>;
  /** Per-factor candidate values (0..1) in the same units the scorer used. */
  values: Record<FibFactorName, number>;
  /** Resulting composite score (0..100) — shown as the formula's RHS. */
  score: number;
}

export default function FibScoreBreakdown({
  weights,
  values,
  score,
}: FibScoreBreakdownProps) {
  const [open, setOpen] = useState(false);

  return (
    <div
      data-testid="fib-score-breakdown"
      className="mt-2 rounded border border-[var(--border)] bg-[var(--bg-0)]"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-2 py-1 font-data text-[10px] text-[var(--text-3)] transition-colors hover:text-[var(--text-1)]"
      >
        <span>How is this score calculated?</span>
        <span className="text-[var(--text-4)]">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div
          data-testid="fib-score-breakdown-body"
          className="border-t border-[var(--border)] px-2 py-2 font-data text-[10px] leading-relaxed text-[var(--text-3)]"
        >
          <p className="mb-2 text-[var(--text-2)]">
            Composite score is a weighted sum of five factors, then
            multiplied by 100. The active weights are shown beside each
            factor; the values come from the current top candidate.
          </p>

          <div className="space-y-1">
            {FIB_FACTOR_ORDER.map((factor) => {
              const w = weights[factor] ?? 0;
              const v = values[factor] ?? 0;
              const contrib = w * v;
              return (
                <div
                  key={factor}
                  data-testid={`fib-breakdown-term-${factor}`}
                  className="flex items-baseline gap-1"
                >
                  <span className="w-10 text-right text-[var(--text-4)]">
                    {w.toFixed(2)} ×
                  </span>
                  <span className="w-32 truncate text-[var(--text-2)]">
                    {FIB_GLOSSARY[factor].label}({v.toFixed(2)})
                  </span>
                  <span className="text-[var(--text-4)]">
                    = {contrib.toFixed(3)}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="mt-2 flex items-baseline gap-1 border-t border-[var(--border)] pt-1">
            <span className="w-10 text-right text-[var(--text-4)]">
              Σ × 100
            </span>
            <span className="text-[var(--text-1)]">= {score.toFixed(1)}</span>
          </div>

          <p className="mt-2 text-[10px] text-[var(--text-4)]">
            Want to change the weights? Use the inputs in the factor rows
            above. Settings persist; weights are shared across instruments.
          </p>
        </div>
      )}
    </div>
  );
}
