import { describe, expect, it } from "vitest";
import { computeRiskReward, sharesForCash, cashForBuyingPowerPct } from "../orderMath";
import { ORDER_TYPE_LABELS, TIF_LABELS } from "../labels";

describe("computeRiskReward", () => {
  it("computes ratio for a long position", () => {
    const rr = computeRiskReward({ side: "BUY", entry: 100, takeProfit: 130, stopLoss: 90 });
    expect(rr).not.toBeNull();
    expect(rr!.risk).toBeCloseTo(10);
    expect(rr!.reward).toBeCloseTo(30);
    expect(rr!.ratio).toBeCloseTo(3);
  });

  it("computes ratio for a short position", () => {
    const rr = computeRiskReward({ side: "SELL", entry: 100, takeProfit: 80, stopLoss: 110 });
    expect(rr).not.toBeNull();
    expect(rr!.risk).toBeCloseTo(10);
    expect(rr!.reward).toBeCloseTo(20);
    expect(rr!.ratio).toBeCloseTo(2);
  });

  it("returns null when inputs are incomplete", () => {
    expect(computeRiskReward({ side: "BUY", entry: undefined, takeProfit: 130, stopLoss: 90 })).toBeNull();
  });

  it("returns null when risk is non-positive (stop on wrong side)", () => {
    expect(computeRiskReward({ side: "BUY", entry: 100, takeProfit: 130, stopLoss: 110 })).toBeNull();
  });
});

describe("sharesForCash", () => {
  it("floors cash divided by reference price", () => {
    expect(sharesForCash(1000, 180)).toBe(5);
  });

  it("returns null when reference price is missing or non-positive", () => {
    expect(sharesForCash(1000, undefined)).toBeNull();
    expect(sharesForCash(1000, 0)).toBeNull();
  });

  it("returns null when cash is missing or non-positive", () => {
    expect(sharesForCash(undefined, 180)).toBeNull();
    expect(sharesForCash(0, 180)).toBeNull();
  });
});

describe("cashForBuyingPowerPct", () => {
  it("computes cash as a percent of buying power", () => {
    expect(cashForBuyingPowerPct(25, 40000)).toBe(10000);
  });

  it("returns null when percent or buying power is missing or non-positive", () => {
    expect(cashForBuyingPowerPct(undefined, 40000)).toBeNull();
    expect(cashForBuyingPowerPct(25, null)).toBeNull();
    expect(cashForBuyingPowerPct(0, 40000)).toBeNull();
  });
});

describe("labels", () => {
  it("maps order-type codes to plain English", () => {
    expect(ORDER_TYPE_LABELS.TRAIL).toBe("Trailing Stop");
    expect(ORDER_TYPE_LABELS.TRAILLMT).toBe("Trailing Stop Limit");
    expect(TIF_LABELS.GTC).toBe("Good Till Cancel");
  });
});
