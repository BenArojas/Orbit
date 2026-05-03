/**
 * API client for the Parallax Python sidecar.
 *
 * All HTTP requests to the backend go through this module.
 * Components never call fetch() directly — they use TanStack Query
 * hooks that call these functions under the hood.
 *
 * Base URL points to the Python FastAPI sidecar running on localhost:8000.
 * In dev mode the frontend runs on :1420 (Vite) and proxies to :8000.
 * In production, Tauri launches the sidecar automatically.
 *
 * Hub integration:
 *   These types and endpoints will be shared when the Hub consolidates
 *   Parallax + MoonMarket into one sidecar. The base URL stays the same;
 *   MoonMarket endpoints will live under /moonmarket/* prefix.
 */

// ── Base URL ────────────────────────────────────────────────

import { API_BASE } from "@/config/endpoints";
import { ensureOnline, NetworkOfflineError, showOfflineToast } from "./network";

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
}

/** Hub integration: shared instrument cache — used by all Hub modules */
export interface Instrument {
  conid: number;
  symbol: string;
  company_name: string;
  sec_type: string;
  cached_at: string;
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

export interface TriggerRule {
  id: number;
  name: string;
  conid: number;
  symbol: string;
  indicator: string;
  condition: string;
  threshold: number;
  timeframe: string;
  target_watchlist: string;
  source_watchlist: string;
  auto_expire_days: number | null;
  scan_interval_seconds: number | null;
  news_candle_method: NewsCandleMethod | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface TriggerRuleCreate {
  name: string;
  conid: number;
  symbol: string;
  indicator: string;
  condition: string;
  threshold: number;
  target_watchlist: string;
  source_watchlist: string;
  timeframe?: string;
  auto_expire_days?: number | null;
  scan_interval_seconds?: number | null;
  news_candle_method?: NewsCandleMethod | null;
}

/** Mirrors backend TriggerRuleUpdate — only updatable fields, all optional */
export interface TriggerRuleUpdate {
  name?: string;
  indicator?: string;
  condition?: string;
  threshold?: number;
  conid?: number;
  symbol?: string;
  timeframe?: string;
  target_watchlist?: string;
  source_watchlist?: string;
  auto_expire_days?: number | null;
  scan_interval_seconds?: number | null;
  news_candle_method?: NewsCandleMethod | null;
  enabled?: boolean;
}

export interface WatchlistConfig {
  name: string;
  auto_expire_days: number | null;
  updated_at: string | null;
}

export interface WatchlistConfigUpdate {
  auto_expire_days: number | null;
}

export interface TriggerHit {
  id: number;
  rule_id: number;
  rule_name: string | null;
  conid: number;
  symbol: string;
  indicator: string;
  condition: string;
  threshold: number;
  actual_value: number;
  target_watchlist: string;
  source_watchlist: string;
  triggered_at: string;
  expires_at: string | null;
  moved_back: boolean;
  acknowledged: boolean;
}

export interface IndicatorRequest {
  conid: number;
  period?: string;
  indicators?: string[];
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
}

export interface IndicatorComputeResponse {
  conid: number;
  period: string;
  candles: CandleData[];
  indicators: IndicatorResult[];
  fibonacci: FibonacciResult | null;
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
  };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  try {
    const res = await fetch(url, options);
    const data = await res.json();

    if (!res.ok) {
      throw new ApiError(res.status, data);
    }
    return data as T;
  } catch (err) {
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
  quote: (conid: number) =>
    request<QuoteResponse>("GET", `/market/quote/${conid}`),

  candles: (conid: number, period = "3M") =>
    request<CandleData[]>("GET", `/market/candles/${conid}?period=${period}`),

  // Phase 8 / Task 3.1 — bundled endpoints for the pulse bar.
  // One request replaces N per-ticker requests; backend handles fan-out
  // and IBKR pacing internally.
  quotesBundled: (conids: number[]) =>
    request<QuotesBundledResponse>(
      "GET",
      `/market/quotes?conids=${conids.join(",")}`,
    ),

  candlesBundled: (conids: number[], period = "5D") =>
    request<CandlesBundledResponse>(
      "GET",
      `/market/candles?conids=${conids.join(",")}&period=${period}`,
    ),

  search: (query: string) =>
    request<SearchResult[]>("GET", `/market/search?q=${encodeURIComponent(query)}`),

  resolveConid: (symbol: string, secType?: string) => {
    const qs = secType ? `?sec_type=${encodeURIComponent(secType)}` : "";
    return request<ConidResponse>(
      "GET",
      `/market/conid/${encodeURIComponent(symbol)}${qs}`,
    );
  },

  // Indicators
  computeIndicators: (req: IndicatorRequest) =>
    request<IndicatorComputeResponse>("POST", "/indicators/compute", req),

  // Sectors (Phase 3)
  sectorPerformance: () =>
    request<SectorPerformance[]>("GET", "/sectors/performance"),

  sectorRRG: () =>
    request<RRGDataPoint[]>("GET", "/sectors/rrg"),

  sectorOverview: () =>
    request<SectorOverviewResponse>("GET", "/sectors/overview"),

  // Arc-gauge feeds (Phase 8 / Task 8.9)
  marketBreadth: () =>
    request<MarketBreadthResponse>("GET", "/sectors/breadth"),

  sectorRotation: () =>
    request<SectorRotationResponse>("GET", "/sectors/rotation"),

  // Watchlists (Phase 3)
  getWatchlists: () =>
    request<WatchlistInfo[]>("GET", "/watchlist/lists"),

  // Phase 8.9 / Commit C — split endpoints so the sidebar can render names
  // immediately and backfill prices on a slower second query.
  getWatchlistInstruments: (watchlistId: string) =>
    request<WatchlistInstrumentsResponse>(
      "GET",
      `/watchlist/${encodeURIComponent(watchlistId)}/instruments`,
    ),

  getWatchlistQuotes: (watchlistId: string, conids: number[]) =>
    request<WatchlistQuotesResponse>(
      "GET",
      `/watchlist/${encodeURIComponent(watchlistId)}/quotes?conids=${conids.join(",")}`,
    ),

  // Triggers (CRUD)
  getTriggerRules: () =>
    request<TriggerRule[]>("GET", "/triggers/rules"),

  createTriggerRule: (rule: TriggerRuleCreate) =>
    request<TriggerRule>("POST", "/triggers/rules", rule),

  updateTriggerRule: (id: number, updates: TriggerRuleUpdate) =>
    request<TriggerRule>("PATCH", `/triggers/rules/${id}`, updates),

  deleteTriggerRule: (id: number) =>
    request<void>("DELETE", `/triggers/rules/${id}`),

  getTriggerHits: (limit = 50) =>
    request<TriggerHit[]>("GET", `/triggers/hits?limit=${limit}`),

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

  aiAnalyze: (req: AnalyzeRequest) =>
    request<AnalyzeResponse>("POST", "/ai/analyze", req),

  aiChat: (req: ChatRequest) =>
    request<ChatResponse>("POST", "/ai/chat", req),

  // Fibonacci Locks (Phase 4)
  lockFibonacci: (req: LockFibonacciRequest) =>
    request<LockedFibonacciResponse>("POST", "/fibonacci/lock", req),

  unlockFibonacci: (id: number) =>
    request<{ deleted: boolean; id: number }>("DELETE", `/fibonacci/lock/${id}`),

  getLockedFibs: (conid: number) =>
    request<LockedFibonacciResponse[]>("GET", `/fibonacci/locks/${conid}`),

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
} as const;
