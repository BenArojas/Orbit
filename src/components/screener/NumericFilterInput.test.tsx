/**
 * NumericFilterInput tests
 *
 * Covers:
 *  - formatWithCommas: adds thousand separators, preserves decimals + minus,
 *    handles edge cases (empty, lone "-", lone ".", trailing dot)
 *  - stripCommas: round-trip
 *  - isValidNumericInput: accepts/rejects expected character classes
 *  - Component:
 *    - displays formatted value while storing raw
 *    - rejects non-numeric chars at change time
 *    - emits Enter / Escape callbacks
 */

import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import NumericFilterInput, {
  formatWithCommas,
  stripCommas,
  isValidNumericInput,
} from "./NumericFilterInput";

describe("formatWithCommas", () => {
  it("formats integers with commas", () => {
    expect(formatWithCommas("10000000")).toBe("10,000,000");
    expect(formatWithCommas("1000")).toBe("1,000");
    expect(formatWithCommas("999")).toBe("999");
  });

  it("preserves decimals", () => {
    expect(formatWithCommas("1234.56")).toBe("1,234.56");
    expect(formatWithCommas("15.5")).toBe("15.5");
    expect(formatWithCommas("0.1234")).toBe("0.1234");
  });

  it("preserves trailing decimal point (mid-typing)", () => {
    expect(formatWithCommas("1234.")).toBe("1,234.");
  });

  it("preserves negatives", () => {
    expect(formatWithCommas("-5")).toBe("-5");
    expect(formatWithCommas("-12345.5")).toBe("-12,345.5");
  });

  it("returns lone non-numeric markers untouched", () => {
    expect(formatWithCommas("")).toBe("");
    expect(formatWithCommas("-")).toBe("-");
    expect(formatWithCommas(".")).toBe(".");
    expect(formatWithCommas("-.")).toBe("-.");
  });
});

describe("stripCommas", () => {
  it("removes all commas", () => {
    expect(stripCommas("10,000,000")).toBe("10000000");
    expect(stripCommas("1,234.56")).toBe("1234.56");
    expect(stripCommas("999")).toBe("999");
  });
});

describe("isValidNumericInput", () => {
  it("accepts valid numeric strings", () => {
    expect(isValidNumericInput("")).toBe(true);
    expect(isValidNumericInput("0")).toBe(true);
    expect(isValidNumericInput("12345")).toBe(true);
    expect(isValidNumericInput("12.34")).toBe(true);
    expect(isValidNumericInput("-5")).toBe(true);
    expect(isValidNumericInput(".5")).toBe(true);
  });

  it("rejects non-numeric characters", () => {
    expect(isValidNumericInput("abc")).toBe(false);
    expect(isValidNumericInput("1a")).toBe(false);
    expect(isValidNumericInput("1.2.3")).toBe(false);
    expect(isValidNumericInput("--5")).toBe(false);
  });
});

// ── Component ─────────────────────────────────────────────────

function Harness({ initial = "", onValueChange }: {
  initial?: string;
  onValueChange?: (v: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <NumericFilterInput
      value={value}
      onChange={(v) => {
        setValue(v);
        onValueChange?.(v);
      }}
    />
  );
}

describe("<NumericFilterInput>", () => {
  it("renders with thousand separators in the displayed value", () => {
    render(<Harness initial="1000000" />);
    const input = screen.getByDisplayValue("1,000,000") as HTMLInputElement;
    expect(input).toBeInTheDocument();
  });

  it("strips commas before passing to onChange", () => {
    const onValueChange = vi.fn();
    render(<Harness onValueChange={onValueChange} />);
    const input = screen.getByRole("textbox");
    // User types "1000000" (no commas yet — controlled by formatter)
    fireEvent.change(input, { target: { value: "1,000,000" } });
    expect(onValueChange).toHaveBeenCalledWith("1000000");
  });

  it("rejects non-numeric input — onChange not called", () => {
    const onValueChange = vi.fn();
    render(<Harness initial="100" onValueChange={onValueChange} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "100abc" } });
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("calls onEnter on Enter key", () => {
    const onEnter = vi.fn();
    render(
      <NumericFilterInput value="42" onChange={() => { }} onEnter={onEnter} />,
    );
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it("calls onEscape on Escape key", () => {
    const onEscape = vi.fn();
    render(
      <NumericFilterInput value="42" onChange={() => { }} onEscape={onEscape} />,
    );
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });
});
