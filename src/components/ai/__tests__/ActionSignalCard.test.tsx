/**
 * ActionSignalCard — neutral state renders commentary + exactly one warning.
 * Slice B: rejected state shows "View unverified model output" button.
 *
 * Spec testing item #5: the neutral state shows model commentary PLUS
 * exactly one safety warning (no triple render across description/cautions/message).
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ActionSignalCard from "../ActionSignalCard";
import type { SignalData } from "../ActionSignalCard";

const WARNING = "No actionable trade plan could be verified from the supplied facts.";
const NARRATIVE = "RSI is inconclusive and EMA stack is mixed. Watch for a breakout above resistance.";

function _neutralSignal(confidence = 42): SignalData {
  return {
    direction: "NEUTRAL",
    description: "Mixed signals — no clear setup.",
    confidence,
    levels: [
      { label: "Entry", value: "—", sub: "" },
      { label: "Stop", value: "—", sub: "" },
      { label: "Target", value: "—", sub: "" },
    ],
    meta: [
      { label: "R:R", value: "—" },
      { label: "Score", value: "—" },
      { label: "ADX", value: "—" },
      { label: "Vol", value: "—" },
    ],
    checks: [],
  };
}

describe("ActionSignalCard — neutral state", () => {
  it("renders model confidence, not zero", () => {
    render(
      <ActionSignalCard
        signal={_neutralSignal(42)}
        status="neutral"
        warning={WARNING}
        narrative={NARRATIVE}
      />,
    );
    expect(screen.getByText("42%")).toBeTruthy();
  });

  it("shows warning exactly once", () => {
    const { container } = render(
      <ActionSignalCard
        signal={_neutralSignal()}
        status="neutral"
        warning={WARNING}
        narrative={NARRATIVE}
      />,
    );
    // The entire rendered HTML must contain the warning exactly once
    const count = (container.innerHTML.match(
      /No actionable trade plan could be verified/g,
    ) ?? []).length;
    expect(count).toBe(1);
  });

  it("renders the narrative under 'not verified' label", () => {
    render(
      <ActionSignalCard
        signal={_neutralSignal()}
        status="neutral"
        warning={WARNING}
        narrative={NARRATIVE}
      />,
    );
    expect(screen.getByText(/Model commentary — not verified/i)).toBeTruthy();
    expect(screen.getByText(NARRATIVE)).toBeTruthy();
  });

  it("does NOT show warning or narrative for directional status", () => {
    const { container } = render(
      <ActionSignalCard
        signal={_neutralSignal()}
        status="directional"
        warning={WARNING}
        narrative={NARRATIVE}
      />,
    );
    expect(container.innerHTML).not.toContain("No actionable trade plan");
    expect(container.innerHTML).not.toContain("not verified");
  });
});

// Production shape the backend emits for rejected: blank description, no checks.
function _rejectedSignal(): SignalData {
  return {
    direction: "NEUTRAL",
    description: "",
    confidence: 0,
    levels: [
      { label: "Entry", value: "—", sub: "" },
      { label: "Stop", value: "—", sub: "" },
      { label: "Target", value: "—", sub: "" },
    ],
    meta: [
      { label: "R:R", value: "—" },
      { label: "Score", value: "—" },
      { label: "ADX", value: "—" },
      { label: "Vol", value: "—" },
    ],
    checks: [],
  };
}

describe("ActionSignalCard — rejected state", () => {
  it("shows warning exactly once (banner only — not in description or checks)", () => {
    const { container } = render(
      <ActionSignalCard
        signal={_rejectedSignal()}
        status="rejected"
        warning={WARNING}
        onViewRejected={vi.fn()}
      />,
    );
    const count = (container.innerHTML.match(
      /No actionable trade plan could be verified/g,
    ) ?? []).length;
    expect(count).toBe(1);
  });

  it("shows 'View unverified model output' button and calls onViewRejected", () => {
    const onViewRejected = vi.fn();
    render(
      <ActionSignalCard
        signal={_rejectedSignal()}
        status="rejected"
        warning={WARNING}
        onViewRejected={onViewRejected}
      />,
    );
    const btn = screen.getByTestId("view-rejected-output");
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    expect(onViewRejected).toHaveBeenCalledOnce();
  });

  it("does NOT show the button when onViewRejected is absent", () => {
    const { container } = render(
      <ActionSignalCard
        signal={_rejectedSignal()}
        status="rejected"
        warning={WARNING}
      />,
    );
    expect(container.querySelector("[data-testid='view-rejected-output']")).toBeNull();
  });
});
