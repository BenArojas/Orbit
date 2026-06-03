import type { MoonMarketOrderSide } from "@/lib/api";

export interface RiskReward {
  risk: number;
  reward: number;
  ratio: number;
}

export function computeRiskReward(params: {
  side: MoonMarketOrderSide;
  entry: number | undefined;
  takeProfit: number | undefined;
  stopLoss: number | undefined;
}): RiskReward | null {
  const { side, entry, takeProfit, stopLoss } = params;
  if (entry == null || takeProfit == null || stopLoss == null) return null;
  const risk = side === "BUY" ? entry - stopLoss : stopLoss - entry;
  const reward = side === "BUY" ? takeProfit - entry : entry - takeProfit;
  if (risk <= 0 || reward <= 0) return null;
  return { risk, reward, ratio: reward / risk };
}

export function sharesForCash(
  cash: number | undefined,
  referencePrice: number | undefined,
): number | null {
  if (cash == null || cash <= 0) return null;
  if (referencePrice == null || referencePrice <= 0) return null;
  return Math.floor(cash / referencePrice);
}

export function cashForBuyingPowerPct(
  pct: number | undefined,
  buyingPower: number | null | undefined,
): number | null {
  if (pct == null || pct <= 0) return null;
  if (buyingPower == null || buyingPower <= 0) return null;
  return (buyingPower * pct) / 100;
}
