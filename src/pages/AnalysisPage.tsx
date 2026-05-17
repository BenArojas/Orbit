/**
 * Analysis Page — Charts, indicators, Fibonacci, AI panel
 *
 * Composes Phase 4 components:
 *   - ChartContainer (4.1) — Lightweight Charts candlestick + volume
 *   - Indicator overlays (4.2) — EMA, Bollinger, VWAP on main chart
 *   - SubChartPanel (4.3) — RSI, MACD, Stochastic, OBV, ADX below chart
 *   - IndicatorToolbar (4.6) — pill toggles in the toolbar
 *   - AiChatPanel (4.9) — full AI panel (config, signal, chat, setup guide)
 *   - FibonacciOverlay (4.4) — auto-detected fib levels on chart + FibScoreCard in AI panel
 *   - FibDrawMode (4.5) — two-click manual fib drawing with ghost preview
 *
 * Layout from mockup: grid with chart area + 340px AI panel
 *   Left: toolbar (symbol input, timeframe bar, indicator pills),
 *         main chart, sub-chart panels (RSI, MACD, etc.)
 *   Right: AI panel (handles its own state via Zustand AI store)
 *
 * This page composes ChartContainer + useChartData. It owns:
 *   - Symbol search / resolution (input → conid lookup via useMutation)
 *   - Timeframe switching (updates chart store)
 *   - Chart rendering delegation to ChartContainer
 */

import { useState, useMemo, useEffect, useRef, useCallback, type KeyboardEvent } from "react";
import { Maximize2 } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { useChartStore, useAiStore, type Timeframe, type IndicatorId } from "@/store";
import { useDrawingsStore } from "@/store/drawings";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { ChartContainer, SubChartPanel, AtrBadge, DrawingToolbar, SUB_CHART_BACKEND_NAMES, type SubChartType } from "@/components/charts";
import { useChartData } from "@/hooks/useChartData";
import { useInstrument } from "@/hooks/useInstrument";
import { useLockedFibs } from "@/hooks/useLockedFibs";
import { IndicatorToolbar } from "@/components/indicators";
import { RightSidebar } from "@/components/ai";
import { SHORTCUT_MAP } from "@/components/charts/drawingsRegistry";

// ── Constants ────────────────────────────────────────────────

const TIMEFRAMES: Timeframe[] = ["1m", "5m", "15m", "1h", "4h", "1D", "1W", "1M"];

/** Sub-chart indicator IDs → panel type mapping (module-level constant) */
const SUB_CHART_IDS: { id: IndicatorId; type: SubChartType }[] = [
  { id: "rsi", type: "rsi" },
  { id: "macd", type: "macd" },
  { id: "stochastic", type: "stochastic" },
  { id: "obv", type: "obv" },
  { id: "adx", type: "adx" },
];

