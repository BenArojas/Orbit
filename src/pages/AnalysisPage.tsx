/**
 * Analysis Page — Charts, indicators, Fibonacci, AI panel
 *
 * Layout from mockup: grid with chart area + 340px AI panel
 *   Left: toolbar (symbol input, timeframe bar, indicator pills),
 *         main chart, sub-chart panels (RSI, MACD, etc.)
 *   Right: AI panel (config, signal card, chat) — Phase 4 tasks 4.7–4.9
 *
 * This page composes ChartContainer + useChartData. It owns:
 *   - Symbol search / resolution (input → conid lookup)
 *   - Timeframe switching (updates chart store)
 *   - Indicator pill toggles (task 4.6 will polish these)
 *   - Chart rendering delegation to ChartContainer
 */

import { useState, useMemo, type KeyboardEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { useChartStore, type Timeframe, type IndicatorId } from "@/store";
import { api } from "@/lib/api";
import { ChartContainer, SubChartPanel, SUB_CHART_BACKEND_NAMES, type SubChartType } from "@/components/charts";
import { useChartData } from "@/hooks/useChartData";

// ── Indicator metadata for pill toggles ──────────────────────

interface IndicatorMeta {
  id: IndicatorId;
  label: string;
  color: string; // CSS color for glow when active
  type: "overlay" | "oscillator" | "histogram" | "value" | "line";
}

const INDICATOR_LIST: IndicatorMeta[] = [
  { id: "ema9", label: "EMA 9", color: "var(--clr-cyan)", type: "overlay" },
  { id: "ema21", label: "EMA 21", color: "var(--clr-purple)", type: "overlay" },
  { id: "ema50", label: "EMA 50", color: "var(--clr-orange)", type: "overlay" },
  { id: "ema200", label: "EMA 200", color: "var(--clr-red)", type: "overlay" },
  { id: "bollinger", label: "BB", color: "var(--clr-blue)", type: "overlay" },
  { id: "vwap", label: "VWAP", color: "var(--clr-orange)", type: "overlay" },
  { id: "volume", label: "Vol", color: "var(--clr-blue)", type: "histogram" },
  { id: "rsi", label: "RSI", color: "var(--clr-purple)", type: "oscillator" },
  { id: "macd", label: "MACD", color: "var(--clr-cyan)", type: "oscillator" },
  { id: "stochastic", label: "Stoch", color: "var(--clr-green)", type: "oscillator" },
  { id: "obv", label: "OBV", color: "var(--clr-blue)", type: "line" },
  { id: "adx", label: "ADX", color: "var(--clr-orange)", type: "value" },
  { id: "atr", label: "ATR", color: "var(--clr-red)", type: "value" },
  { id: "fibonacci", label: "Fib", color: "var(--clr-green)", type: "overlay" },
];

const TIMEFRAMES: Timeframe[] = ["1m", "5m", "15m", "1h", "4h", "1D", "1W", "1M"];

/** Sub-chart indicator IDs → panel type mapping (module-level constant) */
const SUB_CHART_IDS: { id: IndicatorId; type: SubChartType }[] = [
  { id: "rsi", type: "rsi" },
  { id: "macd", type: "macd" },
  { id: "stochastic", type: "stochastic" },
  { id: "obv", type: "obv" },
  { id: "adx", type: "adx" },
];

/** Height in px for each sub-chart panel */
const SUB_CHART_HEIGHT = 100;

// ── Component ────────────────────────────────────────────────

export default function AnalysisPage() {
  const {
    activeConid,
    activeSymbol,
    timeframe,
    activeIndicators,
    setActiveConid,
    setActiveSymbol,
    setTimeframe,
    toggleIndicator,
  } = useChartStore();

  const [symbolInput, setSymbolInput] = useState(activeSymbol || "");
  const [inputFocused, setInputFocused] = useState(false);

  // Fetch chart data (candles + indicators + live tick)
  const {
    candles,
    indicators,
    fibonacci,
    liveTick,
    isLoading,
    error,
  } = useChartData(activeConid, timeframe, activeIndicators);

  // ── Active sub-chart panels (oscillators/line/value indicators) ──

  const activeSubCharts = useMemo(
    () =>
      SUB_CHART_IDS.filter(({ id }) => activeIndicators.has(id)).map(
        ({ type }) => type
      ),
    [activeIndicators],
  );

  // ── Symbol resolution (via useMutation per CLAUDE.md convention) ──

  const resolveConidMutation = useMutation({
    mutationFn: (sym: string) => api.resolveConid(sym),
    onSuccess: (result) => {
      setActiveConid(result.conid);
      setActiveSymbol(result.symbol);
      setSymbolInput(result.symbol);
    },
  });

  const resolveSymbol = () => {
    const sym = symbolInput.trim().toUpperCase();
    if (!sym || sym === activeSymbol) return;
    resolveConidMutation.mutate(sym);
  };

  const handleSymbolKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      resolveSymbol();
    }
  };

  return (
    <div className="grid h-full grid-cols-[1fr_340px]">
      {/* ── Chart area ── */}
      <div className="flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2.5 border-b border-border bg-[var(--bg-1)] px-3.5 py-2">
          {/* Symbol input — shows activeSymbol when blurred, raw input when focused */}
          <input
            type="text"
            placeholder="AAPL"
            value={inputFocused ? symbolInput : (symbolInput || activeSymbol)}
            onChange={(e) => setSymbolInput(e.target.value.toUpperCase())}
            onKeyDown={handleSymbolKeyDown}
            onFocus={() => setInputFocused(true)}
            onBlur={() => { setInputFocused(false); resolveSymbol(); }}
            className={`w-[90px] rounded-md border border-border bg-[var(--bg-0)] px-2.5 py-1.5 text-center text-sm font-bold text-foreground outline-none transition-all focus:border-[var(--clr-cyan)] focus:shadow-[0_0_12px_var(--glow-cyan)] ${
              resolveConidMutation.isPending ? "animate-pulse" : ""
            }`}
          />

          {/* Timeframe bar */}
          <div className="flex gap-px rounded-md border border-border bg-[var(--bg-0)] p-0.5">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={`rounded px-2.5 py-1 font-data text-[10px] font-medium transition-all ${
                  tf === timeframe
                    ? "bg-[var(--bg-4)] text-foreground shadow-[inset_0_0_8px_var(--glow-cyan)]"
                    : "text-[var(--text-3)] hover:text-[var(--text-2)]"
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          {/* Indicator pills */}
          <div className="flex flex-wrap gap-1">
            {INDICATOR_LIST.map((ind) => {
              const isActive = activeIndicators.has(ind.id);
              return (
                <button
                  key={ind.id}
                  onClick={() => toggleIndicator(ind.id)}
                  className="rounded-full border px-2 py-0.5 font-data text-[9px] font-medium transition-all"
                  style={{
                    borderColor: isActive ? ind.color : "var(--border)",
                    color: isActive ? ind.color : "var(--text-3)",
                    backgroundColor: isActive
                      ? `color-mix(in srgb, ${ind.color} 10%, transparent)`
                      : "transparent",
                    boxShadow: isActive
                      ? `0 0 8px color-mix(in srgb, ${ind.color} 20%, transparent)`
                      : "none",
                  }}
                >
                  {ind.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Main chart */}
        <div className="relative flex-1 bg-[var(--bg-0)]">
          {/* Subtle radial glow background */}
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_60%_30%,rgba(0,212,255,0.02),transparent_50%)]" />

          {activeConid && candles.length > 0 ? (
            <ChartContainer
              candles={candles}
              indicators={indicators}
              fibonacci={fibonacci}
              activeIndicators={activeIndicators}
              liveTick={liveTick}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              {isLoading ? (
                <div className="flex items-center gap-2 text-sm text-[var(--text-3)]">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--clr-cyan)] border-t-transparent" />
                  Loading chart data…
                </div>
              ) : error ? (
                <span className="text-sm text-[var(--clr-red)]">
                  Failed to load chart data
                </span>
              ) : (
                <span className="text-sm text-[var(--text-3)]">
                  {activeConid
                    ? "No data available"
                    : "Enter a symbol to begin analysis"}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Sub-chart panels — show only active oscillator/line/value indicators */}
        {activeSubCharts.length > 0 && (
          <div
            className="flex border-t border-border"
            style={{ height: activeSubCharts.length * SUB_CHART_HEIGHT }}
          >
            {activeSubCharts.map((type) => (
              <SubChartPanel
                key={type}
                type={type}
                indicator={indicators.find(
                  (ind) => ind.name === SUB_CHART_BACKEND_NAMES[type]
                )}
                height={SUB_CHART_HEIGHT}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── AI Panel (Phase 4 tasks 4.7–4.9) ── */}
      <div className="flex flex-col border-l border-border bg-[var(--bg-1)]">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold">
            <div className="h-2 w-2 rounded-full bg-[var(--clr-cyan)] shadow-[0_0_10px_var(--clr-cyan)] animate-glow" />
            AI Analysis
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center p-4">
          <span className="text-center text-xs text-[var(--text-3)]">
            AI panel — Phase 4
          </span>
        </div>
      </div>
    </div>
  );
}
