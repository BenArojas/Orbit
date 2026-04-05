/**
 * Store barrel exports
 *
 * All Zustand stores. Import from "@/store" for convenience.
 *
 * Stores:
 *   navigation — active screen (dashboard/analysis/screener)
 *   chart      — active instrument, timeframe, indicators
 *   watchlist  — master + trigger watchlists, live quotes
 *   screener   — filter criteria, sort state
 *   settings   — app config persisted to SQLite
 *   ai         — Ollama status, chat session, signal, model selection
 */

export { useNavigationStore, type Screen } from "./navigation";
export {
  useChartStore,
  type Timeframe,
  type IndicatorId,
} from "./chart";
export {
  useWatchlistStore,
  type WatchlistItem,
  type WatchlistGroup,
} from "./watchlist";
export {
  useScreenerStore,
  type ScreenerFilter,
  type FilterOp,
  type SortDir,
} from "./screener";
export { useSettingsStore } from "./settings";
export {
  useAiStore,
  type OllamaState,
  type ChatMessage,
} from "./ai";
