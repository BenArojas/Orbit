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

const API_BASE = "http://localhost:8000";

// ── Types ───────────────────────────────────────────────────
// Mirror the Pydantic models from backend/models/__init__.py.
// If you change a backend model, update the matching type here.

export interface HealthResponse {
  status: "ok" | "degraded";
  ibkr_connected: boolean;
  ibkr_authenticated: boolean;
  ws_ready: boolean;
  version: string;
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
  enabled?: boolean;
}

export interface TriggerHit {
  id: number;
  rule_id: number;
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
}

export interface FibonacciResult {
  swing_high: number;
  swing_low: number;
  swing_high_time: number;
  swing_low_time: number;
  levels: FibonacciLevel[];
  trend: "up" | "down";
}

export interface IndicatorComputeResponse {
  conid: number;
  period: string;
  candles: CandleData[];
  indicators: IndicatorResult[];
  fibonacci: FibonacciResult | null;
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

// ── Watchlists (Phase 3 — task 3.5) ─────────────────────

export interface WatchlistInfo {
  id: string;
  name: string;
}

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

// ── AI Analysis (Phase 4 — tasks 4.9–4.12) ────────────────

export interface AnalyzeRequest {
  conid: number;
  symbol: string;
  timeframes: string[];
  indicators: string[];
  session_id?: string;
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
  const url = `${API_BASE}${path}`;
  const options: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(url, options);
  const data = await res.json();

  if (!res.ok) {
    throw new ApiError(res.status, data);
  }
  return data as T;
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

  search: (query: string) =>
    request<SearchResult[]>("GET", `/market/search?q=${encodeURIComponent(query)}`),

  resolveConid: (symbol: string) =>
    request<ConidResponse>("GET", `/market/conid/${encodeURIComponent(symbol)}`),

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

  // Watchlists (Phase 3)
  getWatchlists: () =>
    request<WatchlistInfo[]>("GET", "/watchlist/lists"),

  getWatchlistItems: (watchlistId: string) =>
    request<WatchlistResponse>("GET", `/watchlist/${encodeURIComponent(watchlistId)}`),

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
} as const;
