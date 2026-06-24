/**
 * FibCriterionRow — one row in the FibScoreCard glossary section.
 *
 * Each row shows:
 *   - factor label
 *   - the current candidate's value (as a small horizontal meter)
 *   - the active weight
 *   - a `?` hover tooltip with the longer glossary description
 *   - (when `editable`) an inline number input for the weight
 *
 * Tooltips use the design system's CSS variables and the same pattern
 * as AiConfigPanel's chart-context info tooltip — no Radix dependency
 * to avoid pulling in shadcn dialogs just for a hover string.
 *
 * Branch 3, plan decisions 3A/3B.
 */

import { useState, useEffect } from "react";

import { FIB_GLOSSARY } from "./glossary";
import type { FibFactorName } from "@/modules/parallax/api";

interface FibCriterionRowProps {
  factor: FibFactorName;
  /** Current candidate's factor value, 0..1. */
  value: number;
  /** Active weight for this factor, 0..1. */
  weight: number;
  /** When true, the weight is rendered as an editable input. */
  editable?: boolean;
  /** Called as the user edits the inline weight input. */
  onWeightChange?: (factor: FibFactorName, weight: number) => void;
}

export default function FibCriterionRow({
  factor,
  value,
  weight,
  editable = false,
  onWeightChange,
}: FibCriterionRowProps) {
  const entry = FIB_GLOSSARY[factor];

  // Local input state for the editable weight — sync from prop on
  // outside changes (e.g. "Reset to defaults").
  const [draft, setDraft] = useState<string>(weight.toFixed(2));
  useEffect(() => {
    setDraft(weight.toFixed(2));
  }, [weight]);

  const commitDraft = () => {
    const n = Number.parseFloat(draft);
    if (!Number.isFinite(n)) {
      setDraft(weight.toFixed(2));
      return;
    }
    const clamped = Math.max(0, Math.min(1, n));
    onWeightChange?.(factor, clamped);
    setDraft(clamped.toFixed(2));
  };

  return (
    <div
      data-testid={`fib-criterion-row-${factor}`}
      className="flex items-center gap-2 py-1"
    >
      {/* Label + tooltip */}
      <div className="group relative flex min-w-[100px] items-center gap-1">
        <span className="font-data text-[10px] text-[var(--text-2)]">
          {entry.label}
        </span>
        <span
          aria-label={`${entry.label} explanation`}
          className="flex h-3 w-3 cursor-default items-center justify-center rounded-full border border-[var(--border)] text-[8px] font-bold text-[var(--text-3)] transition-colors group-hover:border-[var(--clr-cyan)] group-hover:text-[var(--clr-cyan)]"
        >
          ?
        </span>
        <div
          role="tooltip"
          data-testid={`fib-criterion-tooltip-${factor}`}
          className="pointer-events-none absolute bottom-full left-0 z-50 mb-1.5 w-64 rounded-md border border-[var(--border)] bg-[var(--bg-1)] px-2.5 py-2 text-[9px] leading-relaxed text-[var(--text-2)] opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100"
        >
          <p className="mb-1 font-semibold text-[var(--text-1)]">
            {entry.label}
          </p>
          <p>{entry.tooltip}</p>
          {entry.hint && (
            <p className="mt-1 text-[var(--text-3)]">{entry.hint}</p>
          )}
        </div>
      </div>

      {/* Value meter — small horizontal bar */}
      <div
        className="h-1.5 flex-1 overflow-hidden rounded-sm bg-[var(--bg-0)]"
        title={`Value: ${(value * 100).toFixed(0)}%`}
      >
        <div
          className="h-full bg-[var(--clr-cyan)] transition-[width] duration-200"
          style={{ width: `${Math.min(100, Math.max(0, value * 100)).toFixed(1)}%` }}
        />
      </div>

      {/* Weight: editable input or static text */}
      {editable ? (
        <input
          type="number"
          min={0}
          max={1}
          step={0.05}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitDraft();
          }}
          data-testid={`fib-weight-input-${factor}`}
          aria-label={`Weight for ${entry.label}`}
          className="w-12 rounded border border-[var(--border)] bg-[var(--bg-0)] px-1 py-0.5 text-right font-data text-[10px] text-[var(--text-1)] focus:border-[var(--clr-cyan)] focus:outline-none"
        />
      ) : (
        <span
          className="w-12 text-right font-data text-[10px] text-[var(--text-3)]"
          data-testid={`fib-weight-${factor}`}
        >
          ×{weight.toFixed(2)}
        </span>
      )}
    </div>
  );
}
