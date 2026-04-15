/**
 * Dashboard Components — barrel export
 *
 * All dashboard-specific components for Phase 3:
 *   - MarketPulse: top bar with market indices (task 3.1)
 *   - ArcGaugeRow: four arc gauges (task 3.2)
 *   - TriggerWatchlist: dynamic watchlist from trigger hits (task 3.6)
 *   - TriggerRules: compact rule list + create modal (task 3.7)
 */

export { default as MarketPulse } from "./MarketPulse";
export { default as ArcGaugeRow } from "./ArcGauge";
export { default as TriggerWatchlist } from "./TriggerWatchlist";
export { default as TriggerRules } from "./TriggerRules";
export { default as AlertLog } from "./AlertLog";
export { default as WatchlistConfigSection } from "./WatchlistConfigSection";
