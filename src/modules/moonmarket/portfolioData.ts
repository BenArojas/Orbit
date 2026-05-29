import type { MoonMarketAllocationItem, MoonMarketPosition } from "./types";
import type { OrderTicketAssetClass } from "@/orbit/OrderTicket";

export type AllocationDisplayMode = "total" | "daily";

export type DisplayAllocationItem = MoonMarketAllocationItem & {
  grouped_children?: MoonMarketAllocationItem[];
};

const OPTION_RE = /^([A-Z0-9.]+)\s+([A-Z]{3}\d{4})\s+([0-9.]+)\s+([CP])(?:\s|\[|$)/i;

function itemDescription(item: MoonMarketAllocationItem | MoonMarketPosition): string | undefined {
  return "description" in item ? item.description : undefined;
}

export function isOptionAssetClass(assetClass?: string | null): boolean {
  return String(assetClass ?? "").toUpperCase() === "OPT";
}

export function isCashAssetClass(assetClass?: string | null): boolean {
  return String(assetClass ?? "").toUpperCase() === "CASH";
}

export function compactOptionLabel(raw: string): string {
  const match = raw.trim().match(OPTION_RE);
  if (!match) return raw.trim();
  const [, symbol, expiration, strike, right] = match;
  const normalizedStrike = Number.isFinite(Number(strike)) ? String(Number(strike)) : strike;
  return `${symbol.toUpperCase()} ${expiration.toUpperCase()} ${normalizedStrike}${right.toUpperCase()}`;
}

export function displayHoldingName(item: MoonMarketAllocationItem | MoonMarketPosition): string {
  if (isCashAssetClass(item.asset_class)) return "CASH";
  const raw = item.symbol || itemDescription(item) || ("label" in item ? item.label : "");
  if (isOptionAssetClass(item.asset_class)) return compactOptionLabel(raw);
  return raw;
}

export function displayHoldingSubtitle(item: MoonMarketAllocationItem | MoonMarketPosition): string {
  if (isCashAssetClass(item.asset_class)) return itemDescription(item) || "Cash balance";
  const raw = "label" in item ? item.label : itemDescription(item);
  if (isOptionAssetClass(item.asset_class)) return compactOptionLabel(raw || item.symbol);
  const subtitle = raw || item.symbol;
  return subtitle.trim().toUpperCase() === displayHoldingName(item).trim().toUpperCase() ? "" : subtitle;
}

export function displayAssetClass(item: MoonMarketAllocationItem | MoonMarketPosition): string {
  if (isOptionAssetClass(item.asset_class)) return "OPTION";
  if (isCashAssetClass(item.asset_class)) return "CASH";
  return item.asset_class || "INSTRUMENT";
}

export function optionOrderAssetClass(item: MoonMarketAllocationItem | MoonMarketPosition): OrderTicketAssetClass {
  return isOptionAssetClass(item.asset_class) ? "OPT" : "STK";
}

export function allocationMetricValue(item: MoonMarketAllocationItem, mode: AllocationDisplayMode): number | null {
  return mode === "daily" ? item.daily_pnl_percent : item.pnl_percent;
}

export function groupAllocationItems(
  allocation: MoonMarketAllocationItem[],
  maxTiles = 12,
): DisplayAllocationItem[] {
  const positive = allocation.filter((item) => item.value > 0);
  if (positive.length <= maxTiles) return positive;

  const cashItems = positive.filter((item) => isCashAssetClass(item.asset_class));
  const nonCashItems = positive.filter((item) => !isCashAssetClass(item.asset_class));
  const headCount = Math.max(1, maxTiles - 1 - cashItems.length);
  const head = nonCashItems.slice(0, headCount);
  const tail = nonCashItems.slice(headCount);
  const value = tail.reduce((sum, item) => sum + item.value, 0);
  const percent = tail.reduce((sum, item) => sum + item.percent, 0);
  const unrealizedPnl = tail.reduce((sum, item) => sum + item.unrealized_pnl, 0);
  const dailyPnl = tail.reduce((sum, item) => sum + (item.daily_pnl ?? 0), 0);
  const pnlBasis = tail.reduce((sum, item) => sum + Math.max(0, item.value - item.unrealized_pnl), 0);
  const dailyPnlBasis = tail.reduce((sum, item) => sum + Math.max(0, item.value - (item.daily_pnl ?? 0)), 0);

  const others: DisplayAllocationItem = {
    conid: -1,
    symbol: "Others",
    label: `${tail.length} smaller holdings`,
    value: Math.round(value * 100) / 100,
    percent: Math.round(percent * 100) / 100,
    asset_class: "GROUP",
    unrealized_pnl: Math.round(unrealizedPnl * 100) / 100,
    daily_pnl: Math.round(dailyPnl * 100) / 100,
    pnl_percent: pnlBasis > 0 ? Math.round((unrealizedPnl / pnlBasis) * 10000) / 100 : null,
    daily_pnl_percent: dailyPnlBasis > 0 ? Math.round((dailyPnl / dailyPnlBasis) * 10000) / 100 : null,
    grouped_children: tail,
  };

  return [...head, ...cashItems, others];
}
