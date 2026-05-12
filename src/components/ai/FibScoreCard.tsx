/**
 * FibScoreCard — Fibonacci confidence panel in the AI sidebar.
 *
 * Branch 3 overhaul:
 *   - Per-factor glossary rows with `?` tooltips + editable weights
 *   - "How is this score calculated?" formula breakdown with live numbers
 *   - Clickable Candidates list — picking one renders it on the chart
 *   - "Clear chart fib" button removes the displayed fib without
 *     untoggling the indicator or hiding this panel
 *
 * Plan reference: docs/fibonacci-improvements-plan.md (decisions 3 + 4).
 *
 * Branch 1 behavior (no_active_fib info card + status chip) is preserved.
 */

import { useState } from "react";

import type {
  FibFactorName,
  FibonacciCandidate,
  FibonacciResult,
} from "@/lib/api";
import { useChartStore } from "@/store/chart";
import { useFibConfig } from "@/hooks/useFibConfig";

import FibCriterionRow from "./fib/FibCriterionRow";
import FibScoreBreakdown from "./fib/FibScoreBreakdown";
import FibCandidatesList from "./fib/FibCandidatesList";
import {
  FIB_FACTOR_ORDER,
  candidateFactorValues,
} from "./fib/glossary";

interface FibScoreCardProps {
  fibonacci: FibonacciResult | null;
}

export default function FibScoreCard({ fibonacci }: FibScoreCardProps) {
  const setDisplayedFib = useChartStore((s) => s.setDisplayedFib);
  const displayedFibOverride = useChartStore((s) => s.displayedFibOverride);
  const fibCleared = useChartStore((s) => s.fibCleared);
  const clearChartFib = useChartStore((s) => s.clearChartFib);

  const {
    config: fibConfig,
    updateConfig,
    isUpdating,
    updateError,
  } = useFibConfig();

  // Local editor state — copy weights from server config into a
  // mutable buffer the user edits. "Save" pushes to backend; "Reset"
  // restores from config.
  const [editing, setEditing] = useState(false);
  const [draftWeights, setDraftWeights] = useState<
    Record<FibFactorName, number> | null
  >(null);

  const beginEdit = () => {
    if (!fibConfig) return;
    setDraftWeights({ ...fibConfig.weights });
    setEditing(true);
  };

  const cancelEdit = () => {
    setDraftWeights(null);
    setEditing(false);
  };

  const handleWeightChange = (factor: FibFactorName, weight: number) => {
    setDraftWeights((prev) => (prev ? { ...prev, [factor]: weight } : prev));
  };

  const saveWeights = () => {
    if (!draftWeights) return;
    updateConfig({ weights: draftWeights });
    // The mutation's onSuccess will refresh the cached config; we
    // exit editing mode optimistically. If the server rejects (e.g.
    // sum-out-of-tolerance), `updateError` surfaces below.
    setEditing(false);
    setDraftWeights(null);
  };

  if (!fibonacci) return null;

  // ── No-active-fib state (Branch 1 carry-over) ─────────────

  if (fibonacci.no_active_fib) {
    return (
      <NoActiveFibCard
        fibonacci={fibonacci}
        onPickCandidate={setDisplayedFib}
        activeOverride={displayedFibOverride}
      />
    );
  }

  // ── Normal state ──────────────────────────────────────────

  const scoreColor =
    fibonacci.score >= 70
      ? "var(--clr-green)"
      : fibonacci.score >= 40
        ? "var(--clr-orange)"
        : "var(--clr-red)";

  // What gets shown in the glossary / breakdown is always the
  // currently RENDERED candidate — auto primary if no override,
  // else the override.
  const focusCandidate: Pick<
    FibonacciCandidate,
    "swing_clarity"
    | "multi_touch_count"
    | "rejection_intensity"
    | "stretched_penalty"
    | "recency"
  > = displayedFibOverride ?? deriveFocusFromResult(fibonacci);

  const values = candidateFactorValues(focusCandidate);

  const renderedWeights = draftWeights ?? fibConfig?.weights;
  const showFibIsLive = !fibCleared;

  return (
    <div
      data-testid="fib-score-card"
      className="rounded-lg border border-[var(--border)] bg-[var(--bg-1)] p-3"
    >
      {/* Header row: score badge + swing info + Clear button */}
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
          {displayedFibOverride && (
            <span
              data-testid="fib-source-override-pill"
              className="rounded bg-[rgba(0,212,255,0.15)] px-1.5 py-0.5 font-data text-[9px] uppercase tracking-wider text-[var(--clr-cyan)]"
              title="A candidate from the list is being rendered instead of the auto-detected primary"
            >
              override
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
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

          {/* Clear chart fib (decision 4B) */}
          {showFibIsLive && (
            <button
              type="button"
              onClick={clearChartFib}
              data-testid="fib-clear-chart-button"
              title="Remove the fib drawing from the chart (keeps panel + indicator on)"
              className="rounded border border-[var(--border)] px-1.5 py-0.5 font-data text-[9px] uppercase tracking-wider text-[var(--text-3)] transition-colors hover:border-[var(--clr-red)] hover:text-[var(--clr-red)]"
            >
              Clear
            </button>
          )}
        </div>
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

      {/* ── Factors + weight editor ── */}
      {renderedWeights && (
        <div className="mt-3 rounded border border-[var(--border)] bg-[var(--bg-0)] p-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-data text-[10px] uppercase tracking-wider text-[var(--text-3)]">
              Score factors
            </span>
            {!editing ? (
              <button
                type="button"
                onClick={beginEdit}
                data-testid="fib-edit-weights-button"
                className="font-data text-[10px] text-[var(--clr-cyan)] underline decoration-dotted hover:text-[var(--text-1)]"
              >
                Edit weights
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="font-data text-[10px] text-[var(--text-3)] hover:text-[var(--text-1)]"
                  disabled={isUpdating}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveWeights}
                  data-testid="fib-save-weights-button"
                  className="rounded border border-[var(--clr-cyan)] bg-[var(--glow-cyan)] px-2 py-0.5 font-data text-[10px] text-[var(--clr-cyan)] transition-all hover:shadow-[0_0_8px_var(--glow-cyan)] disabled:opacity-40"
                  disabled={isUpdating}
                >
                  {isUpdating ? "Saving…" : "Save"}
                </button>
              </div>
            )}
          </div>

          {FIB_FACTOR_ORDER.map((factor) => (
            <FibCriterionRow
              key={factor}
              factor={factor}
              value={values[factor]}
              weight={renderedWeights[factor] ?? 0}
              editable={editing}
              onWeightChange={handleWeightChange}
            />
          ))}

          {updateError && (
            <p
              data-testid="fib-weight-update-error"
              className="mt-1 text-[10px] text-[var(--clr-red)]"
            >
              {updateError.message}
            </p>
          )}
        </div>
      )}

      {/* Score breakdown — collapsible, shows live numbers */}
      {renderedWeights && (
        <FibScoreBreakdown
          weights={renderedWeights}
          values={values}
          score={fibonacci.score}
        />
      )}

      {/* Candidates list */}
      {fibonacci.candidates.length > 0 && (
        <CandidatesSection
          candidates={fibonacci.candidates}
          activeOverride={displayedFibOverride}
          onPickCandidate={setDisplayedFib}
        />
      )}
    </div>
  );
}

// ── No-active-fib state ─────────────────────────────────────

function NoActiveFibCard({
  fibonacci,
  onPickCandidate,
  activeOverride,
}: {
  fibonacci: FibonacciResult;
  onPickCandidate: (c: FibonacciCandidate) => void;
  activeOverride: FibonacciCandidate | null;
}) {
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
        <CandidatesSection
          candidates={fibonacci.candidates}
          activeOverride={activeOverride}
          onPickCandidate={onPickCandidate}
          label="historical candidates"
        />
      )}
    </div>
  );
}

