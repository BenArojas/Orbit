/**
 * chartTheme — reads CSS variables from :root at runtime.
 *
 * Called at chart-create time and re-called when the theme class on
 * <html> changes. Keeps chart colours aligned with the UI theme without
 * hardcoding dark-only values in the chart options.
 *
 * CSS variables resolved (both dark and light palettes are defined in
 * styles.css under :root and :root.light):
 *   --bg-0        chart background
 *   --chart-grid  subtle grid line colour
 *   --text-3      axis label colour
 *   --border      price/time scale border
 *   --clr-green   bullish candle colour (neon in dark, muted in light)
 *   --clr-red     bearish candle colour (neon in dark, muted in light)
 */

export interface ChartThemeColors {
  bg: string;
  gridLines: string;
  text: string;
  borderColor: string;
  /** Bullish candle body/wick colour */
  upColor: string;
  /** Bearish candle body/wick colour */
  downColor: string;
}

/** Read the current theme colors from CSS custom properties. */
export function readChartTheme(): ChartThemeColors {
  const cs = getComputedStyle(document.documentElement);
  return {
    bg:          cs.getPropertyValue("--bg-0").trim(),
    gridLines:   cs.getPropertyValue("--chart-grid").trim(),
    text:        cs.getPropertyValue("--text-3").trim(),
    borderColor: cs.getPropertyValue("--border").trim(),
    upColor:     cs.getPropertyValue("--clr-green").trim() || "#00ff88",
    downColor:   cs.getPropertyValue("--clr-red").trim()   || "#ff4466",
  };
}
