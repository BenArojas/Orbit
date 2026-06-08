/**
 * Glossary for the five Fibonacci scoring factors.
 *
 * Single source of truth for: display label, tooltip text, and the
 * ordering used in the FibScoreCard. The factor *names* (the keys) must
 * match the backend's DEFAULT_FIB_WEIGHTS keys exactly — the PUT
 * /fibonacci/config endpoint validates against that canonical set.
 *
 * Branch 3, plan decisions 3A/3B.
 */

import type { FibFactorName } from "@/modules/parallax/api";

export interface FibGlossaryEntry {
  /** Short human-readable label rendered in the FibScoreCard rows. */
  label: string;
  /** Longer description shown in the `?` tooltip. */
  tooltip: string;
  /** Optional one-line "what high/low looks like" hint. */
  hint?: string;
}

export const FIB_GLOSSARY: Record<FibFactorName, FibGlossaryEntry> = {
  swing_clarity: {
    label: "Swing clarity",
    tooltip:
      "How clean the V-shape of the swing is. Measured as the swing's "
      + "price range divided by the average bar range AFTER the swing "
      + "completed. A clarity of 1.0 means the swing was at least 15× "
      + "the size of normal bar noise — a textbook clean move. Lower "
      + "values indicate the swing barely stood out from routine chop.",
    hint: "Higher = cleaner V-shape. Lower = chop.",
  },
  multi_touch: {
    label: "Multi-touch",
    tooltip:
      "Count of distinct times price returned into the golden pocket "
      + "(0.618–0.716) after the swing completed. Three or more touches "
      + "max out this factor's contribution. Repeated touches without "
      + "a break confirm the level is actively respected.",
    hint: "3+ touches = max. 0 touches = no contribution.",
  },
  rejection_intensity: {
    label: "Rejection intensity",
    tooltip:
      "Strongest bounce off the golden pocket measured as the max "
      + "reversal over the 3 bars immediately following each touch. "
      + "Higher values mean price snapped away from the level instead "
      + "of grinding through it. Capped at 1.0.",
    hint: "Big reversal = high. Slow drift = low.",
  },
  stretched_penalty: {
    label: "Stretched penalty",
    tooltip:
      "How CLOSE the current price is to the golden pocket relative "
      + "to the swing range — confusingly named because the math is "
      + "inverted: 1.0 means we're right at the GP, 0 means we're a "
      + "full swing-range away. Penalizes swings where the entry zone "
      + "is too far from current price to be actionable.",
    hint: "1.0 = price at GP. 0 = price far away.",
  },
  recency: {
    label: "Recency",
    tooltip:
      "Position of the swing's later pivot in the candle history, "
      + "normalized to 0–1. The most recent swing scores 1.0; the oldest "
      + "scores near 0. Used as a tiebreaker — newer swings reflect the "
      + "current market structure better than older ones.",
    hint: "Newer swing = higher score.",
  },
};

/**
 * Canonical display order. Mirrors backend `_score_swing`'s composite
 * formula left-to-right so the breakdown reads naturally.
 */
export const FIB_FACTOR_ORDER: FibFactorName[] = [
  "swing_clarity",
  "multi_touch",
  "rejection_intensity",
  "stretched_penalty",
  "recency",
];

/**
 * Map a candidate's raw factor values to the display order. Each value
 * is in [0, 1] — used in the breakdown formula and the per-row meters.
 */
export function candidateFactorValues(c: {
  swing_clarity: number;
  multi_touch_count: number;
  rejection_intensity: number;
  stretched_penalty: number;
  recency: number;
}): Record<FibFactorName, number> {
  return {
    // The backend caps multi_touch contribution at 3 touches → 1.0.
    // We replicate that here so the rendered breakdown matches what
    // actually fed into the composite score.
    swing_clarity: c.swing_clarity,
    multi_touch: Math.min(1.0, c.multi_touch_count / 3.0),
    rejection_intensity: c.rejection_intensity,
    stretched_penalty: c.stretched_penalty,
    recency: c.recency,
  };
}
