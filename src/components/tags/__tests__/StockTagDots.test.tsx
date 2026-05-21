import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StockTagDots } from "../StockTagDots";

describe("StockTagDots", () => {
  it("renders nothing when there are no tags", () => {
    const { container } = render(<StockTagDots tags={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders up to max dots inline", () => {
    render(
      <StockTagDots
        max={3}
        tags={[
          { rule_id: 1, rule_name: "A", indicators: ["rsi"], fired_at: "x" },
          { rule_id: 2, rule_name: "B", indicators: ["volume"], fired_at: "x" },
        ]}
      />,
    );
    expect(screen.getAllByTestId("tag-dot")).toHaveLength(2);
  });

  it("renders +N overflow when tags exceed max", () => {
    render(
      <StockTagDots
        max={2}
        tags={[
          { rule_id: 1, rule_name: "A", indicators: ["rsi"], fired_at: "x" },
          { rule_id: 2, rule_name: "B", indicators: ["volume"], fired_at: "x" },
          { rule_id: 3, rule_name: "C", indicators: ["fibonacci"], fired_at: "x" },
          { rule_id: 4, rule_name: "D", indicators: ["news_candle"], fired_at: "x" },
        ]}
      />,
    );
    expect(screen.getAllByTestId("tag-dot")).toHaveLength(2);
    expect(screen.getByText("+2")).toBeInTheDocument();
  });
});
