import { request } from "@/lib/sidecarClient";


export interface MoonMarketAccount {
  account_id: string;
  label: string;
  selected: boolean;
  is_paper: boolean;
}

export interface MoonMarketAccountsResponse {
  accounts: MoonMarketAccount[];
  selected_account_id: string | null;
}

export interface MoonMarketAccountFunds {
  account_id: string;
  buying_power: number | null;
  available_funds: number | null;
  cash: number | null;
  currency: string;
}

export interface MoonMarketPortfolioResponse {
  account_id: string;
  total_market_value: number;
  total_unrealized_pnl: number;
  positions: MoonMarketPosition[];
  allocation: MoonMarketAllocationItem[];
}
export interface MoonMarketAllocationItem {
  conid: number;
  symbol: string;
  label: string;
  contract_desc?: string | null;
  value: number;
  percent: number;
  asset_class: string;
  unrealized_pnl: number;
  daily_pnl: number | null;
  pnl_percent: number | null;
  daily_pnl_percent: number | null;
}

export interface MoonMarketPosition {
  conid: number;
  symbol: string;
  description: string;
  contract_desc?: string | null;
  asset_class: string;
  quantity: number;
  last_price: number | null;
  average_cost: number | null;
  market_value: number;
  unrealized_pnl: number;
  daily_pnl: number | null;
  pnl_percent: number | null;
  daily_pnl_percent: number | null;
  currency: string;
}

export interface MoonMarketPerformanceResponse {
  account_id: string;
  period: string;
  nav: MoonMarketSeries;
  cumulative_return: MoonMarketSeries;
  period_return: MoonMarketSeries;
}
export interface MoonMarketSeries {
  dates: string[];
  values: number[];
}
export interface MoonMarketTrade {
  execution_id: string;
  account_id: string;
  conid: number;
  symbol: string | null;
  description: string | null;
  side: "BUY" | "SELL";
  quantity: number;
  price: number | null;
  net_amount: number | null;
  commission: number | null;
  sec_type: string | null;
  trade_time: string;
  trade_time_ms: number | null;
}

export interface MoonMarketTradeSummary {
  total_trades: number;
  total_volume: number;
  total_commissions: number;
  net_cash: number;
  buy_count: number;
  sell_count: number;
}


export interface MoonMarketTradesResponse {
  account_id: string;
  days: number;
  trades: MoonMarketTrade[];
  summary: MoonMarketTradeSummary;
}
export interface MoonMarketLiveOrder {
  order_id: string;
  conid: number | null;
  symbol: string | null;
  description: string | null;
  side: string;
  order_type: string | null;
  quantity: number | null;
  remaining_quantity: number | null;
  limit_price: number | null;
  aux_price: number | null;
  trailing_type: MoonMarketTrailingType | null;
  trailing_amt: number | null;
  outside_rth: boolean;
  tif: MoonMarketTimeInForce | string | null;
  status: string | null;
}

export interface MoonMarketLiveOrdersResponse {
  account_id: string;
  orders: MoonMarketLiveOrder[];
}

export interface TradingSafetyConfirmation {
  required: boolean;
  title: string | null;
  message: string | null;
  confirm_label: string | null;
}

export interface TradingSafetyDecision {
  account_id: string;
  action: TradingSafetyAction;
  allowed: boolean;
  mode: TradingSafetyMode;
  confirmation: TradingSafetyConfirmation;
}

export interface MoonMarketPositionsRevalidateResponse {
  account_id: string;
  positions: Array<Record<string, unknown>>;
}

export interface MoonMarketOrderRulesResponse {
  account_id: string;
  conid: number;
  side: MoonMarketOrderSide;
  rules: {
    orderTypes?: string[];
    orderTypesOutside?: string[];
    tifTypes?: string[];
    forceOrderPreview?: boolean;
    orderDefaults?: Record<string, unknown>;
    [key: string]: unknown;
  };
}

export interface MoonMarketOrderPreviewRequest {
  account_id: string;
  order: MoonMarketOrderDraft;
}

export interface MoonMarketOrderDraft {
  conid: number;
  assetClass?: MoonMarketOrderAssetClass;
  side: MoonMarketOrderSide;
  quantity: number;
  orderType: MoonMarketOrderType;
  tif: MoonMarketTimeInForce;
  price?: number;
  auxPrice?: number;
  trailingType?: MoonMarketTrailingType;
  trailingAmt?: number;
  outsideRTH?: boolean;
  cOID?: string;
  parentId?: string;
  isSingleGroup?: boolean;
}

