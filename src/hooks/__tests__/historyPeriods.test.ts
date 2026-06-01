import { describe, expect, it } from "vitest";

import { chartHistoryPeriodForTimeframe, clampHistoryPeriodToTimeframe } from "../historyPeriods";

describe("historyPeriods", () => {
  it("chooses enough default history for EMA 200 on higher timeframes", () => {
    expect(chartHistoryPeriodForTimeframe("1D", "3M")).toBe("1Y");
    expect(chartHistoryPeriodForTimeframe("1W", "3M")).toBe("5Y");
    expect(chartHistoryPeriodForTimeframe("1M", "3M")).toBe("15Y");
  });

  it("chooses enough default history for intraday EMA 200 without overfetching every chart", () => {
    expect(chartHistoryPeriodForTimeframe("1m", "3M")).toBe("1D");
    expect(chartHistoryPeriodForTimeframe("5m", "3M")).toBe("5D");
    expect(chartHistoryPeriodForTimeframe("15m", "3M")).toBe("1M");
    expect(chartHistoryPeriodForTimeframe("1h", "3M")).toBe("3M");
    expect(chartHistoryPeriodForTimeframe("4h", "3M")).toBe("6M");
  });

  it("keeps a longer user default when the timeframe can serve it", () => {
    expect(chartHistoryPeriodForTimeframe("1D", "2Y")).toBe("2Y");
    expect(chartHistoryPeriodForTimeframe("1W", "10Y")).toBe("10Y");
  });

  it("clamps periods that exceed the timeframe ceiling", () => {
    expect(clampHistoryPeriodToTimeframe("15Y", "1m")).toBe("2D");
    expect(clampHistoryPeriodToTimeframe("15Y", "15m")).toBe("1M");
    expect(clampHistoryPeriodToTimeframe("15Y", "1D")).toBe("5Y");
  });
});
