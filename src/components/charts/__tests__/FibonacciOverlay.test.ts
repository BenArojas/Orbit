/**
 * Tests for FibonacciOverlay styling — Branch 6 (plan decision 2A).
 *
 * The Lightweight Charts library isn't available in jsdom (it does
 * real canvas drawing), so we stub `chart.addSeries` to capture the
 * options passed in and assert on color / line-width / style.
 *
 * Coverage:
 *   - Boundary lines (0 and 1.0) use FIB_BOUNDARY_COLOR (magenta),
 *     lineWidth 2, lineStyle 0 (solid).
 *   - Golden-pocket retracement levels (0.618 / 0.65 / 0.716) use
 *     palette.goldenPocket, lineWidth 2, lineStyle 0.
 *   - Non-GP retracement levels (0.382, 0.5) use palette.retracement,
 *     lineWidth 2, lineStyle 0 (uniform weight with GP).
 *   - Extension levels use palette.extension, lineWidth 1,
 *     lineStyle 2 (dashed).
 *   - Locked fibs render at 0.55× opacity but keep the same style
 *     rules.
 *   - The shared FIB_BOUNDARY_COLOR is bright magenta as specified.
 */

import { describe, it, expect } from "vitest";

import { addFibonacciOverlays } from "../FibonacciOverlay";
import {
  FIB_BOUNDARY_COLOR,
  FIB_COLOR_PALETTE,
  type ActiveFib,
} from "@/store/chart";
import type { FibonacciLevel, FibonacciResult } from "@/lib/api";

// ── Stubs ────────────────────────────────────────────────────

type SeriesOptions = {
  color: string;
  lineWidth: number;
  lineStyle: number;
  title: string;
};

function makeStubChart() {
  const seriesOptions: SeriesOptions[] = [];
  // LineSeries import in the production code is a TYPE TAG — the
  // chart adapter doesn't actually call the constructor, it uses it
  // as a discriminator. We don't care what value it is for the
  // stub; we just capture the options.
  const chart = {
    addSeries: (_seriesType: unknown, opts: SeriesOptions) => {
      seriesOptions.push(opts);
      // The series object the production code uses just needs a
      // `setData(...)` method; the chart never reads anything else.
      return {
        setData: () => {
          /* no-op */
        },
      };
    },
    removeSeries: () => {
      /* no-op */
    },
  };
  return { chart, seriesOptions };
}

function level(
  ratio: number,
  price: number,
  golden_pocket: boolean,
  kind: "retracement" | "extension" = "retracement",
): FibonacciLevel {
  let label: string;
  if (ratio === 0) label = "0";
  else if (ratio === 1) label = "1.0";
  else if (golden_pocket) label = `${ratio} (GP)`;
  else label = String(ratio);
  return { level: ratio, price, label, kind, golden_pocket };
}

function makeResult(): FibonacciResult {
  return {
    tool_mode: "retracement",
    swing_high: 130,
    swing_low: 100,
    swing_high_time: 1_700_000_000,
    swing_low_time: 1_699_900_000,
    direction: "up",
    levels: [
      level(0,     130, false),
      level(0.382, 118.54, false),
      level(0.5,   115, false),
      level(0.618, 111.46, true),
      level(0.65,  110.5, true),
      level(0.716, 108.52, true),
      level(1.0,   100, false),
    ],
    extensions: [
      level(1.272, 138.16, false, "extension"),
      level(1.618, 148.54, false, "extension"),
    ],
    score: 70,
    swing_clarity: 0.8,
    timeframe_clarity: "clean",
    candidates: [],
    convergence_zones: [],
    is_nested: false,
    parent_fib_id: null,
    reasoning: "",
    source: "auto",
    no_active_fib: false,
    no_active_fib_reason: null,
  };
}

function makeActiveFib(
  partial: Partial<ActiveFib> & { source: ActiveFib["source"] },
): ActiveFib {
  return {
    id: partial.id ?? "primary",
    source: partial.source,
    lockId: partial.lockId ?? null,
    colorIndex: partial.colorIndex ?? 0,
    result: partial.result ?? makeResult(),
    hidden: partial.hidden ?? false,
  };
}

const candles = [
  { time: 1_700_000_000 },
  { time: 1_700_010_000 },
  { time: 1_700_020_000 },
];