export interface MoonMarketOrderActionResponse {
  account_id: string;
  result: Record<string, unknown> | Array<Record<string, unknown>>;
}

export interface MoonMarketOrdersRequest {
  account_id: string;
  orders: MoonMarketOrderDraft[];
}

export interface MoonMarketOptionExpirationsResponse {
  underlying_conid: number;
  symbol: string;
  expirations: string[];
}
export interface MoonMarketOptionContract {
  contractId: number;
  underlyingConid: number;
  expiration: string;
  strike: number;
  right: "C" | "P";
  type: "call" | "put";
  symbol: string;
  lastPrice: number | null;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  delta: number | null;
  bidSize: number | null;
  askSize: number | null;
}

export type MoonMarketOptionsChainData = Record<
  string,
  { call?: MoonMarketOptionContract; put?: MoonMarketOptionContract }
>;

export interface MoonMarketOptionChainResponse {
  underlying_conid: number;
  expiration: string;
  all_strikes: number[];
  chain: MoonMarketOptionsChainData;
}

export interface MoonMarketSingleOptionStrikeResponse {
  strike: number;
  data: { call?: MoonMarketOptionContract; put?: MoonMarketOptionContract };
}

export interface MoonMarketOptionWindowResponse {
  underlying_conid: number;
  expiration: string;
  strikes: MoonMarketOptionsChainData;
}

export interface MoonMarketAccount {
  account_id: string;
  label: string;
  selected: boolean;
  is_paper: boolean;
}

export interface MoonMarketAccountsResponse {
  accounts: MoonMarketAccount[];
  selected_account_id: string | null;
}

export interface MoonMarketPosition {
  conid: number;
  symbol: string;
  description: string;
  contract_desc?: string | null;
  asset_class: string;
  quantity: number;
  last_price: number | null;
  average_cost: number | null;
  market_value: number;
  unrealized_pnl: number;
  daily_pnl: number | null;
  pnl_percent: number | null;
  daily_pnl_percent: number | null;
  currency: string;
}

export interface MoonMarketAllocationItem {
  conid: number;
  symbol: string;
  label: string;
  contract_desc?: string | null;
  value: number;
  percent: number;
  asset_class: string;
  unrealized_pnl: number;
  daily_pnl: number | null;
  pnl_percent: number | null;
  daily_pnl_percent: number | null;
}

export interface MoonMarketPortfolioResponse {
  account_id: string;
  total_market_value: number;
  total_unrealized_pnl: number;
  positions: MoonMarketPosition[];
  allocation: MoonMarketAllocationItem[];
}

export interface MoonMarketSeries {
  dates: string[];
  values: number[];
}

export interface MoonMarketPerformanceResponse {
  account_id: string;
  period: string;
  nav: MoonMarketSeries;
  cumulative_return: MoonMarketSeries;
  period_return: MoonMarketSeries;
}

export interface MoonMarketTrade {
  execution_id: string;
  account_id: string;
  conid: number;
  symbol: string | null;
  description: string | null;
  side: "BUY" | "SELL";
  quantity: number;
  price: number | null;
  net_amount: number | null;
  commission: number | null;
  sec_type: string | null;
  trade_time: string;
  trade_time_ms: number | null;
}

export interface MoonMarketTradeSummary {
  total_trades: number;
  total_volume: number;
  total_commissions: number;
  net_cash: number;
  buy_count: number;
  sell_count: number;
}

export interface MoonMarketTradesResponse {
  account_id: string;
  days: number;
  trades: MoonMarketTrade[];
  summary: MoonMarketTradeSummary;
}

export interface MoonMarketLiveOrder {
  order_id: string;
  conid: number | null;
  symbol: string | null;
  description: string | null;
  side: string;
  order_type: string | null;
  quantity: number | null;
  remaining_quantity: number | null;
  limit_price: number | null;
  aux_price: number | null;
  trailing_type: MoonMarketTrailingType | null;
  trailing_amt: number | null;
  outside_rth: boolean;
  tif: MoonMarketTimeInForce | string | null;
  status: string | null;
}

export interface MoonMarketLiveOrdersResponse {
  account_id: string;
  orders: MoonMarketLiveOrder[];
}

export type TradingSafetyAction = "place" | "reply" | "cancel" | "modify";
export type TradingSafetyMode = "paper_allowed" | "live_confirmation_required" | "rejected";

