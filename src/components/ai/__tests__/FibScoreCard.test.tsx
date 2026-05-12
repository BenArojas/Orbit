/**
 * Tests for FibScoreCard — Branch 1 of the fibonacci-improvements-plan.
 *
 * Covers:
 *   - no_active_fib=true renders the info card + reason; no score badge.
 *   - Candidates list is still rendered when no_active_fib=true.
 *   - status chip color/label is correct for each FibonacciCandidateStatus.
 *   - Normal-state rendering preserved.
 */

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { createElement } from "react";

import FibScoreCard from "../FibScoreCard";
import type {
  FibonacciResult,
  FibonacciCandidate,
  FibonacciCandidateStatus,
} from "@/lib/api";

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
    score: 60,
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

function makeResult(overrides: Partial<FibonacciResult> = {}): FibonacciResult {
  return {
    tool_mode: "retracement",
    swing_high: 130,
    swing_low: 100,
    swing_high_time: 1_700_000_000,
    swing_low_time: 1_699_900_000,
    direction: "up",
    levels: [],
    extensions: [],
    score: 75,
    swing_clarity: 0.82,
    timeframe_clarity: "clean",
    candidates: [makeCandidate()],
    convergence_zones: [],
    is_nested: false,
    parent_fib_id: null,
    reasoning: "Active fib: up swing from $100.00 → $130.00.",
    source: "auto",
    no_active_fib: false,
    no_active_fib_reason: null,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────

describe("FibScoreCard — no_active_fib state", () => {
  it("renders the no-active info card with reason when no_active_fib=true", () => {
    const result = makeResult({
      no_active_fib: true,
      no_active_fib_reason:
        "No swing has price currently inside its range (±15% tolerance).",
      candidates: [makeCandidate({ status: "played_out" })],
    });

    render(createElement(FibScoreCard, { fibonacci: result }));

    expect(screen.getByTestId("fib-no-active-card")).toBeTruthy();
    expect(screen.getByText(/No active fib/i)).toBeTruthy();
    expect(
      screen.getByText(/No swing has price currently inside its range/),
    ).toBeTruthy();
    // The standard score card should NOT render.
    expect(screen.queryByTestId("fib-score-card")).toBeNull();
  });

  it("still renders the candidates section in no_active_fib state", () => {
    const result = makeResult({
      no_active_fib: true,
      no_active_fib_reason: "No swing alive.",
      candidates: [
        makeCandidate({ status: "played_out", score: 70 }),
        makeCandidate({ status: "broken", score: 55 }),
      ],
    });

    render(createElement(FibScoreCard, { fibonacci: result }));

    // Expand the candidates section.
    const toggle = screen.getByText(/historical candidates/);
    fireEvent.click(toggle);

    expect(screen.getByTestId("fib-candidate-row-0")).toBeTruthy();
    expect(screen.getByTestId("fib-candidate-row-1")).toBeTruthy();
  });

  it("falls back to a default reason text when no_active_fib_reason is null", () => {
    const result = makeResult({
      no_active_fib: true,
      no_active_fib_reason: null,
      candidates: [],
    });

    render(createElement(FibScoreCard, { fibonacci: result }));

    expect(
      screen.getByText(/outside every detected swing's tolerance band/i),
    ).toBeTruthy();
  });
});

describe("FibScoreCard — candidate status chips", () => {
  const cases: Array<{ status: FibonacciCandidateStatus; label: RegExp }> = [
    { status: "active", label: /active/i },
    { status: "played_out", label: /played out/i },
    { status: "broken", label: /broken/i },
  ];

  for (const { status, label } of cases) {
    it(`renders the correct chip label for status=${status}`, () => {
      const result = makeResult({
        candidates: [
          makeCandidate(),                    // primary candidate (active)
          makeCandidate({ status }),          // the one we're asserting on
        ],
      });

      render(createElement(FibScoreCard, { fibonacci: result }));

      // Expand candidates.
      fireEvent.click(screen.getByText(/candidates/));

      const row = screen.getByTestId("fib-candidate-row-1");
      expect(row.getAttribute("data-status")).toBe(status);
      // The chip label should be visible inside the row.
      expect(row.textContent?.toLowerCase()).toMatch(label);
    });
  }
});

describe("FibScoreCard — normal state preserved", () => {
  it("renders the score badge and swing range when no_active_fib=false", () => {
    const result = makeResult({
      no_active_fib: false,
      score: 78,
    });

    render(createElement(FibScoreCard, { fibonacci: result }));

    expect(screen.getByTestId("fib-score-card")).toBeTruthy();
    expect(screen.getByText("78")).toBeTruthy();
    // The price range is split across multiple text nodes — match against
    // the card's combined text content instead of a single node.
    const card = screen.getByTestId("fib-score-card");
    expect(card.textContent).toContain("$100.00");
    expect(card.textContent).toContain("$130.00");
    // No-active card should NOT render.
    expect(screen.queryByTestId("fib-no-active-card")).toBeNull();
  });

  it("returns null when fibonacci is null", () => {
    const { container } = render(
      createElement(FibScoreCard, { fibonacci: null }),
    );
    expect(container.firstChild).toBeNull();
  });
});
