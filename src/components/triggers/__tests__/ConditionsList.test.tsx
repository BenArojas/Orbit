import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConditionsList } from "../ConditionsList";
import { formatTriggerCondition } from "../formatTriggerCondition";
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

  it("shows plain-English condition choices and only supported EMAs", () => {
    const onChange = vi.fn();
    render(
      <ConditionsList
        value={[
          { indicator: "ema_200", condition: "above", threshold: 0, news_candle_method: null },
        ]}
        onChange={onChange}
      />,
    );

    const indicator = screen.getByRole("combobox", { name: /indicator/i });
    const optionTexts = Array.from(indicator.querySelectorAll("option")).map(
      (option) => option.textContent,
    );

    expect(optionTexts).toContain("Price vs EMA 200");
    expect(optionTexts).toContain("Price vs EMA 9");
    expect(optionTexts).toContain("Price vs EMA 21");
    expect(optionTexts).toContain("Price vs EMA 50");
    expect(optionTexts).toContain("Price");
    expect(optionTexts).not.toContain("Price vs EMA 20");
    expect(optionTexts).not.toContain("Fibonacci");

    const condition = screen.getByRole("combobox", { name: /condition/i });
    const conditionTexts = Array.from(condition.querySelectorAll("option")).map(
      (option) => option.textContent,
    );

    expect(conditionTexts).toContain("Price above EMA 200");
    expect(conditionTexts).toContain("Price crosses below EMA 200");
  });

  it("does not show a threshold input for EMA price-vs-indicator conditions", () => {
    const onChange = vi.fn();
    render(
      <ConditionsList
        value={[
          { indicator: "ema_21", condition: "crosses_above", threshold: 0, news_candle_method: null },
        ]}
        onChange={onChange}
      />,
    );

    expect(screen.queryByRole("spinbutton", { name: /threshold/i })).toBeNull();
    expect(screen.getByText("Auto")).toBeInTheDocument();
  });

  it("sets EMA thresholds to zero when changing an existing condition to EMA", () => {
    const onChange = vi.fn();
    render(<ConditionsList value={[baseCondition]} onChange={onChange} />);

    fireEvent.change(screen.getByRole("combobox", { name: /indicator/i }), {
      target: { value: "ema_21" },
    });

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({
        indicator: "ema_21",
        threshold: 0,
        news_candle_method: null,
      }),
    ]);
  });

  it("formats raw close conditions as price conditions", () => {
    expect(
      formatTriggerCondition({
        indicator: "close",
        condition: "above",
        threshold: 110.5,
        news_candle_method: null,
      }),
    ).toBe("Price above 110.5");
  });
});