export interface TradingSafetyConfirmation {
  required: boolean;
  title: string | null;
  message: string | null;
  confirm_label: string | null;
}

export interface TradingSafetyDecision {
  account_id: string;
  action: TradingSafetyAction;
  allowed: boolean;
  mode: TradingSafetyMode;
  confirmation: TradingSafetyConfirmation;
}

export interface MoonMarketPositionsRevalidateResponse {
  account_id: string;
  positions: Array<Record<string, unknown>>;
}

export type MoonMarketOrderSide = "BUY" | "SELL";
export type MoonMarketOrderType = "MKT" | "LMT" | "STP" | "STP_LIMIT" | "TRAIL" | "TRAILLMT";
export type MoonMarketTimeInForce = "DAY" | "GTC" | "IOC";
export type MoonMarketTrailingType = "amt" | "%";
export type MoonMarketOrderAssetClass = "STK" | "OPT";

export interface MoonMarketOrderDraft {
  conid: number;
  assetClass?: MoonMarketOrderAssetClass;
  side: MoonMarketOrderSide;
  quantity: number;
  orderType: MoonMarketOrderType;
  tif: MoonMarketTimeInForce;
  price?: number;
  auxPrice?: number;
  trailingType?: MoonMarketTrailingType;
  trailingAmt?: number;
  outsideRTH?: boolean;
  cOID?: string;
  parentId?: string;
  isSingleGroup?: boolean;
}

export interface MoonMarketAccountFunds {
  account_id: string;
  buying_power: number | null;
  available_funds: number | null;
  cash: number | null;
  currency: string;
}



export interface MoonMarketOrderPreviewRequest {
  account_id: string;
  order: MoonMarketOrderDraft;
}

export interface MoonMarketOrdersRequest {
  account_id: string;
  orders: MoonMarketOrderDraft[];
}

export interface MoonMarketOrderActionResponse {
  account_id: string;
  result: Record<string, unknown> | Array<Record<string, unknown>>;
}

export interface MoonMarketOrderRulesResponse {
  account_id: string;
  conid: number;
  side: MoonMarketOrderSide;
  rules: {
    orderTypes?: string[];
    orderTypesOutside?: string[];
    tifTypes?: string[];
    forceOrderPreview?: boolean;
    orderDefaults?: Record<string, unknown>;
    [key: string]: unknown;
  };
}

export interface MoonMarketOptionContract {
  contractId: number;
  underlyingConid: number;
  expiration: string;
  strike: number;
  right: "C" | "P";
  type: "call" | "put";
  symbol: string;
  lastPrice: number | null;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  delta: number | null;
  bidSize: number | null;
  askSize: number | null;
}


export interface MoonMarketOptionExpirationsResponse {
  underlying_conid: number;
  symbol: string;
  expirations: string[];
}

export interface MoonMarketOptionChainResponse {
  underlying_conid: number;
  expiration: string;
  all_strikes: number[];
  chain: MoonMarketOptionsChainData;
}

export interface MoonMarketSingleOptionStrikeResponse {
  strike: number;
  data: { call?: MoonMarketOptionContract; put?: MoonMarketOptionContract };
}



export interface MoonMarketOptionWindowResponse {
  underlying_conid: number;
  expiration: string;
  strikes: MoonMarketOptionsChainData;
}


