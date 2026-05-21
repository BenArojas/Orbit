import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConditionsList } from "../ConditionsList";
import type { TriggerCondition } from "@/lib/api";

const baseCondition: TriggerCondition = {
  indicator: "rsi",
  condition: "below",
  threshold: 30,
  news_candle_method: null,
};

describe("ConditionsList", () => {
  it("renders each condition as a row", () => {
    const onChange = vi.fn();
    render(
      <ConditionsList
        value={[
          baseCondition,
          { indicator: "ema_200", condition: "above", threshold: 0, news_candle_method: null },
        ]}
        onChange={onChange}
      />,
    );
    expect(screen.getAllByRole("combobox", { name: /indicator/i })).toHaveLength(2);
  });

  it("calls onChange when a new condition is added", () => {
    const onChange = vi.fn();
    render(<ConditionsList value={[baseCondition]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /add condition/i }));
    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls[0][0];
    expect(next.length).toBe(2);
  });

  it("removes a row when the remove button is clicked", () => {
    const onChange = vi.fn();
    render(
      <ConditionsList
        value={[
          baseCondition,
          { indicator: "ema_200", condition: "above", threshold: 0, news_candle_method: null },
        ]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: /remove/i })[0]);
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ indicator: "ema_200" }),
    ]);
  });
});
