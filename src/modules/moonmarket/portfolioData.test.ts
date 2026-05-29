import { describe, expect, it } from "vitest";
import type { MoonMarketAllocationItem } from "@/lib/api";
import {
  allocationMetricValue,
  displayAssetClass,
  displayHoldingName,
  displayHoldingSubtitle,
  groupAllocationItems,
  optionOrderAssetClass,
} from "./portfolioData";

function item(overrides: Partial<MoonMarketAllocationItem>): MoonMarketAllocationItem {
  return {
    conid: overrides.conid ?? 1,
    symbol: overrides.symbol ?? "AAPL",
    label: overrides.label ?? "Apple Inc",
    value: overrides.value ?? 100,
    percent: overrides.percent ?? 10,
    asset_class: overrides.asset_class ?? "STK",
    unrealized_pnl: overrides.unrealized_pnl ?? 0,
    daily_pnl: overrides.daily_pnl ?? null,
    pnl_percent: overrides.pnl_percent ?? 12.5,
    daily_pnl_percent: overrides.daily_pnl_percent ?? 1.25,
  };
}

describe("portfolioData", () => {
  it("shortens IBKR option descriptions to the tradable contract label", () => {
    const option = item({
      symbol: "IBKR DEC2026 90.00 C [IBKR 261218C00090000 100]",
      label: "IBKR DEC2026 90.00 C [IBKR 261218C00090000 100]",
      asset_class: "OPT",
    });

    expect(displayHoldingName(option)).toBe("IBKR DEC2026 90C");
    expect(displayAssetClass(option)).toBe("OPTION");
    expect(optionOrderAssetClass(option)).toBe("OPT");
  });

  it("groups the tail of the portfolio into a clickable Others item", () => {
    const items = Array.from({ length: 14 }, (_, index) =>
      item({
        conid: index + 1,
        symbol: `T${index + 1}`,
        label: `Ticker ${index + 1}`,
        value: 100 - index,
        percent: 10 - index * 0.5,
      }),
    );

    const grouped = groupAllocationItems(items, 12);
    const others = grouped[grouped.length - 1];

    expect(grouped).toHaveLength(12);
    expect(others.symbol).toBe("Others");
    expect(others.grouped_children).toHaveLength(3);
    expect(others.value).toBe(87 + 88 + 89);
  });

  it("uses total or daily P&L percent for treemap display mode", () => {
    const stock = item({ pnl_percent: 18.75, daily_pnl_percent: -2.5 });

    expect(allocationMetricValue(stock, "total")).toBe(18.75);
    expect(allocationMetricValue(stock, "daily")).toBe(-2.5);
  });

  it("drops duplicate subtitles when IBKR repeats the ticker as the label", () => {
    expect(displayHoldingSubtitle(item({ symbol: "CLS", label: "CLS" }))).toBe("");
  });
});