export const moonmarketApi = {
  moonmarketAccounts: (signal?: AbortSignal) =>
    request<MoonMarketAccountsResponse>("GET", "/moonmarket/accounts", undefined, signal),

  moonmarketAccountFunds: (accountId: string, signal?: AbortSignal) =>
    request<MoonMarketAccountFunds>(
      "GET",
      `/moonmarket/accounts/${encodeURIComponent(accountId)}/funds`,
      undefined,
      signal,
    ),

  moonmarketPortfolio: (accountId?: string, signal?: AbortSignal) => {
    const qs = accountId ? `?account_id=${encodeURIComponent(accountId)}` : "";
    return request<MoonMarketPortfolioResponse>("GET", `/moonmarket/portfolio${qs}`, undefined, signal);
  },

  moonmarketPerformance: (accountId: string, period = "1Y", signal?: AbortSignal) =>
    request<MoonMarketPerformanceResponse>(
      "GET",
      `/moonmarket/performance?account_id=${encodeURIComponent(accountId)}&period=${encodeURIComponent(period)}`,
      undefined,
      signal,
    ),

  moonmarketTrades: (accountId: string, days = 7, signal?: AbortSignal) =>
    request<MoonMarketTradesResponse>(
      "GET",
      `/moonmarket/trades?account_id=${encodeURIComponent(accountId)}&days=${encodeURIComponent(days)}`,
      undefined,
      signal,
    ),

  moonmarketLiveOrders: (accountId: string, signal?: AbortSignal) =>
    request<MoonMarketLiveOrdersResponse>(
      "GET",
      `/moonmarket/live-orders?account_id=${encodeURIComponent(accountId)}`,
      undefined,
      signal,
    ),

  moonmarketTradingSafetyOrderAction: (accountId: string, action: TradingSafetyAction, signal?: AbortSignal) =>
    request<TradingSafetyDecision>(
      "GET",
      `/moonmarket/trading-safety/order-action?account_id=${encodeURIComponent(accountId)}&action=${encodeURIComponent(action)}`,
      undefined,
      signal,
    ),

  moonmarketRevalidatePositions: (accountId: string, signal?: AbortSignal) =>
    request<MoonMarketPositionsRevalidateResponse>(
      "POST",
      `/moonmarket/accounts/${encodeURIComponent(accountId)}/positions/revalidate`,
      undefined,
      signal,
    ),

  moonmarketOrderRules: (accountId: string, conid: number, side: MoonMarketOrderSide, signal?: AbortSignal) =>
    request<MoonMarketOrderRulesResponse>(
      "GET",
      `/moonmarket/accounts/${encodeURIComponent(accountId)}/contracts/${conid}/order-rules?side=${encodeURIComponent(side)}`,
      undefined,
      signal,
    ),

  moonmarketPreviewOrder: (body: MoonMarketOrderPreviewRequest, signal?: AbortSignal) =>
    request<MoonMarketOrderActionResponse>("POST", "/moonmarket/orders/preview", body, signal),

  moonmarketPlaceOrders: (body: MoonMarketOrdersRequest, signal?: AbortSignal) =>
    request<MoonMarketOrderActionResponse>("POST", "/moonmarket/orders", body, signal),

  moonmarketReplyOrder: (accountId: string, replyId: string, confirmed: boolean, signal?: AbortSignal) =>
    request<MoonMarketOrderActionResponse>(
      "POST",
      `/moonmarket/orders/${encodeURIComponent(accountId)}/reply/${encodeURIComponent(replyId)}`,
      { confirmed },
      signal,
    ),

  moonmarketCancelOrder: (accountId: string, orderId: string, signal?: AbortSignal) =>
    request<MoonMarketOrderActionResponse>(
      "DELETE",
      `/moonmarket/orders/${encodeURIComponent(accountId)}/${encodeURIComponent(orderId)}`,
      undefined,
      signal,
    ),

  moonmarketModifyOrder: (accountId: string, orderId: string, order: MoonMarketOrderDraft, signal?: AbortSignal) =>
    request<MoonMarketOrderActionResponse>(
      "PATCH",
      `/moonmarket/orders/${encodeURIComponent(accountId)}/${encodeURIComponent(orderId)}`,
      order,
      signal,
    ),

  moonmarketOptionExpirations: (underlyingConid: number, symbol: string, signal?: AbortSignal) =>
    request<MoonMarketOptionExpirationsResponse>(
      "GET",
      `/moonmarket/options/expirations/${underlyingConid}?symbol=${encodeURIComponent(symbol)}`,
      undefined,
      signal,
    ),

  moonmarketOptionChain: (underlyingConid: number, expiration: string, signal?: AbortSignal) =>
    request<MoonMarketOptionChainResponse>(
      "GET",
      `/moonmarket/options/chain/${underlyingConid}?expiration=${encodeURIComponent(expiration)}`,
      undefined,
      signal,
    ),

  moonmarketOptionContract: (underlyingConid: number, expiration: string, strike: number, signal?: AbortSignal) =>
    request<MoonMarketSingleOptionStrikeResponse>(
      "GET",
      `/moonmarket/options/contract/${underlyingConid}?expiration=${encodeURIComponent(expiration)}&strike=${encodeURIComponent(String(strike))}`,
      undefined,
      signal,
    ),

  moonmarketOptionWindow: (underlyingConid: number, expiration: string, strikes: number[], signal?: AbortSignal) => {
    const params = new URLSearchParams({ expiration });
    for (const strike of strikes) params.append("strikes", String(strike));
    return request<MoonMarketOptionWindowResponse>(
      "GET",
      `/moonmarket/options/window/${underlyingConid}?${params.toString()}`,
      undefined,
      signal,
    );
  },
}