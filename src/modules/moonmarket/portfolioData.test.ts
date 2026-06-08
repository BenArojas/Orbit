import { describe, expect, it } from "vitest";
import type { MoonMarketAllocationItem } from "@/modules/moonmarket/api";
import {
  allocationMetricValue,
  displayAssetClass,
  displayHoldingName,
  displayHoldingSubtitle,
  groupAllocationItems,
  holdingTitleParts,
  mergeLivePortfolioTicks,
  optionOrderAssetClass,
} from "./portfolioData";

function item(overrides: Partial<MoonMarketAllocationItem>): MoonMarketAllocationItem {
  return {
    conid: overrides.conid ?? 1,
    symbol: overrides.symbol ?? "AAPL",
    label: overrides.label ?? "Apple Inc",
    contract_desc: overrides.contract_desc ?? null,
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

    expect(displayHoldingName(option)).toBe("IBKR DEC2026 90call");
    expect(displayAssetClass(option)).toBe("OPTION");
    expect(optionOrderAssetClass(option)).toBe("OPT");
  });

  it("uses the option description before the underlying-only ticker", () => {
    const option = item({
      symbol: "IREN",
      label: "IREN DEC2026 90 C [IREN 261218C00090000 100]",
      asset_class: "OPT",
    });

    expect(displayHoldingName(option)).toBe("IREN DEC2026 90call");
  });

  it("prefers the contract field over a company-name label for options", () => {
    // Real IBKR allocation shape: label is the underlying company name and the
    // contract string only lives in symbol — the option label must still win.
    const option = item({
      symbol: "ORCL NOV2026 270 C [ORCL 261120C00270000 100]",
      label: "ORACLE CORP",
      asset_class: "OPT",
    });

    expect(displayHoldingName(option)).toBe("ORCL NOV2026 270call");
  });

  it("prefers contract_desc over the underlying-only symbol and company label", () => {
    // The backend now ships the full IBKR contract string in contract_desc while
    // symbol/label may only carry the underlying + company name. contract_desc wins.
    const option = item({
      symbol: "ORCL",
      label: "ORACLE CORP",
      contract_desc: "ORCL NOV2026 270 C [ORCL 261120C00270000 100]",
      asset_class: "OPT",
    });

    expect(displayHoldingName(option)).toBe("ORCL NOV2026 270call");
    expect(holdingTitleParts(option)).toEqual({ primary: "ORCL", secondary: "NOV2026 270call" });
  });

  it("falls back to the underlying ticker, never the company name, for options", () => {
    const option = item({ symbol: "ORCL", label: "ORACLE CORP", asset_class: "OPT" });

    expect(displayHoldingName(option)).toBe("ORCL");
  });

  it("splits an option label into ticker + contract detail for the treemap", () => {
    const option = item({
      symbol: "IREN OCT2026 60 C [IREN 261016C00060000 100]",
      label: "IREN OCT2026 60 C [IREN 261016C00060000 100]",
      asset_class: "OPT",
    });

    expect(holdingTitleParts(option)).toEqual({ primary: "IREN", secondary: "OCT2026 60call" });
  });

  it("uses the company name as the treemap subtitle for stocks", () => {
    expect(holdingTitleParts(item({ symbol: "AAPL", label: "Apple Inc" }))).toEqual({
      primary: "AAPL",
      secondary: "Apple Inc",
    });
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

  it("merges live websocket ticks into portfolio position values", () => {
    const portfolio = {
      account_id: "DU12345",
      total_market_value: 1000,
      total_unrealized_pnl: 125,
      positions: [
        {
          conid: 265598,
          symbol: "AAPL",
          description: "Apple Inc",
          asset_class: "STK",
          quantity: 5,
          last_price: 200,
          average_cost: 175,
          market_value: 1000,
          unrealized_pnl: 125,
          daily_pnl: 10,
          pnl_percent: 14.29,
          daily_pnl_percent: 1,
          currency: "USD",
        },
      ],
      allocation: [
        item({
          conid: 265598,
          symbol: "AAPL",
          label: "Apple Inc",
          value: 1000,
          percent: 100,
          unrealized_pnl: 125,
          daily_pnl: 10,
          pnl_percent: 14.29,
          daily_pnl_percent: 1,
        }),
      ],
    };

    const merged = mergeLivePortfolioTicks(
      portfolio,
      new Map([[265598, { last: 210, changePct: 2 }]]),
    );

    expect(merged.positions[0].last_price).toBe(210);
    expect(merged.positions[0].market_value).toBe(1050);
    expect(merged.positions[0].unrealized_pnl).toBe(175);
    expect(merged.allocation[0].value).toBe(1050);
    expect(merged.allocation[0].daily_pnl_percent).toBe(2);
  });
});
