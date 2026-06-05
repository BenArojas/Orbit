/**
 * Tests for src/lib/fib.ts — Branch 3, plan decision 4A.
 *
 * The frontend duplicates the backend's level math so the
 * "click-a-candidate" flow doesn't need a round-trip. These tests
 * assert numerical equivalence: for a given (swing_low, swing_high,
 * direction) the frontend must produce the same level prices the
 * backend would have.
 */

import { describe, it, expect } from "vitest";

import {
  buildLevelsFromCandidate,
  fibonacciResultFromCandidate,
  GOLDEN_POCKET_RATIOS,
} from "../fib";
import type { FibonacciCandidate } from "../api";

// ── Canonical ratio sets (mirror backend defaults) ──────────

const RATIOS = [0.0, 0.382, 0.5, 0.618, 0.65, 0.716, 1.0];
const EXT_RATIOS = [1.272, 1.414, 1.5, 1.618, 1.786, 2.0, 2.618, 3.0, 3.618, 4.0, 4.618];

// ── Helpers ──────────────────────────────────────────────────

function makeCandidate(
  overrides: Partial<FibonacciCandidate> = {},
): FibonacciCandidate {
  return {
    swing_high: 130,
    swing_low: 100,
    swing_high_time: 1_700_000_000,
    swing_low_time: 1_699_900_000,
    direction: "up",
    score: 70,
    swing_clarity: 0.8,
    multi_touch_count: 0,
    rejection_intensity: 0.3,
    stretched_penalty: 0.5,
    recency: 0.9,
    is_nested: false,
    parent_index: null,
    status: "active",
    ...overrides,
  };
}

// ── buildLevelsFromCandidate ────────────────────────────────

describe("buildLevelsFromCandidate", () => {
  it("computes correct retracement prices for an UP swing", () => {
    // Up swing 100 → 130, range 30.
    // Retracement levels: 0 → 130, 0.382 → 118.54, 0.5 → 115, 0.618 → 111.46,
    // 0.65 → 110.5, 0.716 → 108.52, 1.0 → 100.
    const { levels } = buildLevelsFromCandidate(
      makeCandidate({ direction: "up", swing_low: 100, swing_high: 130 }),
      RATIOS,
      EXT_RATIOS,
    );

    const byRatio = Object.fromEntries(levels.map((l) => [l.level, l.price]));
    expect(byRatio[0.0]).toBeCloseTo(130, 4);
    expect(byRatio[0.382]).toBeCloseTo(118.54, 4);
    expect(byRatio[0.5]).toBeCloseTo(115, 4);
    expect(byRatio[0.618]).toBeCloseTo(111.46, 4);
    expect(byRatio[0.65]).toBeCloseTo(110.5, 4);
    expect(byRatio[0.716]).toBeCloseTo(108.52, 4);
    expect(byRatio[1.0]).toBeCloseTo(100, 4);
  });

  it("computes correct retracement prices for a DOWN swing", () => {
    // Down swing high=130, low=100. For "down" direction the
    // retracement formula is swing_low + range * ratio.
    // 0 → 100, 0.382 → 111.46, 0.5 → 115, 0.618 → 118.54, 1.0 → 130.
    const { levels } = buildLevelsFromCandidate(
      makeCandidate({ direction: "down", swing_low: 100, swing_high: 130 }),
      RATIOS,
      EXT_RATIOS,
    );

    const byRatio = Object.fromEntries(levels.map((l) => [l.level, l.price]));
    expect(byRatio[0.0]).toBeCloseTo(100, 4);
    expect(byRatio[0.5]).toBeCloseTo(115, 4);
    expect(byRatio[1.0]).toBeCloseTo(130, 4);
  });

  it("computes correct extension prices for an UP swing (above swing_high)", () => {
    const { extensions } = buildLevelsFromCandidate(
      makeCandidate({ direction: "up", swing_low: 100, swing_high: 130 }),
      RATIOS,
      EXT_RATIOS,
    );

    // For up direction: price = swing_high + range * (ratio - 1.0)
    // ratio 1.272 → 130 + 30 * 0.272 = 138.16
    // ratio 1.618 → 130 + 30 * 0.618 = 148.54
    // ratio 2.0   → 130 + 30 * 1.0   = 160
    const byRatio = Object.fromEntries(extensions.map((l) => [l.level, l.price]));
    expect(byRatio[1.272]).toBeCloseTo(138.16, 4);
    expect(byRatio[1.618]).toBeCloseTo(148.54, 4);
    expect(byRatio[2.0]).toBeCloseTo(160, 4);

    // Every extension must sit above swing_high in an up swing.
    for (const ext of extensions) {
      expect(ext.price).toBeGreaterThanOrEqual(130 - 1e-6);
    }
  });

  it("computes correct extension prices for a DOWN swing (below swing_low)", () => {
    const { extensions } = buildLevelsFromCandidate(
      makeCandidate({ direction: "down", swing_low: 100, swing_high: 130 }),
      RATIOS,
      EXT_RATIOS,
    );

    // For down direction: price = swing_low - range * (ratio - 1.0)
    // ratio 1.272 → 100 - 30 * 0.272 = 91.84
    // ratio 2.0   → 100 - 30 * 1.0   = 70
    const byRatio = Object.fromEntries(extensions.map((l) => [l.level, l.price]));
    expect(byRatio[1.272]).toBeCloseTo(91.84, 4);
    expect(byRatio[2.0]).toBeCloseTo(70, 4);

    // Every extension must sit below swing_low in a down swing.
    for (const ext of extensions) {
      expect(ext.price).toBeLessThanOrEqual(100 + 1e-6);
    }
  });

  it("flags golden-pocket ratios with golden_pocket=true", () => {
    const { levels } = buildLevelsFromCandidate(
      makeCandidate(),
      RATIOS,
      EXT_RATIOS,
    );
    for (const lvl of levels) {
      const expected = GOLDEN_POCKET_RATIOS.has(lvl.level);
      expect(lvl.golden_pocket).toBe(expected);
    }
  });

  it("labels GP levels with '(GP)' suffix", () => {
    const { levels } = buildLevelsFromCandidate(
      makeCandidate(),
      RATIOS,
      EXT_RATIOS,
    );
    const gpLevels = levels.filter((l) => l.golden_pocket);
    for (const lvl of gpLevels) {
      expect(lvl.label).toMatch(/\(GP\)/);
    }
  });
});