function byLevelLabel(options: SeriesOptions[], labelPrefix: string): SeriesOptions[] {
  // `title` looks like "0.618 (GP) (P)" / "0 (P)" — match by the
  // bare ratio prefix so we don't have to know the per-fib suffix.
  return options.filter((o) => o.title.startsWith(labelPrefix));
}

// ── Sanity check on the constant ─────────────────────────────

describe("FIB_BOUNDARY_COLOR", () => {
  it("is the bright magenta specified in plan decision 2A", () => {
    expect(FIB_BOUNDARY_COLOR).toBe("rgba(255, 60, 220, 0.85)");
  });
});

// ── Primary fib styling ─────────────────────────────────────

describe("addFibonacciOverlays — primary fib styling", () => {
  it("renders the 0 boundary in magenta, weight 2, solid", () => {
    const { chart, seriesOptions } = makeStubChart();
    addFibonacciOverlays(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      chart as any,
      [makeActiveFib({ source: "auto", id: "primary" })],
      candles,
    );
    const [opts] = byLevelLabel(seriesOptions, "0 (");
    expect(opts.color).toBe(FIB_BOUNDARY_COLOR);
    expect(opts.lineWidth).toBe(2);
    expect(opts.lineStyle).toBe(0);
  });

  it("renders the 1.0 boundary in magenta, weight 2, solid", () => {
    const { chart, seriesOptions } = makeStubChart();
    addFibonacciOverlays(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      chart as any,
      [makeActiveFib({ source: "auto", id: "primary" })],
      candles,
    );
    const [opts] = byLevelLabel(seriesOptions, "1.0 (");
    expect(opts.color).toBe(FIB_BOUNDARY_COLOR);
    expect(opts.lineWidth).toBe(2);
    expect(opts.lineStyle).toBe(0);
  });

  it("renders 0.618 GP in palette.goldenPocket, weight 2, solid", () => {
    const { chart, seriesOptions } = makeStubChart();
    addFibonacciOverlays(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      chart as any,
      [makeActiveFib({ source: "auto", id: "primary" })],
      candles,
    );
    const [opts] = byLevelLabel(seriesOptions, "0.618");
    expect(opts.color).toBe(FIB_COLOR_PALETTE[0].goldenPocket);
    expect(opts.lineWidth).toBe(2);
    expect(opts.lineStyle).toBe(0);
  });

  it("renders 0.5 non-GP retracement with weight 2, solid (matches GP)", () => {
    const { chart, seriesOptions } = makeStubChart();
    addFibonacciOverlays(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      chart as any,
      [makeActiveFib({ source: "auto", id: "primary" })],
      candles,
    );
    const [opts] = byLevelLabel(seriesOptions, "0.5");
    expect(opts.color).toBe(FIB_COLOR_PALETTE[0].retracement);
    expect(opts.lineWidth).toBe(2);
    expect(opts.lineStyle).toBe(0);
  });

  it("renders 0.382 non-GP retracement with weight 2, solid", () => {
    const { chart, seriesOptions } = makeStubChart();
    addFibonacciOverlays(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      chart as any,
      [makeActiveFib({ source: "auto", id: "primary" })],
      candles,
    );
    const [opts] = byLevelLabel(seriesOptions, "0.382");
    expect(opts.color).toBe(FIB_COLOR_PALETTE[0].retracement);
    expect(opts.lineWidth).toBe(2);
    expect(opts.lineStyle).toBe(0);
  });

  it("renders 1.272 extension with palette.extension, weight 2, dashed", () => {
    const { chart, seriesOptions } = makeStubChart();
    addFibonacciOverlays(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      chart as any,
      [makeActiveFib({ source: "auto", id: "primary" })],
      candles,
    );
    const [opts] = byLevelLabel(seriesOptions, "1.272");
    expect(opts.color).toBe(FIB_COLOR_PALETTE[0].extension);
    expect(opts.lineWidth).toBe(2);
    expect(opts.lineStyle).toBe(2);
  });

  it("skips levels that project to a non-positive price (impossible on a price chart)", () => {
    const { chart, seriesOptions } = makeStubChart();
    const result = makeResult();
    // Simulate a deep DOWN extension that lands below $0.
    result.extensions = [
      level(4.618, -150, false, "extension"),
      level(1.272, 138.16, false, "extension"),
    ];
    addFibonacciOverlays(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      chart as any,
      [makeActiveFib({ source: "auto", id: "primary", result })],
      candles,
    );
    expect(byLevelLabel(seriesOptions, "4.618")).toHaveLength(0);
    expect(byLevelLabel(seriesOptions, "1.272")).toHaveLength(1);
  });
});

