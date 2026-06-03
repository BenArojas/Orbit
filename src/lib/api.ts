/**
 * API client for the Orbit Python sidecar.
 *
 * All HTTP requests to the backend go through this module.
 * Components never call fetch() directly — they use TanStack Query
 * hooks that call these functions under the hood.
 *
 * Base URL points to the Python FastAPI sidecar running on localhost:8000.
 * In dev mode the frontend runs on :1420 (Vite) and proxies to :8000.
 * In production, Tauri launches the sidecar automatically.
 *
 * Orbit integration:
 *   These types and endpoints are shared by Orbit modules. The base URL stays
 *   the same; MoonMarket endpoints live under the /moonmarket/* prefix.
 */

// ── Base URL ────────────────────────────────────────────────

import { API_BASE } from "@/config/endpoints";
import { ensureOnline, NetworkOfflineError, showOfflineToast } from "./network";
import type { Timeframe } from "@/store/chart";

// ── Types ───────────────────────────────────────────────────
// Mirror the Pydantic models from backend/models/__init__.py.
// If you change a backend model, update the matching type here.

export interface HealthResponse {
  status: "ok" | "degraded";
  ibkr_connected: boolean;
  ibkr_authenticated: boolean;
  ws_ready: boolean;
  gateway_running: boolean;
  gateway_state: GatewayState;
  version: string;
}

// ── Gateway types ──────────────────────────────────────────

export type GatewayState =
  | "not_provisioned"
  | "downloading_jre"
  | "downloading_gw"
  | "provisioned"
  | "starting"
  | "running"
  | "stopping"
  | "error";

export interface GatewayProgress {
  step: string;
  bytes_downloaded: number;
  bytes_total: number;
  percent: number;
}

export interface GatewayStatusResponse {
  state: GatewayState;
  provisioned: boolean;
  running: boolean;
  authenticated: boolean;
  auth_required: boolean;
  auth_message: string;
  /** True when the session was previously authenticated but has since dropped. */
  session_dropped?: boolean;
  gateway_url: string;
  gateway_home: string;
  error: string | null;
  platform: string;
  progress?: GatewayProgress;
}

export interface AuthStatusResponse {
  authenticated: boolean;
  ws_ready: boolean;
  message: string;
}

export interface QuoteResponse {
  conid: number;
  symbol: string;
  companyName: string;
  lastPrice: number | null;
  bid: number | null;
  ask: number | null;
  bidSize: number | null;
  askSize: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  previousClose: number | null;
  changePercent: number | null;
  changeAmount: number | null;
  volume: number | null;
}

export interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SearchResult {
  conid: number;
  symbol: string;
  companyName: string;
  secType: string;
}

export interface ConidResponse {
  conid: number;
  symbol: string;
  /** Company name — populated when IBKR search finds it (may be empty string) */
  companyName?: string;
}

/** Cached instrument record returned by GET /instruments/{conid} */
export interface InstrumentCacheResponse {
  conid: number;
  symbol: string;
  company_name: string;
  sec_type: string;
  cached_at: string;
}

/** Orbit integration: shared instrument cache — used by all Orbit modules */
export interface Instrument {
  conid: number;
  symbol: string;
  company_name: string;
  sec_type: string;
  cached_at: string;
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
  status: string | null;
}

export interface MoonMarketLiveOrdersResponse {
  account_id: string;
  orders: MoonMarketLiveOrder[];
}

export type MoonMarketOrderSide = "BUY" | "SELL";
export type MoonMarketOrderType = "MKT" | "LMT" | "STP" | "STP_LIMIT" | "TRAIL";
export type MoonMarketTimeInForce = "DAY" | "GTC" | "IOC";
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
  cOID?: string;
  parentId?: string;
  isSingleGroup?: boolean;
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

// Inflect (trading journal)
export interface InflectJournalEntry {
  trade_id: string;
  account_id: string;
  conid: number;
  setup: string | null;
  notes: string | null;
  tags: string[];
  created_at: string | null;
  updated_at: string | null;
}

export interface InflectJournalUpsertRequest {
  setup: string | null;
  notes: string | null;
  tags: string[];
}

export interface InflectSetupsResponse {
  setups: string[];
}

export interface InflectFill {
  execution_id: string;
  conid: number;
  symbol: string | null;
  side: string;
  quantity: number;
  price: number | null;
  commission: number | null;
  net_amount: number | null;
  sec_type: string | null;
  multiplier: number | null;
  trade_time: string;
  trade_time_ms: number | null;
}

export interface InflectTrade {
  trade_id: string;
  account_id: string;
  conid: number;
  symbol: string;
  sec_type: string | null;
  direction: "LONG" | "SHORT" | "UNKNOWN";
  status: "OPEN" | "CLOSED" | "INCOMPLETE_BASIS";
  open_time: string;
  open_time_ms: number;
  close_time: string | null;
  close_time_ms: number | null;
  qty: number;
  avg_entry: number;
  avg_exit: number | null;
  gross_pnl: number | null;
  commissions: number;
  net_pnl: number | null;
  return_pct: number | null;
  hold_duration_sec: number | null;
  r_multiple: number | null;
  multiplier: number;
  fills: InflectFill[];
  journal_entry: InflectJournalEntry | null;
}

export interface InflectTradesResponse {
  account_id: string;
  trades: InflectTrade[];
}

export interface InflectCalendarDay {
  date: string;
  net_pnl: number;
  trade_count: number;
}

export interface InflectWeekRollup {
  week_index: number;
  net_pnl: number;
  trading_days: number;
}

export interface InflectCalendarResponse {
  account_id: string;
  year: number;
  month: number;
  days: InflectCalendarDay[];
  weeks: InflectWeekRollup[];
  total_net_pnl: number;
  days_traded: number;
}

export interface InflectSyncResponse {
  account_id: string;
  synced: number;
}

export type InflectTradeStatus = "OPEN" | "CLOSED" | "INCOMPLETE_BASIS";

export type InflectBackfillQueueStatus =
  | "pending"
  | "running"
  | "resolved"
  | "still_needs_basis"
  | "failed"
  | "rate_limited"
  | "max_days_rejected";