// ── fibonacciResultFromCandidate ────────────────────────────

describe("fibonacciResultFromCandidate", () => {
  it("produces a FibonacciResult with source='manual' and no_active_fib=false", () => {
    const c = makeCandidate();
    const result = fibonacciResultFromCandidate(c, RATIOS, EXT_RATIOS);
    expect(result.source).toBe("manual");
    expect(result.no_active_fib).toBe(false);
    expect(result.swing_high).toBe(c.swing_high);
    expect(result.swing_low).toBe(c.swing_low);
    expect(result.direction).toBe(c.direction);
    expect(result.levels.length).toBe(RATIOS.length);
    expect(result.extensions.length).toBe(EXT_RATIOS.length);
  });

  it("defaults to an empty candidates list when none provided", () => {
    const result = fibonacciResultFromCandidate(makeCandidate(), RATIOS, EXT_RATIOS);
    expect(result.candidates).toEqual([]);
  });

  it("carries the supplied originalCandidates list through (Bug-2 fix)", () => {
    // Caller — useChartData — passes the AUTO fib's candidates so the
    // Candidates panel stays visible after the user picks one.
    const auto = [
      makeCandidate({ score: 88 }),
      makeCandidate({ score: 72, swing_low: 105 }),
      makeCandidate({ score: 51, swing_low: 110 }),
    ];
    const result = fibonacciResultFromCandidate(
      auto[1],
      RATIOS,
      EXT_RATIOS,
      auto,
    );
    expect(result.candidates).toBe(auto);
    expect(result.candidates).toHaveLength(3);
  });

  it("propagates the candidate's score and clarity", () => {
    const c = makeCandidate({ score: 42, swing_clarity: 0.31 });
    const result = fibonacciResultFromCandidate(c, RATIOS, EXT_RATIOS);
    expect(result.score).toBe(42);
    expect(result.swing_clarity).toBe(0.31);
  });
});