// ── Locked fib styling: opacity scales but rules unchanged ──

describe("addFibonacciOverlays — locked fib opacity", () => {
  it("dims the locked fib's GP color by ~55% but keeps weight/style", () => {
    const { chart, seriesOptions } = makeStubChart();
    addFibonacciOverlays(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      chart as any,
      [
        makeActiveFib({ source: "auto", id: "primary", colorIndex: 0 }),
        makeActiveFib({
          source: "locked",
          id: "lock-1",
          lockId: 1,
          colorIndex: 1,
        }),
      ],
      candles,
    );
    // L1 GP rows — must use palette[1].goldenPocket scaled down.
    const lockedGp = seriesOptions.filter((o) =>
      o.title.startsWith("0.618") && o.title.includes("(L1)"),
    );
    expect(lockedGp).toHaveLength(1);
    expect(lockedGp[0].lineWidth).toBe(2);
    expect(lockedGp[0].lineStyle).toBe(0);
    // Color should be the palette gold dimmed — extract its alpha.
    const match = /rgba\([^)]+,\s*([\d.]+)\)/.exec(lockedGp[0].color);
    expect(match).not.toBeNull();
    const alpha = parseFloat(match![1]);
    // palette[1].goldenPocket is rgba(64,224,208,0.75) → 0.75 * 0.55 ≈ 0.413
    expect(alpha).toBeGreaterThan(0.3);
    expect(alpha).toBeLessThan(0.55);
  });

  it("keeps boundary lines magenta even on locked fibs", () => {
    const { chart, seriesOptions } = makeStubChart();
    addFibonacciOverlays(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      chart as any,
      [
        makeActiveFib({ source: "auto", id: "primary", colorIndex: 0 }),
        makeActiveFib({
          source: "locked",
          id: "lock-2",
          lockId: 2,
          colorIndex: 2,
        }),
      ],
      candles,
    );
    const lockedBoundaries = seriesOptions.filter(
      (o) =>
        (o.title.startsWith("0 (") || o.title.startsWith("1.0 ("))
        && o.title.includes("(L1)"),
    );
    expect(lockedBoundaries).toHaveLength(2);
    for (const opts of lockedBoundaries) {
      // Magenta with the locked alpha scaling applied.
      // FIB_BOUNDARY_COLOR is rgba(255, 60, 220, 0.85) → ×0.55 ≈ 0.468.
      expect(opts.color).toMatch(/^rgba\(255,\s*60,\s*220,/);
      const m = /rgba\([^)]+,\s*([\d.]+)\)/.exec(opts.color);
      expect(m).not.toBeNull();
      const a = parseFloat(m![1]);
      expect(a).toBeGreaterThan(0.4);
      expect(a).toBeLessThan(0.5);
      expect(opts.lineWidth).toBe(2);
      expect(opts.lineStyle).toBe(0);
    }
  });
});

// ── Label suffixes preserved (Branch 4 carry-over) ──────────

describe("addFibonacciOverlays — label suffixes", () => {
  it("primary uses '(P)' suffix, locked uses '(L1)', '(L2)'", () => {
    const { chart, seriesOptions } = makeStubChart();
    addFibonacciOverlays(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      chart as any,
      [
        makeActiveFib({ source: "auto", id: "primary", colorIndex: 0 }),
        makeActiveFib({
          source: "locked",
          id: "lock-1",
          lockId: 1,
          colorIndex: 1,
        }),
        makeActiveFib({
          source: "locked",
          id: "lock-2",
          lockId: 2,
          colorIndex: 2,
        }),
      ],
      candles,
    );
    const suffixes = seriesOptions
      .map((o) => o.title.match(/\((P|L\d+)\)$/)?.[1])
      .filter(Boolean);
    expect(new Set(suffixes)).toEqual(new Set(["P", "L1", "L2"]));
  });
});