export interface InflectBackfillStatusItem {
  account_id: string;
  conid: number;
  status: InflectBackfillQueueStatus;
  attempts: number;
  days_used: number | null;
  last_checked_ms: number | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface InflectBackfillStatusResponse {
  account_id: string;
  items: InflectBackfillStatusItem[];
}

export interface BasisLot {
  id: number;
  account_id: string;
  conid: number;
  side: "LONG" | "SHORT";
  quantity: number;
  entry_date: string;
  entry_price: number;
  commission: number | null;
  note: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface BasisLotUpsertRequest {
  conid: number;
  side: "LONG" | "SHORT";
  quantity: number;
  entry_date: string;
  entry_price: number;
  commission?: number | null;
  note?: string | null;
}

export interface BasisAuditEntry {
  id: number;
  account_id: string;
  conid: number;
  action: string;
  source: string | null;
  before_json: string | null;
  after_json: string | null;
  created_at: string;
}

export interface BasisAuditResponse {
  account_id: string;
  conid: number;
  items: BasisAuditEntry[];
}

/**
 * news_candle detection methods (Phase 6.6). Only meaningful when
 * `indicator === "news_candle"`.
 */
export type NewsCandleMethod =
  | "volume_spike"
  | "range_spike"
  | "gap"
  | "long_wick";

export type TriggerCondition = {
  indicator: string;
  condition: "above" | "below" | "crosses_above" | "crosses_below" | "fires";
  threshold: number | null;
  news_candle_method?: "volume_spike" | "range_spike" | "gap" | "long_wick" | null;
};

export type TriggerRule = {
  id: number;
  name: string;
  enabled: boolean;
  timeframe: string;
  scan_interval_seconds: number;
  watchlist_name: string | null;
  conid: number | null;
  symbol: string | null;
  template_id: number | null;
  ibkr_mirror_target: string | null;
  conditions: TriggerCondition[];
  created_at: string;
  updated_at: string;
};

export type TriggerRuleCreate = Omit<TriggerRule, "id" | "created_at" | "updated_at">;

export type TriggerRuleUpdate = Partial<TriggerRuleCreate>;

export interface WatchlistConfig {
  name: string;
  auto_expire_days: number | null;
  updated_at: string | null;
}

export interface WatchlistConfigUpdate {
  auto_expire_days: number | null;
}

export type TriggerConditionValue = {
  indicator: string;
  condition: string;
  threshold: number | null;
  actual_value: number;
  news_candle_method?: string | null;
};

export type TriggerHit = {
  id: number;
  rule_id: number;
  rule_name: string | null;
  conid: number;
  symbol: string;
  triggered_at: string;
  watchlist_name: string | null;
  condition_values: TriggerConditionValue[];
  dismissed_at: string | null;
  snoozed_until: string | null;
  source_watchlist: string | null;
  target_watchlist: string | null;
  moved_back: boolean;
  expires_at: string | null;
};

export type RuleTemplate = {
  id: number;
  name: string;
  description: string | null;
  category: string;
  is_builtin: boolean;
  default_timeframe: string;
  conditions: TriggerCondition[];
  created_at: string;
};

export type StockTagMap = Record<
  number,
  { rule_id: number; rule_name: string; indicators: string[]; fired_at: string }[]
>;

export interface IndicatorRequest {
  conid: number;
  /** Frontend timeframe — backend maps to canonical IBKR (period, bar) via TIMEFRAME_SPEC */
  timeframe: Timeframe;
  indicators?: string[];
  /** @deprecated Use timeframe instead */
  period?: string;
  /** Override the backend's default history window. Accepts: "1M", "3M", "6M", "1Y", "2Y", "5Y". */
  history_period?: string;
}

export interface IndicatorValue {
  time: number;
  value: number | null;
  signal: number | null;
  histogram: number | null;
  upper: number | null;
  lower: number | null;
}

export interface IndicatorResult {
  name: string;
  type: "overlay" | "oscillator" | "histogram" | "value" | "line";
  values: IndicatorValue[];
  params: Record<string, number | string>;
}

export interface FibonacciLevel {
  level: number;
  price: number;
  label: string;
  kind: "retracement" | "extension";
  golden_pocket: boolean;
}

/**
 * Per-candidate status reflects whether the swing is currently tradeable.
 *
 *   - "active"     — current price is still inside the swing range
 *                    (with INSIDE_TOLERANCE band on the backend, default 0.15).
 *                    Only "active" candidates are eligible to become the
 *                    primary (rendered) fib.
 *   - "played_out" — price decisively moved past the 1.0 boundary. The
 *                    swing reached its target side — useful context, not
 *                    an entry candidate.
 *   - "broken"     — price decisively moved past the 0 boundary. The
 *                    swing was invalidated.
 *
 * See backend/services/indicators.py::INSIDE_TOLERANCE and
 * docs/fibonacci-improvements-plan.md (decisions 1A/1B).
 */
export type FibonacciCandidateStatus = "active" | "played_out" | "broken";

export interface FibonacciCandidate {
  swing_high: number;
  swing_low: number;
  swing_high_time: number;
  swing_low_time: number;
  direction: "up" | "down";
  score: number;
  swing_clarity: number;
  multi_touch_count: number;
  rejection_intensity: number;
  stretched_penalty: number;
  recency: number;
  is_nested: boolean;
  parent_index: number | null;
  status: FibonacciCandidateStatus;
}

export interface FibonacciConvergenceZone {
  price: number;
  timeframes: string[];
}

export interface FibonacciResult {
  tool_mode: "retracement" | "extension";
  swing_high: number;
  swing_low: number;
  swing_high_time: number;
  swing_low_time: number;
  direction: "up" | "down";
  /** Retracement levels (always computed) */
  levels: FibonacciLevel[];
  /** Extension levels (always computed) */
  extensions: FibonacciLevel[];
  score: number;
  swing_clarity: number;
  timeframe_clarity: "clean" | "choppy";
  candidates: FibonacciCandidate[];
  convergence_zones: FibonacciConvergenceZone[];
  is_nested: boolean;
  parent_fib_id: string | null;
  reasoning: string;
  source: "auto" | "manual" | "locked";
  /**
   * True when no candidate is currently inside any detected swing (with
   * the backend tolerance band). In this state `swing_high/swing_low/
   * levels/extensions` are placeholders copied from the highest-scored
   * historical candidate and MUST NOT be rendered as an authoritative
   * fib on the chart. The Candidates list (`candidates`) is still
   * populated so the user can pick a historical swing to study.
   */
  no_active_fib: boolean;
  /** Human-readable reason when `no_active_fib` is true. */
  no_active_fib_reason: string | null;
}

export interface IndicatorComputeResponse {
  conid: number;
  /** Echoed from request — lets the frontend verify cache correctness */
  timeframe: Timeframe;
  /** @deprecated Kept for backwards compat — use timeframe */
  period: string;
  candles: CandleData[];
  indicators: IndicatorResult[];
  fibonacci: FibonacciResult | null;
}

// ── Fibonacci Config (Branch 3) ─────────────────────────

/**
 * Server's canonical Fibonacci configuration.
 *
 *   - `ratios` is Ofek's retracement set (0, 0.382, 0.5, 0.618, 0.65,
 *     0.716, 1.0).
 *   - `extension_ratios` is the extension set (1.272 .. 4.618).
 *   - `weights` is the active scoring-weight vector. Defaults are
 *     served until the user PUTs an override.
 *
 * Frontend uses this as the single source of truth for ratios — the
 * client-side `buildLevelsFromCandidate` helper imports the ratio
 * arrays from here instead of duplicating them as a constant.
 */
export interface FibConfig {
  ratios: number[];
  extension_ratios: number[];
  weights: Record<FibFactorName, number>;
}

/** Canonical fib scoring factor names. Mirrors backend DEFAULT_FIB_WEIGHTS keys. */
export type FibFactorName =
  | "swing_clarity"
  | "multi_touch"
  | "rejection_intensity"
  | "stretched_penalty"
  | "recency";

export interface UpdateFibConfigRequest {
  weights: Record<FibFactorName, number>;
}

// ── Locked Fibonacci Drawings (Phase 4 — task 4.4) ──────

export interface LockFibonacciRequest {
  conid: number;
  timeframe: string;
  tool_type: "retracement" | "extension";
  swing_high_price: number;
  swing_high_time: number;
  swing_low_price: number;
  swing_low_time: number;
  direction: "up" | "down";
  user_note?: string;
}

export interface LockedFibonacciResponse {
  id: number;
  conid: number;
  timeframe: string;
  tool_type: "retracement" | "extension";
  swing_high_price: number;
  swing_high_time: number;
  swing_low_price: number;
  swing_low_time: number;
  direction: "up" | "down";
  user_note: string | null;
  locked_at: string;
}

// ── Chart Drawings (drawing-tools-plan.md Branch 1) ─────

/** Drawing kind strings — mirrors backend _VALID_KINDS set. */
export type DrawingKind =
  | "horizontal_line"
  | "trend_line"
  | "ray"
  | "rectangle"
  | "vertical_line"
  | "text"
  | "long_position"
  | "short_position"
  | "forecast"
  | "bars_pattern";

/** A single anchor point — position in time + price space. */
export interface DrawingAnchor {
  time: number;   // Unix seconds
  price: number;
}

/** Visual style for a drawing (all fields optional). */
export interface DrawingStylePayload {
  line_color?: string;    // Hex e.g. "#2962FF"
  line_width?: number;    // 1..4
  line_style?: "solid" | "dashed" | "dotted";
  fill_color?: string;
  text?: string;
}

/** A persisted drawing returned from the server. */
export interface Drawing {
  id: number;
  conid: number;
  kind: DrawingKind;
  anchors: DrawingAnchor[];
  style?: DrawingStylePayload | null;
  created_at: string;
  updated_at?: string | null;
}

/** POST /drawings request body. */
export interface CreateDrawingRequest {
  conid: number;
  kind: DrawingKind;
  anchors: DrawingAnchor[];
  style?: DrawingStylePayload;
}

/** PUT /drawings/{id} request body — partial update. */
export interface UpdateDrawingRequest {
  anchors?: DrawingAnchor[];
  style?: DrawingStylePayload;
}

// ── Sectors (Phase 3 — tasks 3.3, 3.4) ──────────────────

export interface SectorPerformance {
  symbol: string;
  name: string;
  conid: number;
  lastPrice: number | null;
  changePercent: number | null;
  ytdPercent: number | null;
}

export interface RRGTrailPoint {
  rs_ratio: number;
  rs_momentum: number;
}

export interface RRGDataPoint {
  symbol: string;
  name: string;
  rs_ratio: number;
  rs_momentum: number;
  quadrant: "leading" | "weakening" | "lagging" | "improving";
  trail: RRGTrailPoint[];
}

export interface SectorOverviewResponse {
  performance: SectorPerformance[];
  rrg: RRGDataPoint[];
}

// Arc-gauge feeds (Phase 8 / Task 8.9)

export interface MarketBreadthResponse {
  /** 0–100, % of sector ETFs above their 50-day EMA */
  value: number;
  above: number;
  total: number;
  etf_states: {
    symbol: string;
    above: boolean;
    close: number;
    ema50: number;
  }[];
}

export interface SectorRotationResponse {
  /** 0–100 gauge value (50 = neutral) */
  value: number;
  /** offensive_pct − defensive_pct, in percentage points */
  delta_pct: number;
  offensive_pct: number | null;
  defensive_pct: number | null;
  lookback_days: number;
  offensive: { symbol: string; pct: number | null }[];
  defensive: { symbol: string; pct: number | null }[];
}

// ── Watchlists (Phase 3 — task 3.5) ─────────────────────

export interface WatchlistInfo {
  id: string;
  name: string;
}

/**
 * A watchlist row combining instrument metadata with (optional) live quote.
 * The sidebar populates `symbol`/`companyName` from /instruments immediately,
 * then backfills `lastPrice`/`changePercent`/`changeAmount` from /quotes.
 */
export interface WatchlistItemResponse {
  conid: number;
  symbol: string;
  companyName: string;
  lastPrice: number | null;
  changePercent: number | null;
  changeAmount: number | null;
}

export interface WatchlistResponse {
  id: string;
  name: string;
  items: WatchlistItemResponse[];
}

// ── Phase 8.9 / Commit C: split endpoints ─────────────────
//
// `/watchlist/{id}/instruments` returns symbol + companyName only (fast).
// `/watchlist/{id}/quotes?conids=...` returns snapshot data keyed by conid.

export interface WatchlistInstrument {
  conid: number;
  symbol: string;
  companyName: string;
}

export interface WatchlistInstrumentsResponse {
  id: string;
  name: string;
  items: WatchlistInstrument[];
}

export interface WatchlistQuote {
  conid: number;
  lastPrice: number | null;
  changePercent: number | null;
  changeAmount: number | null;
}

export interface WatchlistQuotesResponse {
  items: WatchlistQuote[];
}

// ── AI Analysis (Phase 4 — tasks 4.9–4.12) ────────────────

export type AiContextMode = "none" | "summary" | "ohlcv" | "patterns";

export interface AnalyzeRequest {
  conid: number;
  symbol: string;
  timeframes: string[];
  indicators: string[];
  session_id?: string;
  /** Originating watchlist name (if any). Adds context to the AI prompt. */
  watchlist?: string;
  /** Ordered indicator priority — first = most important. Omit to let AI decide. */
  indicator_priority?: string[];
  /**
   * Chart context mode — controls what raw price history is appended to
   * the indicator context for each timeframe.
   *   "none"     — indicator values only (default, fastest)
   *   "summary"  — compact recent-closes + direction blurb (~+5% response time)
   *   "ohlcv"    — full OHLCV table for context_bars bars (~+25-40% response time)
   *   "patterns" — pre-computed candlestick patterns (~+10-15% response time)
   */
  context_mode?: AiContextMode;
  /** Number of bars to include when context_mode != "none" (5–30). */
  context_bars?: number;
  /** Active fibs currently rendered on the chart. */
  fibs?: FibonacciSnapshot[];
}

export interface FibonacciSnapshot {
  source: "auto" | "manual" | "locked";
  swing_high: number;
  swing_low: number;
  swing_high_time: number;
  swing_low_time: number;
  direction: "up" | "down";
  score?: number;
  is_primary: boolean;
  timeframe: string | null;
  note?: string;
}

export interface ChatRequest {
  session_id: string;
  message: string;
}

export interface SignalLevel {
  label: string;
  value: string;
  sub: string;
  color?: "green" | "red";
}

export interface SignalCheck {
  text: string;
  type: "confirm" | "caution";
}

export interface SignalMeta {
  label: string;
  value: string;
}

export interface SignalData {
  direction: "STRONG LONG" | "LONG" | "NEUTRAL" | "SHORT" | "STRONG SHORT";
  description: string;
  confidence: number;
  levels: SignalLevel[];
  meta: SignalMeta[];
  checks: SignalCheck[];
}

export interface AnalyzeResponse {
  session_id: string;
  signal: SignalData | null;
  message: string;
}

export interface ChatResponse {
  session_id: string;
  signal: SignalData | null;
  message: string;
}

export interface AiStatusResponse {
  state:
    | "not_installed"
    | "installed"
    | "starting"
    | "running"
    | "no_models"
    | "ready"
    | "error";
  selected_model: string | null;
  ready: boolean;
  error: string | null;
  platform: string;
}

export interface OllamaModelResponse {
  name: string;
  size_bytes: number;
  size_gb: number;
  family: string;
  parameter_size: string;
  quantization: string;
  modified_at: string;
}

export interface RecommendedModel {
  name: string;
  display_name: string;
  size_gb: number;
  min_ram_gb: number;
  description: string;
  pull_command: string;
  tier: "minimal" | "light" | "recommended" | "heavy";
}

export interface SetupGuideResponse {
  install_url: string;
  install_note: string;
  models_url: string;
  recommended_models: RecommendedModel[];
  pull_example: string;
}

export interface ModelSelectRequest {
  model: string;
}

// ── Screener (Phase 5 — tasks 5.1–5.6) ────────────────────

export interface ScannerPreset {
  instrument: string;
  scan_type: string;
  location: string;
  display_name: string;
  /** "popular" = always-visible section; "niche" = collapsed "More screens" */
  category?: "popular" | "niche";
  default_filters?: IbkrFilterItem[];
  /** Optional caveat shown next to the preset name in the UI
   *  (e.g. "Pre-market only" so users know why a scan returns 0 outside hours). */
  subtitle?: string | null;
  /** Path B: Live IBKR `instruments` array — which top-level instrument
   *  codes this scan_type supports (e.g. ["STK", "STOCK.HK", "STOCK.EU"]).
   *  Used by the Location dropdown to disable markets the scan can't run
   *  in. Joined in by the backend from /iserver/scanner/params. */
  instruments?: string[];
  /** Path B: Curated category key for grouping in the preset dropdown's
   *  "More screens" section AND in the Browse all scans panel (movers /
   *  highs_lows / pre_post_market / gaps / options_vol / fundamentals /
   *  special / etfs). */
  group?: string;
}

/** Curated Location dropdown option — instrument+location pair from
 *  GET /screener/locations. The instrument field MUST be sent to IBKR
 *  alongside the location code (sending instrument=STK with a non-US
 *  location returns 500 "No matching locations defined"). */
export interface ScannerLocation {
  instrument: string;
  location: string;
  label: string;
}

/** One scan type entry from GET /screener/all-scan-types — the full
 *  IBKR catalogue used by the "Browse all scans" panel. `is_curated`
 *  marks scan types that also appear as named presets in the main
 *  dropdown. */
export interface ScannerScanType {
  code: string;
  display_name: string;
  instruments: string[];
  /** Our category bucket key — matches the labels in the panel:
   *  movers / highs_lows / pre_post_market / gaps / options_vol /
   *  fundamentals / special / etfs / other. */
  group: string;
  is_curated: boolean;
}

/**
 * One entry from GET /screener/filter-catalogue.
 * Mirrors backend FilterCatalogueEntry. The frontend fetches this once per
 * session and hydrates the filter bar + quick-pick chips.
 *
 * `description` — same short guidance string Ollama sees in its system prompt.
 * Rendered as a native `title` tooltip on the Add Filter menu items so UI
 * guidance stays consistent with what the AI screener uses.
 */
export interface FilterCatalogueEntry {
  code: string;
  label: string;
  direction: "above" | "below";
  unit: string | null;
  example: string;
  category: "fundamental" | "technical" | "analyst" | "short_ownership";
  popular: boolean;
  description: string | null;
  paired_code: string; // opposite-direction code, or "" if none
}

/** A native IBKR scanner filter — passed directly to the scanner endpoint */
export interface IbkrFilterItem {
  code: string;   // IBKR filter code e.g. "marketCapAbove1e6", "minPeRatio"
  value: string;  // String value e.g. "1000", "5"
}

export interface ScanRequest {
  instrument?: string;
  scan_type?: string;
  location?: string;
  filters?: IbkrFilterItem[];
  max_results?: number;
  sort_field?: string;
  sort_direction?: "asc" | "desc";
  page?: number;
  page_size?: number;
}

export interface ScreenerResultRow {
  conid: number;
  symbol: string;
  company_name: string;
  sec_type: string;
  last_price: number | null;
  change_percent: number | null;
  volume: number | null;
  // Note: market_cap intentionally omitted — not reliably available via
  // /iserver/marketdata/snapshot. Quick-peek row (ContractInfoResponse) still
  // carries it because that comes from /iserver/contract/{conid}/info.
  /** Path B: IBKR's per-row scanner ranking metric. For TOP_PERC_GAIN
   *  it's the % change (redundant with change_percent), for
   *  FIRST_TRADE_DATE_ASC it's the next first-trade date. The table uses
   *  it as a price-column FALLBACK when last_price is null. */
  scan_data: string | null;
  /** IBKR's column header for scan_data, e.g. "First Trade Date". */
  scan_data_label: string | null;
}

export interface ScanResponse {
  results: ScreenerResultRow[];
  total_scanned: number;
  total_matched: number;
  scan_type: string;
  location: string;
  page: number;
  page_size: number;
  total_pages: number;
}

/** Contract details from IBKR — used in screener quick-peek slide-over */
export interface ContractInfoResponse {
  conid: number;
  symbol: string;
  company_name: string;
  sec_type: string;
  exchange: string;
  currency: string;
  industry: string;
  category: string;
  sector: string;           // Alias for category — broader grouping
  avg_volume: number | null;
  market_cap: number | null;
  high_52w: number | null;
  low_52w: number | null;
  pe_ratio: number | null;
  dividend_yield: number | null;
  // 52-week positioning (derived from 1y daily history)
  w52_pct_from_high: number | null;
  w52_pct_from_low: number | null;
  w52_days_since_high: number | null;
  // Relative performance (derived from 1y daily history)
  perf_5d: number | null;
  perf_1m: number | null;
  perf_3m: number | null;
  perf_ytd: number | null;
}

export interface ScannerParamsResponse {
  instruments: Record<string, unknown>[];
  locations: Record<string, unknown>[];
  scan_types: Record<string, unknown>[];
  filters: Record<string, unknown>[];
}

// ── AI Screener (Phase 5C) ────────────────────────────────────

export interface AiFilterRequest {
  query: string;
  model: string;
  preset_context?: string;
}

export interface AiFilterSuggestion {
  code: string;
  value: string;
  display_label: string;
  reasoning: string;
}

export interface AiFilterResponse {
  filters: AiFilterSuggestion[];
  summary: string;
  raw_query: string;
}

// ── Bundled market-data responses (Phase 8 / Task 3.1) ────────────────────
// Returned by GET /market/quotes?conids=... and GET /market/candles?conids=...

/** Bundled quote response — one item per requested conid. */
export interface QuotesBundledResponse {
  items: QuoteResponse[];
}

/** One candle series entry in the bundled candles response. */
export interface CandlesBundledItem {
  conid: number;
  candles: CandleData[];
}

/** Bundled candles response — one item per requested conid, plus any per-conid errors. */
export interface CandlesBundledResponse {
  items: CandlesBundledItem[];
  /** Keyed by conid (as string). Non-empty when one or more history fetches failed. */
  errors: Record<string, string>;
}

// ── Pulse Config (Phase 8.9+) ───────────────────────────────
// User-configurable ticker list for the dashboard's Market Pulse bar.

export interface PulseItem {
  label: string;
  resolve: string;
  /**
   * Optional IBKR secType hint — one of "", "STK", "IND", "BOND".
   * "" means "no hint" (resolver falls through STK → unfiltered).
   * Use "STK" to force an equity/ETF match (e.g. GLD as the ARCA
   * ETF rather than HKFE futures). Use "IND" for indices.
   */
  sec_type?: string;
}

export interface PulseConfigResponse {
  items: PulseItem[];
}

// ── API Error ───────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: Record<string, unknown>,
  ) {
    super(body.message as string || `API error ${status}`);
    this.name = "ApiError";
  }
}

