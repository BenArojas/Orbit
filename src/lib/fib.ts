/**
 * Pure-function Fibonacci helpers — frontend-side.
 *
 * `buildLevelsFromCandidate` exists so the "click a candidate to render
 * it on the chart" flow (Branch 3, plan decision 4A) doesn't require a
 * backend round-trip on every candidate click. The math is the same
 * 6-line arithmetic as backend `_build_levels`; the duplication is
 * mitigated by sourcing the ratio arrays from a single endpoint
 * (`GET /fibonacci/config`) rather than hardcoded constants.
 *
 * GOLDEN_POCKET_RATIOS is duplicated from the backend since it controls
 * a visual flag that the backend already attaches to its own levels,
 * and the frontend `useFibConfig` payload doesn't currently include it.
 * If we ever expose GP via the config endpoint we can drop this
 * duplicate.
 */

import type {
  FibonacciCandidate,
  FibonacciLevel,
  FibonacciResult,
} from "./api";

/** Levels that fall inside the "golden pocket" reaction zone. */
export const GOLDEN_POCKET_RATIOS: ReadonlySet<number> = new Set([
  0.618, 0.65, 0.716,
]);

interface BuiltLevels {
  levels: FibonacciLevel[];
  extensions: FibonacciLevel[];
}

/**
 * Compute retracement + extension level prices for an arbitrary swing.
 *
 * Mirrors backend `IndicatorService._build_levels` exactly. The backend
 * is the source of truth for the level math; this is a render-only
 * helper used by the click-to-load-candidate flow so the chart can
 * re-paint instantly without waiting for the server.
 *
 * @param candidate    The candidate swing the user clicked.
 * @param ratios       Retracement ratios — fetched from /fibonacci/config.
 * @param extensionRatios Extension ratios — fetched from /fibonacci/config.
 */
export function buildLevelsFromCandidate(
  candidate: Pick<FibonacciCandidate, "swing_high" | "swing_low" | "direction">,
  ratios: number[],
  extensionRatios: number[],
): BuiltLevels {
  const { swing_high, swing_low, direction } = candidate;
  const priceRange = swing_high - swing_low;

  const levels: FibonacciLevel[] = ratios.map((ratio) =>
    makeLevel(ratio, priceRange, swing_high, swing_low, direction, "retracement"),
  );

  const extensions: FibonacciLevel[] = extensionRatios.map((ratio) =>
    makeLevel(ratio, priceRange, swing_high, swing_low, direction, "extension"),
  );

  return { levels, extensions };
}

/**
 * Synthesize a full `FibonacciResult` from a candidate the user picked
 * in the Candidates panel. Most fields are copied straight from the
 * candidate; placeholder values are used for the result-only fields
 * the backend would normally populate (timeframe_clarity, reasoning,
 * candidates, convergence_zones). The chart overlay only needs the
 * level prices to render correctly.
 */
export function fibonacciResultFromCandidate(
  candidate: FibonacciCandidate,
  ratios: number[],
  extensionRatios: number[],
): FibonacciResult {
  const { levels, extensions } = buildLevelsFromCandidate(
    candidate,
    ratios,
    extensionRatios,
  );

  return {
    tool_mode: "retracement",
    swing_high: candidate.swing_high,
    swing_low: candidate.swing_low,
    swing_high_time: candidate.swing_high_time,
    swing_low_time: candidate.swing_low_time,
    direction: candidate.direction,
    levels,
    extensions,
    score: candidate.score,
    swing_clarity: candidate.swing_clarity,
    timeframe_clarity: "clean",   // candidate-derived result: no margin info
    candidates: [],                // user already picked from the panel — empty list
    convergence_zones: [],
    is_nested: candidate.is_nested,
    parent_fib_id: null,
    reasoning: `User-selected candidate. ${candidate.direction} swing from $${candidate.swing_low.toFixed(2)} → $${candidate.swing_high.toFixed(2)}.`,
    source: "manual",
    no_active_fib: false,
    no_active_fib_reason: null,
  };
}

// ── Internals ────────────────────────────────────────────────

function makeLevel(
  ratio: number,
  priceRange: number,
  swingHigh: number,
  swingLow: number,
  direction: "up" | "down",
  kind: "retracement" | "extension",
): FibonacciLevel {
  let price: number;
  if (kind === "retracement") {
    price =
      direction === "up"
        ? swingHigh - priceRange * ratio
        : swingLow + priceRange * ratio;
  } else {
    price =
      direction === "up"
        ? swingHigh + priceRange * (ratio - 1.0)
        : swingLow - priceRange * (ratio - 1.0);
  }
  const isGp = GOLDEN_POCKET_RATIOS.has(ratio);
  let label: string;
  if (ratio === 0.0) {
    label = "0";
  } else if (ratio === 1.0) {
    label = "1.0";
  } else if (isGp) {
    label = `${ratio} (GP)`;
  } else {
    label = String(ratio);
  }
  return {
    level: ratio,
    price: roundTo(price, 4),
    label,
    kind,
    golden_pocket: isGp,
  };
}

function roundTo(value: number, digits: number): number {
  const f = Math.pow(10, digits);
  return Math.round(value * f) / f;
}
