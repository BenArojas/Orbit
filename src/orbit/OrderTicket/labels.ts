import type {
  MoonMarketOrderType,
  MoonMarketTimeInForce,
  MoonMarketTrailingType,
} from "@/modules/moonmarket/api";

export const ORDER_TYPE_LABELS: Record<MoonMarketOrderType, string> = {
  MKT: "Market",
  LMT: "Limit",
  STP: "Stop",
  STP_LIMIT: "Stop Limit",
  TRAIL: "Trailing Stop",
  TRAILLMT: "Trailing Stop Limit",
};

export const TIF_LABELS: Record<MoonMarketTimeInForce, string> = {
  DAY: "Day",
  GTC: "Good Till Cancel",
  IOC: "Immediate or Cancel",
};

export const TRAILING_TYPE_LABELS: Record<MoonMarketTrailingType, string> = {
  amt: "Amount ($)",
  "%": "Percent (%)",
};