// Note: each SubChartPanel sets its own 120px height internally (see
// PANEL_HEIGHT in SubChartPanel.tsx). The wrapper here uses flex-1 with
// overflow-y-auto so 4–5 panels scroll within the bottom region instead of
// pushing the main chart and toolbar off-screen.

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
    fibDrawMode,
    enterFibDrawMode,
    exitFibDrawMode,
    toggleIndicator,
    requestResetZoom,
  } = useChartStore();

  const [symbolInput, setSymbolInput] = useState(activeSymbol || "");
  const [inputFocused, setInputFocused] = useState(false);

  // Sync symbol input whenever the store's activeSymbol changes externally
  // (e.g. navigateToAnalysis called from watchlist or screener).
  // Skip sync while the user is actively typing in the input.
  useEffect(() => {
    if (!inputFocused) {
      setSymbolInput(activeSymbol);
    }
  }, [activeSymbol, inputFocused]);

  // Pre-load the AI model into memory when the user navigates here.
  // Non-fatal: if Ollama isn't ready the warmup endpoint returns 204 silently.
  useEffect(() => {
    api.aiWarmup().catch(() => {/* non-fatal */});
  }, []);

  // Reset the AI chat (signal + messages + sessionId) whenever the user
  // switches to a different stock. We track the previous conid in a ref so
  // we can skip the very first render (otherwise reload would wipe state).
  const prevConidRef = useRef<number | null>(activeConid);
  const clearAiChat = useAiStore((s) => s.clearChat);
  useEffect(() => {
    if (prevConidRef.current !== null && prevConidRef.current !== activeConid) {
      clearAiChat();
    }
    prevConidRef.current = activeConid;
  }, [activeConid, clearAiChat]);

  // ── Drawing tool keyboard shortcuts ──────────────────────────
  //
  // H/T/R/S/V/X  — toggle the matching core tool
  // ESC          — exit any active drawing tool
  // Shortcuts are suppressed when the user is typing in the symbol input.

  const setDrawingTool = useDrawingsStore((s) => s.setActiveTool);
  const activeDrawingTool = useDrawingsStore((s) => s.activeTool);

  const handleDrawingShortcut = useCallback(
    (e: globalThis.KeyboardEvent) => {
      // Don't steal keypresses from input elements.
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (e.key === "Escape") {
        setDrawingTool(null);
        return;
      }
      const toolId = SHORTCUT_MAP[e.key.toUpperCase()];
      if (toolId) {
        // Toggle: pressing the same key again exits the tool.
        setDrawingTool(activeDrawingTool === toolId ? null : toolId);
      }
    },
    [setDrawingTool, activeDrawingTool],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleDrawingShortcut);
    return () => window.removeEventListener("keydown", handleDrawingShortcut);
  }, [handleDrawingShortcut]);

  // Fetch cached instrument metadata for the header badge + watermark
  const { companyName } = useInstrument(activeConid);

  // Mount the locked-fibs query at the page level so its merge side effect
  // (server locks → activeFibs in the chart store) always runs as long as the
  // page is open. Previously this hook was only mounted inside FibStackPanel,
  // which itself only renders when an auto-detected fib exists — so newly
  // locked fibs never reached the chart unless the user happened to already
  // have the indicator on with an active auto fib.
  useLockedFibs(activeConid);

  // Fetch chart data (candles + indicators + live tick)
  const {
    candles,
    indicators,
    fibonacci,
    liveTick,
    isLoading,
    isFetching,
    error,
  } = useChartData(activeConid, timeframe, activeIndicators);

  // Bug 1: surface `no_active_fib` to the user.
  //
  // When the backend reports there's no currently-active fib for this
  // (conid, timeframe), the indicator pill stays toggled on but nothing
  // renders on the chart. The user has no idea why. We toast once and
  // auto-untoggle the pill so the UI matches reality.
  //
  // The ref guard keys on `${conid}|${timeframe}` so we don't re-fire
  // on background refetches — only on a fresh "no active" result for a
  // new symbol/timeframe combination (or after a deliberate re-toggle,
  // since re-toggling triggers a refetch with the indicator in the key).
  const noActiveFibKeyRef = useRef<string | null>(null);
  useEffect(() => {
    // Don't fire while a fresh fetch is in flight — stale keepPreviousData
    // can still have no_active_fib: true from a previous result, which would
    // cause a re-toggle cascade before the new response arrives.
    if (isFetching) return;
    if (!activeIndicators.has("fibonacci")) {
      noActiveFibKeyRef.current = null;
      return;
    }
    if (!fibonacci?.no_active_fib) return;

    const key = `${activeConid}|${timeframe}`;
    if (noActiveFibKeyRef.current === key) return;
    noActiveFibKeyRef.current = key;

    const historicalCount = fibonacci.candidates?.length ?? 0;
    const symbolLabel = activeSymbol || "this symbol";
    toast.info(`No active Fibonacci setup for ${symbolLabel} on ${timeframe}`, {
      description:
        historicalCount > 0
          ? `${historicalCount} historical candidate${historicalCount === 1 ? "" : "s"} — none currently in play`
          : "No setups found",
    });
    toggleIndicator("fibonacci");
  }, [
    fibonacci,
    activeIndicators,
    activeConid,
    activeSymbol,
    timeframe,
    toggleIndicator,
    isFetching,
  ]);

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
    <div className="grid h-full min-h-0 grid-cols-[32px_1fr_340px]">
      {/* ── Drawing toolbar — left vertical rail ── */}
      <DrawingToolbar conid={activeConid} />

      {/* ── Center: Chart area ── */}
      <div className="flex min-h-0 flex-col overflow-hidden">
        {/* Toolbar — shrink-0 so it stays at its natural height when sub-panels
            are added below; otherwise flex squeezes it and only the bottom row
            of indicator/timeframe pills remains visible. */}
        <div className="flex shrink-0 flex-wrap items-center gap-2.5 border-b border-border bg-[var(--bg-1)] px-3.5 py-2">
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

          {/* Company name badge — shown after the timeframe bar */}
          {companyName && (
            <span className="max-w-[240px] truncate text-[10px] text-[var(--text-3)]">
              {companyName}
            </span>
          )}

          {/* Indicator pills (task 4.6 — Ofek's IndicatorToolbar) */}
          <IndicatorToolbar />

          {/* Reset zoom — re-fits the price axis and time scale to all loaded data */}
          <button
            onClick={requestResetZoom}
            title="Reset zoom"
            className="flex items-center justify-center rounded border border-border p-1.5 text-[var(--text-3)] transition-all hover:border-[var(--clr-cyan)] hover:text-[var(--clr-cyan)]"
          >
            <Maximize2 size={12} />
          </button>

          {/* ATR value badge — shown inline when ATR is toggled on */}
          {activeIndicators.has("atr") && (
            <AtrBadge indicators={indicators} />
          )}

          {/* Fib draw mode buttons (task 4.5) */}
          <div className="mx-1 h-5 w-px bg-[var(--border)]" />
          {fibDrawMode ? (
            <button
              onClick={exitFibDrawMode}
              className="rounded-full border border-[var(--clr-red)] bg-[rgba(255,68,102,0.1)] px-2.5 py-1 font-data text-[10px] font-medium text-[var(--clr-red)] transition-all hover:bg-[rgba(255,68,102,0.2)]"
            >
              Cancel Draw
            </button>
          ) : (
            <>
              <button
                onClick={() => enterFibDrawMode("retracement")}
                className="rounded-full border border-[var(--border)] px-2.5 py-1 font-data text-[10px] font-medium text-[var(--text-3)] transition-all hover:border-[var(--clr-green)] hover:text-[var(--clr-green)]"
                title="Draw Fibonacci retracement — click two points on the chart"
              >
                Draw Fib
              </button>
              <button
                onClick={() => enterFibDrawMode("extension")}
                className="rounded-full border border-[var(--border)] px-2.5 py-1 font-data text-[10px] font-medium text-[var(--text-3)] transition-all hover:border-[var(--clr-purple)] hover:text-[var(--clr-purple)]"
                title="Draw Fibonacci extension — click two points on the chart"
              >
                Draw Ext
              </button>
            </>
          )}
        </div>

        {/* Main chart — flex-[2] gives it twice the share of remaining space
            vs the sub-panel column below. min-h-[200px] guarantees the candle
            chart never shrinks to zero when 4–5 sub-panels are toggled on
            (which previously caused the candles to "disappear"). */}
        <div className="relative flex-[2] min-h-[200px] bg-[var(--bg-0)]">
          {/* Subtle radial glow background */}
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_60%_30%,rgba(0,212,255,0.02),transparent_50%)]" />

          {activeConid && candles.length > 0 ? (
            <ChartContainer
              candles={candles}
              indicators={indicators}
              fibonacci={fibonacci}
              activeIndicators={activeIndicators}
              liveTick={liveTick}
              conid={activeConid}
              timeframe={timeframe}
              symbol={activeSymbol || undefined}
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

        {/* Sub-chart panels — stacked vertically, one per active oscillator.
            The container takes flex-1 of the remaining (post-main-chart) space
            with min-h-0 + overflow-y-auto, so when many panels are toggled on
            (4–5) the area scrolls *internally* instead of pushing the toolbar
            off-screen or collapsing the main chart.
            Each SubChartPanel is shrink-0 with an explicit 120px height. */}
        {activeSubCharts.length > 0 && (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto border-t border-border">
            {activeSubCharts.map((type) => (
              <SubChartPanel
                key={type}
                type={type}
                indicator={indicators.find(
                  (ind) => ind.name === SUB_CHART_BACKEND_NAMES[type]
                )}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Right: tabbed sidebar (AI / Watchlists / Triggers) ── */}
      <RightSidebar
        activeConid={activeConid}
        activeSymbol={activeSymbol}
        fibonacci={fibonacci}
        chartIndicators={activeIndicators}
      />
    </div>
  );
}