// ── Core fetch helper ───────────────────────────────────────

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  // Phase 8.1-F — fast-fail if the browser already knows we're offline.
  // Skips the fetch + retry chain entirely and surfaces the toast
  // immediately rather than making the user wait ~3.5 s for the
  // backend's retry budget to drain.
  ensureOnline();

  const url = `${API_BASE}${path}`;
  const options: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
    signal,
  };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  try {
    const res = await fetch(url, options);
    let data: unknown;
    if (res.status !== 204) {
      try {
        data = await res.json();
      } catch (err) {
        if (res.ok) {
          return undefined as T;
        }
        data = {
          message:
            err instanceof Error
              ? err.message
              : `API error ${res.status}`,
        };
      }
    }

    if (!res.ok) {
      const body =
        data && typeof data === "object" && !Array.isArray(data)
          ? (data as Record<string, unknown>)
          : { message: `API error ${res.status}` };
      throw new ApiError(res.status, body);
    }
    return data as T;
  } catch (err) {
    // Caller cancelled the request (TanStack Query unmount, key supersession,
    // route change). Rethrow without the offline-check chain so cancellation
    // doesn't surface a misleading "you're offline" toast.
    if (err instanceof DOMException && err.name === "AbortError") {
      throw err;
    }
    // `fetch()` throws a TypeError on network failure (DNS, no route,
    // sidecar down, etc.). If we've since gone offline, upgrade the
    // error so retry logic skips it and the singleton toast fires.
    if (err instanceof TypeError && typeof navigator !== "undefined" && navigator.onLine === false) {
      showOfflineToast();
      throw new NetworkOfflineError();
    }
    throw err;
  }
}

