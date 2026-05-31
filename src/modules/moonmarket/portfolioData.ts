import type { MoonMarketAllocationItem, MoonMarketPortfolioResponse, MoonMarketPosition } from "./types";
import type { OrderTicketAssetClass } from "@/orbit/OrderTicket";

export type AllocationDisplayMode = "total" | "daily";
export type PortfolioLiveTick = {
  last: number;
  changePct?: number;
};

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
  const side = right.toUpperCase() === "P" ? "put" : "call";
  return `${symbol.toUpperCase()} ${expiration.toUpperCase()} ${normalizedStrike}${side}`;
}

function optionLabelCandidates(item: MoonMarketAllocationItem | MoonMarketPosition): string[] {
  // contract_desc is the authoritative IBKR contract string for options; try it
  // first, then fall back to the fields that older payloads scattered it across.
  const candidates = [
    item.contract_desc,
    itemDescription(item),
    "label" in item ? item.label : undefined,
    item.symbol,
  ];
  return candidates.filter((value): value is string => Boolean(value && value.trim()));
}

export function displayHoldingName(item: MoonMarketAllocationItem | MoonMarketPosition): string {
  if (isCashAssetClass(item.asset_class)) return "CASH";
  if (isOptionAssetClass(item.asset_class)) {
    // IBKR scatters the option contract string across symbol/label/description
    // depending on the endpoint, so pick whichever field actually parses as a
    // contract and fall back to the underlying ticker (never the company name).
    const candidates = optionLabelCandidates(item);
    const contract = candidates.find((value) => OPTION_RE.test(value.trim()));
    if (contract) return compactOptionLabel(contract);
    return (item.symbol || candidates[0] || "").trim();
  }
  const raw = item.symbol || itemDescription(item) || ("label" in item ? item.label : "");
  return raw;
}

export function holdingTitleParts(
  item: MoonMarketAllocationItem | MoonMarketPosition,
): { primary: string; secondary: string } {
  const name = displayHoldingName(item);
  if (isOptionAssetClass(item.asset_class)) {
    const [symbol, ...rest] = name.split(" ");
    return { primary: symbol || name, secondary: rest.join(" ") || "OPTION" };
  }
  return { primary: name, secondary: displayHoldingSubtitle(item) };
}

export function displayHoldingSubtitle(item: MoonMarketAllocationItem | MoonMarketPosition): string {
  if (isCashAssetClass(item.asset_class)) return itemDescription(item) || "Cash balance";
  const raw = "label" in item ? item.label : itemDescription(item);
  if (isOptionAssetClass(item.asset_class)) {
    const subtitle = compactOptionLabel(raw || item.symbol);
    return subtitle.trim().toUpperCase() === displayHoldingName(item).trim().toUpperCase() ? "" : subtitle;
  }
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

function valueMultiplier(position: MoonMarketPosition): number {
  const quantity = Math.abs(position.quantity);
  const last = position.last_price ?? 0;
  if (quantity > 0 && last > 0 && position.market_value !== 0) {
    return Math.max(1, Math.abs(position.market_value) / (quantity * last));
  }
  return isOptionAssetClass(position.asset_class) ? 100 : 1;
}

function percentChange(value: number | null | undefined, basis: number): number | null {
  if (value == null || basis <= 0) return null;
  return Math.round((value / basis) * 10000) / 100;
}

export function mergeLivePortfolioTicks(
  portfolio: MoonMarketPortfolioResponse,
  ticks: Map<number, PortfolioLiveTick>,
): MoonMarketPortfolioResponse {
  if (!ticks.size) return portfolio;

  let changed = false;
  const positions = portfolio.positions.map((position) => {
    const tick = ticks.get(position.conid);
    if (!tick?.last || isCashAssetClass(position.asset_class)) return position;

    const previousAbsValue = Math.abs(position.market_value);
    const sign = position.market_value < 0 ? -1 : 1;
    const multiplier = valueMultiplier(position);
    const nextAbsValue = Math.round(Math.abs(position.quantity) * tick.last * multiplier * 100) / 100;
    if (nextAbsValue <= 0 || nextAbsValue === previousAbsValue) return position;

    const valueDelta = nextAbsValue - previousAbsValue;
    const unrealizedPnl = Math.round((position.unrealized_pnl + valueDelta * sign) * 100) / 100;
    const dailyPnl = tick.changePct == null
      ? position.daily_pnl
      : Math.round((nextAbsValue - nextAbsValue / (1 + tick.changePct / 100)) * 100) / 100;
    const marketValue = Math.round(nextAbsValue * sign * 100) / 100;
    changed = true;

    return {
      ...position,
      last_price: tick.last,
      market_value: marketValue,
      unrealized_pnl: unrealizedPnl,
      daily_pnl: dailyPnl,
      pnl_percent: percentChange(unrealizedPnl, nextAbsValue - unrealizedPnl),
      daily_pnl_percent: tick.changePct ?? position.daily_pnl_percent,
    };
  });

  if (!changed) return portfolio;

  const totalMarketValue = Math.round(positions.reduce((sum, position) => sum + Math.abs(position.market_value), 0) * 100) / 100;
  const totalUnrealizedPnl = Math.round(positions.reduce((sum, position) => sum + position.unrealized_pnl, 0) * 100) / 100;
  const positionByConid = new Map(positions.map((position) => [position.conid, position]));
  const allocation = portfolio.allocation.map((item) => {
    const position = positionByConid.get(item.conid);
    if (!position) return item;
    const value = Math.round(Math.abs(position.market_value) * 100) / 100;
    return {
      ...item,
      value,
      percent: totalMarketValue ? Math.round((value / totalMarketValue) * 10000) / 100 : 0,
      unrealized_pnl: position.unrealized_pnl,
      daily_pnl: position.daily_pnl,
      pnl_percent: position.pnl_percent,
      daily_pnl_percent: position.daily_pnl_percent,
    };
  });

  return {
    ...portfolio,
    total_market_value: totalMarketValue,
    total_unrealized_pnl: totalUnrealizedPnl,
    positions,
    allocation,
  };
}