// ── Candidates section (toggleable) ─────────────────────────

function CandidatesSection({
  candidates,
  activeOverride,
  onPickCandidate,
  label = "candidates",
}: {
  candidates: FibonacciCandidate[];
  activeOverride: FibonacciCandidate | null;
  onPickCandidate: (c: FibonacciCandidate) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid="fib-candidates-toggle"
        className="mt-2 font-data text-[10px] text-[var(--text-4)] underline decoration-dotted transition-colors hover:text-[var(--text-2)]"
      >
        {open ? "Hide candidates" : `${candidates.length} ${label} ▸`}
      </button>
      {open && (
        <FibCandidatesList
          candidates={candidates}
          activeOverride={activeOverride}
          onPickCandidate={onPickCandidate}
        />
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────

/**
 * Derive the "focus candidate" factor values from a FibonacciResult
 * when no candidate is explicitly clicked. The auto result already
 * carries `swing_clarity`; we surface the top candidate's other
 * factors so the glossary rows and breakdown have something to plot.
 */
function deriveFocusFromResult(
  fib: FibonacciResult,
): {
  swing_clarity: number;
  multi_touch_count: number;
  rejection_intensity: number;
  stretched_penalty: number;
  recency: number;
} {
  const top = fib.candidates[0];
  if (top) {
    return {
      swing_clarity: top.swing_clarity,
      multi_touch_count: top.multi_touch_count,
      rejection_intensity: top.rejection_intensity,
      stretched_penalty: top.stretched_penalty,
      recency: top.recency,
    };
  }
  return {
    swing_clarity: fib.swing_clarity,
    multi_touch_count: 0,
    rejection_intensity: 0,
    stretched_penalty: 0,
    recency: 0,
  };
}
