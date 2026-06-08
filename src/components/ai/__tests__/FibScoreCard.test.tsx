/**
 * Tests for FibScoreCard.
 *
 * Branch 1 coverage (preserved):
 *   - no_active_fib=true renders the info card + reason; no score badge.
 *   - Candidates list is still rendered when no_active_fib=true.
 *   - status chip color/label is correct for each FibonacciCandidateStatus.
 *   - Normal-state rendering preserved.
 *
 * Branch 3 coverage (new):
 *   - Score factors section renders one row per canonical factor.
 *   - "Edit weights" toggles the inline number inputs.
 *   - Saving calls api.updateFibConfig with the edited weights.
 *   - Clicking a candidate row calls setDisplayedFib on the chart store.
 *   - "Clear chart fib" calls clearChartFib on the chart store.
 *   - FibScoreBreakdown expands to show the formula with live numbers.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, act } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import FibScoreCard from "../FibScoreCard";
import { useChartStore } from "@/store/chart";
import type {
  FibonacciResult,
  FibonacciCandidate,
  FibonacciCandidateStatus,
} from "@/modules/parallax/api";

// ── Mock the API layer ───────────────────────────────────────

const DEFAULT_WEIGHTS = {
  swing_clarity: 0.25,
  multi_touch: 0.25,
  rejection_intensity: 0.20,
  stretched_penalty: 0.15,
  recency: 0.15,
};

const mockGetFibConfig: ReturnType<typeof vi.fn> = vi.fn();
const mockUpdateFibConfig: ReturnType<typeof vi.fn> = vi.fn();

vi.mock("@/modules/parallax/api", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/modules/parallax/api")>();
  return {
    ...mod,
    parallaxApi: {
      ...mod.parallaxApi,
      getFibConfig: () => mockGetFibConfig(),
      updateFibConfig: (req: { weights: Record<string, number> }) =>
        mockUpdateFibConfig(req),
    },
  };
});

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

function withQueryClient(children: ReactNode): ReactNode {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: getFibConfig resolves with defaults; updateFibConfig
  // echoes the request back.
  mockGetFibConfig.mockResolvedValue({
    ratios: [0, 0.382, 0.5, 0.618, 0.65, 0.716, 1.0],
    extension_ratios: [1.272, 1.618, 2.0],
    weights: DEFAULT_WEIGHTS,
  });
  mockUpdateFibConfig.mockImplementation(async (req) => ({
    ratios: [0, 0.382, 0.5, 0.618, 0.65, 0.716, 1.0],
    extension_ratios: [1.272, 1.618, 2.0],
    weights: req.weights as typeof DEFAULT_WEIGHTS,
  }));
  // Reset chart store between tests.
  useChartStore.getState().clearChart();
});

// ── Branch 1: no_active_fib state ────────────────────────────

describe("FibScoreCard — no_active_fib state", () => {
  it("renders the no-active info card with reason when no_active_fib=true", () => {
    const result = makeResult({
      no_active_fib: true,
      no_active_fib_reason:
        "No swing has price currently inside its range (±15% tolerance).",
      candidates: [makeCandidate({ status: "played_out" })],
    });

    render(withQueryClient(createElement(FibScoreCard, { fibonacci: result })));

    expect(screen.getByTestId("fib-no-active-card")).toBeTruthy();
    expect(screen.getByText(/No active fib/i)).toBeTruthy();
    expect(
      screen.getByText(/No swing has price currently inside its range/),
    ).toBeTruthy();
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

    render(withQueryClient(createElement(FibScoreCard, { fibonacci: result })));

    fireEvent.click(screen.getByTestId("fib-candidates-toggle"));

    expect(screen.getByTestId("fib-candidate-row-0")).toBeTruthy();
    expect(screen.getByTestId("fib-candidate-row-1")).toBeTruthy();
  });

  it("falls back to a default reason text when no_active_fib_reason is null", () => {
    const result = makeResult({
      no_active_fib: true,
      no_active_fib_reason: null,
      candidates: [],
    });

    render(withQueryClient(createElement(FibScoreCard, { fibonacci: result })));

    expect(
      screen.getByText(/outside every detected swing's tolerance band/i),
    ).toBeTruthy();
  });
});

// ── Branch 1: candidate status chips ─────────────────────────

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
          makeCandidate(),
          makeCandidate({ status }),
        ],
      });

      render(withQueryClient(createElement(FibScoreCard, { fibonacci: result })));

      fireEvent.click(screen.getByTestId("fib-candidates-toggle"));

      const row = screen.getByTestId("fib-candidate-row-1");
      expect(row.getAttribute("data-status")).toBe(status);
      expect(row.textContent?.toLowerCase()).toMatch(label);
    });
  }
});

// ── Branch 1 normal state preserved ──────────────────────────

describe("FibScoreCard — normal state", () => {
  it("renders the score badge and swing range when no_active_fib=false", () => {
    const result = makeResult({ score: 78, no_active_fib: false });
    render(withQueryClient(createElement(FibScoreCard, { fibonacci: result })));

    expect(screen.getByTestId("fib-score-card")).toBeTruthy();
    expect(screen.getByText("78")).toBeTruthy();
    const card = screen.getByTestId("fib-score-card");
    expect(card.textContent).toContain("$100.00");
    expect(card.textContent).toContain("$130.00");
    expect(screen.queryByTestId("fib-no-active-card")).toBeNull();
  });

  it("returns null when fibonacci is null", () => {
    const { container } = render(
      withQueryClient(createElement(FibScoreCard, { fibonacci: null })),
    );
    expect(container.firstChild).toBeNull();
  });
});

// ── Branch 3: Score factors + editable weights ───────────────

describe("FibScoreCard — score factors", () => {
  it("renders one row per canonical factor once fibConfig loads", async () => {
    render(withQueryClient(createElement(FibScoreCard, { fibonacci: makeResult() })));
    // Wait for the query to resolve.
    await screen.findByTestId("fib-criterion-row-swing_clarity");
    for (const f of [
      "swing_clarity",
      "multi_touch",
      "rejection_intensity",
      "stretched_penalty",
      "recency",
    ]) {
      expect(screen.getByTestId(`fib-criterion-row-${f}`)).toBeTruthy();
    }
  });

  it("clicking 'Edit weights' reveals editable inputs", async () => {
    render(withQueryClient(createElement(FibScoreCard, { fibonacci: makeResult() })));
    await screen.findByTestId("fib-edit-weights-button");

    // Before clicking, inputs should NOT exist.
    expect(screen.queryByTestId("fib-weight-input-swing_clarity")).toBeNull();

    fireEvent.click(screen.getByTestId("fib-edit-weights-button"));

    expect(screen.getByTestId("fib-weight-input-swing_clarity")).toBeTruthy();
    expect(screen.getByTestId("fib-save-weights-button")).toBeTruthy();
  });

  it("editing a weight and clicking Save calls updateFibConfig with the new value", async () => {
    render(withQueryClient(createElement(FibScoreCard, { fibonacci: makeResult() })));
    await screen.findByTestId("fib-edit-weights-button");

    fireEvent.click(screen.getByTestId("fib-edit-weights-button"));

    const input = screen.getByTestId(
      "fib-weight-input-swing_clarity",
    ) as HTMLInputElement;

    // Wrap each interaction in act() so React's controlled-input
    // state updates flush before we measure / dispatch the next event.
    // Without act(), the blur-driven setDraftWeights call hasn't been
    // committed by the time the save click runs, so saveWeights reads
    // a null draftWeights and the mutation never fires.
    await act(async () => {
      fireEvent.change(input, { target: { value: "0.40" } });
    });
    await act(async () => {
      fireEvent.blur(input);
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("fib-save-weights-button"));
    });

    expect(mockUpdateFibConfig).toHaveBeenCalledTimes(1);
    const [arg] = mockUpdateFibConfig.mock.calls[0];
    expect(arg.weights.swing_clarity).toBeCloseTo(0.4, 6);
  });
});

// ── Branch 3: Candidate click ───────────────────────────────

describe("FibScoreCard — candidate click → setDisplayedFib", () => {
  it("clicking a candidate row calls setDisplayedFib with that candidate", async () => {
    const candidate = makeCandidate({ score: 65 });
    const result = makeResult({
      candidates: [makeCandidate({ score: 80 }), candidate],
    });
    render(withQueryClient(createElement(FibScoreCard, { fibonacci: result })));
    await screen.findByTestId("fib-edit-weights-button");

    // Open candidates section.
    fireEvent.click(screen.getByTestId("fib-candidates-toggle"));
    fireEvent.click(screen.getByTestId("fib-candidate-row-1"));

    const override = useChartStore.getState().displayedFibOverride;
    expect(override).not.toBeNull();
    expect(override?.score).toBe(65);
  });
});

// ── Branch 3: Clear chart fib ───────────────────────────────

describe("FibScoreCard — clear chart fib", () => {
  it("clicking 'Clear' sets fibCleared=true in the store", async () => {
    render(withQueryClient(createElement(FibScoreCard, { fibonacci: makeResult() })));
    await screen.findByTestId("fib-clear-chart-button");

    fireEvent.click(screen.getByTestId("fib-clear-chart-button"));

    expect(useChartStore.getState().fibCleared).toBe(true);
  });

  it("Clear button is hidden once fibCleared is already true", async () => {
    useChartStore.getState().clearChartFib();
    render(withQueryClient(createElement(FibScoreCard, { fibonacci: makeResult() })));
    // Score factors load asynchronously — wait for them, then check.
    await screen.findByTestId("fib-edit-weights-button");
    expect(screen.queryByTestId("fib-clear-chart-button")).toBeNull();
  });
});

// ── Branch 3: Score breakdown ───────────────────────────────

describe("FibScoreCard — score breakdown", () => {
  it("toggling 'How is this score calculated?' reveals the formula body", async () => {
    render(withQueryClient(createElement(FibScoreCard, { fibonacci: makeResult() })));
    const breakdown = await screen.findByTestId("fib-score-breakdown");

    // Body hidden by default.
    expect(within(breakdown).queryByTestId("fib-score-breakdown-body")).toBeNull();

    fireEvent.click(within(breakdown).getByRole("button"));

    expect(within(breakdown).getByTestId("fib-score-breakdown-body")).toBeTruthy();
    // The body should contain the formula's RHS — the score itself.
    expect(within(breakdown).getByTestId("fib-score-breakdown-body").textContent).toContain("75.0");
  });
});