// ── API functions ───────────────────────────────────────────
// Each function maps to one backend endpoint.
// TanStack Query hooks call these — components never call them directly.

// Health & Auth
export const api = {
  health: () => request<HealthResponse>("GET", "/health"),
  authStatus: () => request<AuthStatusResponse>("GET", "/auth/status"),
  logout: () => request<void>("POST", "/auth/logout"),

  // Market Data
  quote: (conid: number, signal?: AbortSignal) =>
    request<QuoteResponse>("GET", `/market/quote/${conid}`, undefined, signal),

  candles: (conid: number, period = "3M", signal?: AbortSignal) =>
    request<CandleData[]>("GET", `/market/candles/${conid}?period=${period}`, undefined, signal),

  // Phase 8 / Task 3.1 — bundled endpoints for the pulse bar.
  // One request replaces N per-ticker requests; backend handles fan-out
  // and IBKR pacing internally.
  quotesBundled: (conids: number[], signal?: AbortSignal) =>
    request<QuotesBundledResponse>(
      "GET",
      `/market/quotes?conids=${conids.join(",")}`,
      undefined,
      signal,
    ),

  candlesBundled: (conids: number[], period = "5D", signal?: AbortSignal) =>
    request<CandlesBundledResponse>(
      "GET",
      `/market/candles?conids=${conids.join(",")}&period=${period}`,
      undefined,
      signal,
    ),

  search: (query: string, signal?: AbortSignal) =>
    request<SearchResult[]>("GET", `/market/search?q=${encodeURIComponent(query)}`, undefined, signal),

  resolveConid: (symbol: string, secType?: string, signal?: AbortSignal) => {
    const qs = secType ? `?sec_type=${encodeURIComponent(secType)}` : "";
    return request<ConidResponse>(
      "GET",
      `/market/conid/${encodeURIComponent(symbol)}${qs}`,
      undefined,
      signal,
    );
  },

  /** Fetch a cached instrument record by conid. Returns null if not cached. */
  getInstrument: (conid: number, signal?: AbortSignal) =>
    request<InstrumentCacheResponse | null>("GET", `/instruments/${conid}`, undefined, signal),

  // MoonMarket
  moonmarketAccounts: (signal?: AbortSignal) =>
    request<MoonMarketAccountsResponse>("GET", "/moonmarket/accounts", undefined, signal),

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

  // Inflect (trading journal)
  inflectSetups: (signal?: AbortSignal) =>
    request<InflectSetupsResponse>("GET", "/inflect/setups", undefined, signal),

  inflectCalendar: (year: number, month: number, accountId?: string, signal?: AbortSignal) => {
    const params = new URLSearchParams({ year: String(year), month: String(month) });
    if (accountId) params.set("account_id", accountId);
    return request<InflectCalendarResponse>("GET", `/inflect/calendar?${params.toString()}`, undefined, signal);
  },

  inflectTrades: (
    opts: { accountId?: string; from?: number; to?: number; status?: InflectTradeStatus } = {},
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams();
    if (opts.accountId) params.set("account_id", opts.accountId);
    if (opts.from != null) params.set("from", String(opts.from));
    if (opts.to != null) params.set("to", String(opts.to));
    if (opts.status) params.set("status", opts.status);
    const qs = params.toString();
    return request<InflectTradesResponse>("GET", `/inflect/trades${qs ? `?${qs}` : ""}`, undefined, signal);
  },

  inflectTrade: (tradeId: string, accountId?: string, signal?: AbortSignal) => {
    const qs = accountId ? `?account_id=${encodeURIComponent(accountId)}` : "";
    return request<InflectTrade>("GET", `/inflect/trades/${encodeURIComponent(tradeId)}${qs}`, undefined, signal);
  },

  inflectSaveJournal: (
    tradeId: string,
    body: InflectJournalUpsertRequest,
    accountId?: string,
    signal?: AbortSignal,
  ) => {
    const qs = accountId ? `?account_id=${encodeURIComponent(accountId)}` : "";
    return request<InflectJournalEntry>(
      "PUT",
      `/inflect/trades/${encodeURIComponent(tradeId)}/journal${qs}`,
      body,
      signal,
    );
  },

  inflectSync: (accountId?: string, signal?: AbortSignal) => {
    const qs = accountId ? `?account_id=${encodeURIComponent(accountId)}` : "";
    return request<InflectSyncResponse>("POST", `/inflect/sync${qs}`, undefined, signal);
  },

  inflectBackfillStatus: (
    opts: { accountId: string; conid?: number },
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams({ account_id: opts.accountId });
    if (opts.conid != null) params.set("conid", String(opts.conid));
    return request<InflectBackfillStatusResponse>(
      "GET",
      `/inflect/backfill-status?${params.toString()}`,
      undefined,
      signal,
    );
  },

  inflectBasisLots: (
    opts: { accountId: string; conid: number },
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams({
      account_id: opts.accountId,
      conid: String(opts.conid),
    });
    return request<BasisLot[]>(
      "GET",
      `/inflect/basis-lots?${params.toString()}`,
      undefined,
      signal,
    );
  },

  inflectCreateBasisLot: (accountId: string, body: BasisLotUpsertRequest) =>
    request<BasisLot>(
      "POST",
      `/inflect/basis-lots?account_id=${encodeURIComponent(accountId)}`,
      body,
    ),

  inflectUpdateBasisLot: (lotId: number, accountId: string, body: BasisLotUpsertRequest) =>
    request<BasisLot>(
      "PUT",
      `/inflect/basis-lots/${lotId}?account_id=${encodeURIComponent(accountId)}`,
      body,
    ),

  inflectDeleteBasisLot: (lotId: number, accountId: string) =>
    request<{ deleted: boolean }>(
      "DELETE",
      `/inflect/basis-lots/${lotId}?account_id=${encodeURIComponent(accountId)}`,
    ),

  inflectBasisAudit: (
    opts: { accountId: string; conid: number },
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams({
      account_id: opts.accountId,
      conid: String(opts.conid),
    });
    return request<BasisAuditResponse>(
      "GET",
      `/inflect/basis-audit?${params.toString()}`,
      undefined,
      signal,
    );
  },

  // Indicators
  computeIndicators: (req: IndicatorRequest, signal?: AbortSignal) =>
    request<IndicatorComputeResponse>("POST", "/indicators/compute", req, signal),

  // Sectors (Phase 3)
  sectorPerformance: (signal?: AbortSignal) =>
    request<SectorPerformance[]>("GET", "/sectors/performance", undefined, signal),

  sectorRRG: (signal?: AbortSignal) =>
    request<RRGDataPoint[]>("GET", "/sectors/rrg", undefined, signal),

  sectorOverview: (signal?: AbortSignal) =>
    request<SectorOverviewResponse>("GET", "/sectors/overview", undefined, signal),

  // Arc-gauge feeds (Phase 8 / Task 8.9)
  marketBreadth: (signal?: AbortSignal) =>
    request<MarketBreadthResponse>("GET", "/sectors/breadth", undefined, signal),

  sectorRotation: (signal?: AbortSignal) =>
    request<SectorRotationResponse>("GET", "/sectors/rotation", undefined, signal),

  // Watchlists (Phase 3)
  getWatchlists: (signal?: AbortSignal) =>
    request<WatchlistInfo[]>("GET", "/watchlist/lists", undefined, signal),

  createWatchlist: (name: string) =>
    request<{ id: string; name: string }>("POST", "/watchlist/lists", { name }),

  deleteWatchlist: (watchlistId: string) =>
    request<void>("DELETE", `/watchlist/lists/${encodeURIComponent(watchlistId)}`),

  // Phase 8.9 / Commit C — split endpoints so the sidebar can render names
  // immediately and backfill prices on a slower second query.
  getWatchlistInstruments: (watchlistId: string, signal?: AbortSignal) =>
    request<WatchlistInstrumentsResponse>(
      "GET",
      `/watchlist/${encodeURIComponent(watchlistId)}/instruments`,
      undefined,
      signal,
    ),

  getWatchlistQuotes: (watchlistId: string, conids: number[], signal?: AbortSignal) =>
    request<WatchlistQuotesResponse>(
      "GET",
      `/watchlist/${encodeURIComponent(watchlistId)}/quotes?conids=${conids.join(",")}`,
      undefined,
      signal,
    ),

  watchlistAddInstrument: (watchlistId: string, conid: number) =>
    request<{ added: boolean; conid: number }>(
      "POST",
      `/watchlist/${encodeURIComponent(watchlistId)}/instruments`,
      { conid },
    ),

  watchlistRemoveInstrument: (watchlistId: string, conid: number) =>
    request<{ removed: boolean; conid: number }>(
      "DELETE",
      `/watchlist/${encodeURIComponent(watchlistId)}/instruments/${conid}`,
    ),

  watchlistMembership: (conid: number) =>
    request<{ conid: number; watchlist_ids: string[] }>(
      "GET",
      `/watchlist/membership?conid=${conid}`,
    ),

  // Triggers (CRUD)
  getTriggerRules: () =>
    request<TriggerRule[]>("GET", "/triggers/rules"),

  createTriggerRule: (rule: TriggerRuleCreate) =>
    request<TriggerRule>("POST", "/triggers/rules", rule),

  updateTriggerRule: (id: number, patch: TriggerRuleUpdate) =>
    request<TriggerRule>("PATCH", `/triggers/rules/${id}`, patch),

  deleteTriggerRule: (id: number) =>
    request<void>("DELETE", `/triggers/rules/${id}`),

  getTriggerHits: (
    opts: {
      limit?: number;
      status?: "active" | "dismissed" | "snoozed" | "all";
      watchlist?: string;
    } = {},
  ) => {
    const params = new URLSearchParams();
    if (opts.limit != null) params.set("limit", String(opts.limit));
    if (opts.status) params.set("status", opts.status);
    if (opts.watchlist) params.set("watchlist", opts.watchlist);
    const q = params.toString();
    return request<TriggerHit[]>("GET", `/triggers/hits${q ? `?${q}` : ""}`);
  },

  dismissTriggerHit: (id: number) =>
    request<void>("POST", `/triggers/hits/${id}/dismiss`),

  snoozeTriggerHit: (id: number, duration_minutes: number) =>
    request<void>("POST", `/triggers/hits/${id}/snooze`, { duration_minutes }),

  getStockTags: (conids: number[], signal?: AbortSignal) =>
    request<StockTagMap>(
      "GET",
      `/triggers/tags?conids=${conids.join(",")}`,
      undefined,
      signal,
    ),

  getRuleTemplates: () =>
    request<RuleTemplate[]>("GET", "/triggers/templates"),

  createRuleTemplate: (tpl: {
    name: string;
    description?: string | null;
    category?: string;
    default_timeframe?: string;
    conditions: TriggerCondition[];
  }) => request<RuleTemplate>("POST", "/triggers/templates", tpl),

  deleteRuleTemplate: (id: number) =>
    request<void>("DELETE", `/triggers/templates/${id}`),

  // Watchlist Config (Phase 6.8) — per-target-watchlist expiry override
  getWatchlistConfigs: () =>
    request<WatchlistConfig[]>("GET", "/watchlist-config"),

  getWatchlistConfig: (name: string) =>
    request<WatchlistConfig>("GET", `/watchlist-config/${encodeURIComponent(name)}`),

  putWatchlistConfig: (name: string, body: WatchlistConfigUpdate) =>
    request<WatchlistConfig>("PUT", `/watchlist-config/${encodeURIComponent(name)}`, body),

  deleteWatchlistConfig: (name: string) =>
    request<void>("DELETE", `/watchlist-config/${encodeURIComponent(name)}`),

  // AI Analysis (Phase 4)
  aiStatus: () =>
    request<AiStatusResponse>("GET", "/ai/status"),

  aiModels: () =>
    request<OllamaModelResponse[]>("GET", "/ai/models"),

  aiSelectModel: (req: ModelSelectRequest) =>
    request<AiStatusResponse>("POST", "/ai/models/select", req),

  aiSetupGuide: () =>
    request<SetupGuideResponse>("GET", "/ai/setup-guide"),

  aiRefresh: () =>
    request<AiStatusResponse>("POST", "/ai/refresh"),

  aiWarmup: () =>
    request<void>("POST", "/ai/warmup"),

  aiAnalyze: (req: AnalyzeRequest) =>
    request<AnalyzeResponse>("POST", "/ai/analyze", req),

  aiChat: (req: ChatRequest) =>
    request<ChatResponse>("POST", "/ai/chat", req),

  // Fibonacci Locks (Phase 4)
  lockFibonacci: (req: LockFibonacciRequest) =>
    request<LockedFibonacciResponse>("POST", "/fibonacci/lock", req),

  unlockFibonacci: (id: number) =>
    request<{ deleted: boolean; id: number }>("DELETE", `/fibonacci/lock/${id}`),

  clearLockedFibs: (conid: number) =>
    request<{ deleted: number; conid: number }>("DELETE", `/fibonacci/locks/${conid}`),

  getLockedFibs: (conid: number) =>
    request<LockedFibonacciResponse[]>("GET", `/fibonacci/locks/${conid}`),

  // Fibonacci Config (Branch 3) — canonical ratios + user-editable
  // scoring weights. Frontend caches once per session.
  getFibConfig: () =>
    request<FibConfig>("GET", "/fibonacci/config"),

  updateFibConfig: (req: UpdateFibConfigRequest) =>
    request<FibConfig>("PUT", "/fibonacci/config", req),

  // Pulse Config (Phase 8.9+) — user-configurable Market Pulse tickers
  getPulseConfig: () =>
    request<PulseConfigResponse>("GET", "/pulse-config"),

  setPulseConfig: (items: PulseItem[]) =>
    request<PulseConfigResponse>("PUT", "/pulse-config", { items }),

  resetPulseConfig: () =>
    request<PulseConfigResponse>("POST", "/pulse-config/reset"),

  // Screener (Phase 5)
  screenerScan: (req: ScanRequest) =>
    request<ScanResponse>("POST", "/screener/scan", req),

  screenerPresets: () =>
    request<ScannerPreset[]>("GET", "/screener/presets"),

  /** Curated Location dropdown options — instrument+location pairs from
   *  the backend (single source of truth for region selection). */
  screenerLocations: () =>
    request<ScannerLocation[]>("GET", "/screener/locations"),

  /** Full IBKR scan-type catalogue with our category bucketing — powers
   *  the "Browse all scans" slide-over panel. */
  screenerAllScanTypes: () =>
    request<ScannerScanType[]>("GET", "/screener/all-scan-types"),

  /** Canonical filter catalogue — fetched once per session, staleTime 1h */
  screenerFilterCatalogue: () =>
    request<FilterCatalogueEntry[]>("GET", "/screener/filter-catalogue"),

  screenerParams: () =>
    request<ScannerParamsResponse>("GET", "/screener/params"),

  screenerContractInfo: (conid: number) =>
    request<ContractInfoResponse>("GET", `/screener/contract/${conid}`),

  screenerAiFilters: (req: AiFilterRequest) =>
    request<AiFilterResponse>("POST", "/screener/ai-filters", req),

  // Gateway (IBKR Client Portal lifecycle)
  gatewayStatus: () =>
    request<GatewayStatusResponse>("GET", "/gateway/status"),

  gatewayProvision: (force = false) =>
    request<GatewayStatusResponse>("POST", `/gateway/provision?force=${force}`),

  gatewayStart: () =>
    request<GatewayStatusResponse>("POST", "/gateway/start"),

  gatewayStop: () =>
    request<GatewayStatusResponse>("POST", "/gateway/stop"),

  gatewayReprovision: () =>
    request<GatewayStatusResponse>("POST", "/gateway/reprovision"),

  // R1 — soft logout: POST IBKR /v1/api/logout, drop session, leave JVM alive.
  // Fastest recovery (~1 s); user can re-login immediately without a Java cold start.
  gatewayLogout: () =>
    request<GatewayStatusResponse>("POST", "/gateway/logout"),

  // R2 — stop tickle + WS + gateway, clear in-memory state, restart gateway.
  // Files on disk are untouched.
  gatewayResetSession: () =>
    request<GatewayStatusResponse>("POST", "/gateway/reset-session"),

  // R3 — reset-session + delete root/logs, root/Jts, *.cookie, *.session.
  // Preserves the JRE, Gateway binaries, and conf.yaml.
  gatewayFactoryReset: () =>
    request<GatewayStatusResponse>("POST", "/gateway/factory-reset"),

  // Chart Drawings (drawing-tools-plan.md Branch 1)
  createDrawing: (req: CreateDrawingRequest) =>
    request<Drawing>("POST", "/drawings", req),

  updateDrawing: (id: number, req: UpdateDrawingRequest) =>
    request<Drawing>("PUT", `/drawings/${id}`, req),

  deleteDrawing: (id: number) =>
    request<{ deleted: boolean; id: number }>("DELETE", `/drawings/${id}`),

  getDrawings: (conid: number) =>
    request<Drawing[]>("GET", `/drawings/${conid}`),
} as const;
