/**
 * Store barrel exports
 *
 * All Zustand stores. Import from "@/store" for convenience.
 *
 * Stores:
 *   navigation — active screen (connection/today/market/analysis/screener/settings)
 *   chart      — active instrument, timeframe, indicators
 *   watchlist  — master + trigger watchlists, live quotes
 *   screener   — filter criteria, sort state
 *   settings   — app config persisted to SQLite
 *   pulseConfig — user-configurable Market Pulse ticker list (SQLite)
 *   ai         — Ollama status, chat session, signal, model selection
 */

export { useNavigationStore, type Screen } from "./navigation";
export {
  useChartStore,
  type Timeframe,
  type IndicatorId,
  type FibDrawMode,
  type FibDrawPoint,
} from "./chart";
export {
  useWatchlistStore,
  type WatchlistItem,
  type WatchlistGroup,
} from "./watchlist";
export {
  useScreenerStore,
  SCREENER_PAGE_SIZE,
  type ActiveFilter,
  type SortDir,
} from "./screener";
export { useSettingsStore } from "./settings";
export {
  usePulseConfigStore,
  DEFAULT_PULSE_ITEMS,
} from "./pulseConfig";
export {
  useAiStore,
  type OllamaState,
  type ChatMessage,
  type ResponseTimeSample,
} from "./ai";
export { useCrosshairStore } from "./crosshair";
export { useDrawingsStore, type DrawingToolId } from "./drawings";
export {
  useCompareStore,
  MAX_PANES as COMPARE_MAX_PANES,
  DEFAULT_REFERENCE as COMPARE_DEFAULT_REFERENCE,
  type Layout as CompareLayout,
  type ComparePane,
  type CompareReference,
} from "./compare";
