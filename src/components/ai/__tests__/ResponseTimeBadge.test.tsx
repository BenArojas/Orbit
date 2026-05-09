/**
 * Tests for ResponseTimeBadge — rolling-avg display + color thresholds.
 *
 * Covers:
 *   - Hidden when there are no samples for the selected model
 *   - Hidden when no model is selected
 *   - Filters samples to the currently-selected model
 *   - Computes rolling avg over the last `windowSize` samples
 *   - Color thresholds: green <30s, amber 30–60s, red >60s
 *   - Compact time formatting (s → m s)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import ResponseTimeBadge from "../ResponseTimeBadge";
import { useAiStore } from "@/store";

function pushSamples(samples: { ms: number; model: string }[]) {
  for (const s of samples) {
    useAiStore.getState().pushResponseTime({
      durationMs: s.ms,
      model: s.model,
      at: Date.now(),
    });
  }
}

describe("ResponseTimeBadge", () => {
  beforeEach(() => {
    // Reset response-time samples between tests
    useAiStore.setState({ responseTimes: [] });
  });

  it("renders nothing when there are no samples", () => {
    const { container } = render(
      <ResponseTimeBadge selectedModel="gemma4:4b" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when selectedModel is null", () => {
    pushSamples([{ ms: 5000, model: "gemma4:4b" }]);
    const { container } = render(<ResponseTimeBadge selectedModel={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when no samples match the selected model", () => {
    pushSamples([{ ms: 5000, model: "qwen2.5:7b" }]);
    const { container } = render(
      <ResponseTimeBadge selectedModel="gemma4:4b" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("computes the average of the last windowSize matching samples", () => {
    pushSamples([
      { ms: 100_000, model: "gemma4:4b" }, // dropped — outside window of 3
      { ms: 10_000, model: "gemma4:4b" },
      { ms: 20_000, model: "gemma4:4b" },
      { ms: 30_000, model: "gemma4:4b" },
    ]);
    const { getByText } = render(
      <ResponseTimeBadge selectedModel="gemma4:4b" windowSize={3} />,
    );
    // (10 + 20 + 30) / 3 = 20s
    expect(getByText(/avg 20\.0s/)).toBeTruthy();
  });

  it("ignores samples for other models", () => {
    pushSamples([
      { ms: 60_000, model: "qwen2.5:7b" }, // ignored
      { ms: 5_000, model: "gemma4:4b" },
    ]);
    const { getByText } = render(
      <ResponseTimeBadge selectedModel="gemma4:4b" />,
    );
    expect(getByText(/avg 5\.0s/)).toBeTruthy();
  });

  it("uses green styling for < 30s averages", () => {
    pushSamples([{ ms: 15_000, model: "m" }]);
    const { container } = render(<ResponseTimeBadge selectedModel="m" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.style.borderColor).toContain("green");
  });

  it("uses amber styling for 30–60s averages", () => {
    pushSamples([{ ms: 45_000, model: "m" }]);
    const { container } = render(<ResponseTimeBadge selectedModel="m" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.style.borderColor).toContain("amber");
  });

  it("uses red styling for > 60s averages", () => {
    pushSamples([{ ms: 90_000, model: "m" }]);
    const { container } = render(<ResponseTimeBadge selectedModel="m" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.style.borderColor).toContain("red");
  });

  it("formats long times as 'Xm Ys'", () => {
    pushSamples([{ ms: 125_000, model: "m" }]); // 2m 5s
    const { getByText } = render(<ResponseTimeBadge selectedModel="m" />);
    expect(getByText(/avg 2m 5s/)).toBeTruthy();
  });
});
