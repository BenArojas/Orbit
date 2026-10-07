/**
 * Analysis Page — Charts, indicators, Fibonacci, and Parallax tools
 *
 * Composes Phase 4 components:
 *   - ChartContainer (4.1) — Lightweight Charts candlestick + volume
 *   - Indicator overlays (4.2) — EMA, Bollinger, VWAP on main chart
 *   - SubChartPanel (4.3) — RSI, MACD, Stochastic, OBV, ADX below chart
 *   - IndicatorToolbar (4.6) — pill toggles in the toolbar
 *   - FibonacciOverlay (4.4) — auto-detected fib levels on chart + score panel
 *   - FibDrawMode (4.5) — two-click manual fib drawing with ghost preview
 *
 * Layout from mockup: grid with chart area + 340px tool panel
 *   Left: toolbar (symbol input, timeframe bar, indicator pills),
 *         main chart, sub-chart panels (RSI, MACD, etc.)
 *   Right: Fibonacci, Watchlists, and Triggers panel
 *
 * This page composes ChartContainer + useChartData. It owns:
 *   - Symbol search / resolution (input → conid lookup via useMutation)
 *   - Timeframe switching (updates chart store)
 *   - Chart rendering delegation to ChartContainer
 */

import { useState, useMemo, useEffect, useRef, useCallback, type KeyboardEvent } from "react";
import { BriefcaseBusiness, ChevronLeft, GitCompare, ListTree, RotateCcw, ShoppingCart } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { useChartStore, type Timeframe, type IndicatorId } from "@/store";
import { useDrawingsStore } from "@/store/drawings";
import { parallaxApi } from "@/modules/parallax/api";
import { toast } from "sonner";
import { ChartContainer, SubChartPanel, AtrBadge, DrawingToolbar, SUB_CHART_BACKEND_NAMES, type SubChartType } from "@/components/charts";
import { useChartData } from "@/hooks/useChartData";
import { useInstrument } from "@/hooks/useInstrument";
import { useLockedFibs } from "@/hooks/useLockedFibs";
import { IndicatorToolbar } from "@/components/indicators";
import RightSidebar from "@/components/analysis/RightSidebar";
import { useSetupPlanEditor } from "@/components/analysis/SetupPlanPanel";
import { SHORTCUT_MAP } from "@/components/charts/drawingsRegistry";
import { useCompareStore } from "@/store/compare";
import { CompareView } from "@/components/compare";
import { useOrderTicketStore } from "@/orbit/OrderTicket";
import { useNavigationStore } from "@/store/navigation";

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
  const navigate = useNavigate();
  const openOrderTicket = useOrderTicketStore((state) => state.open);
  const {
    activeConid,
    activeSymbol,
    timeframe,
    activeIndicators,
    setTimeframe,
    fibDrawMode,
    enterFibDrawMode,
    exitFibDrawMode,
    toggleIndicator,
    requestResetZoom,
    rightPanelCollapsed,
    rightPanelVisibilityExplicit,
    setRightPanelActiveTab,
    toggleRightPanel,
  } = useChartStore();
  const navigateToNames = useNavigationStore((state) => state.navigate);
  const analysisContext = useNavigationStore((state) => state.analysisContext);
  const setupPlanEditor = useSetupPlanEditor(activeConid);

  const compareActive = useCompareStore((s) => s.active);
  const enterCompare = useCompareStore((s) => s.enter);
  const exitCompare = useCompareStore((s) => s.exit);

  const [symbolInput, setSymbolInput] = useState(activeSymbol || "");
  const [inputFocused, setInputFocused] = useState(false);

  const handleTrade = () => {
    if (!activeConid) {
      return;
    }
    openOrderTicket({ conid: activeConid, symbol: activeSymbol || undefined });
  };

  const handleViewPortfolio = () => {
    navigate("/moonmarket/portfolio");
  };

  const handleOptions = () => {
    if (!activeConid || !activeSymbol) {
      return;
    }
    navigate(`/moonmarket/options?conid=${activeConid}&symbol=${encodeURIComponent(activeSymbol)}`);
  };

  const handleOpenWatchlists = () => {
    setRightPanelActiveTab("watchlists");
    if (useChartStore.getState().rightPanelCollapsed) toggleRightPanel();
  };

  const handleOpenSetup = () => {
    setRightPanelActiveTab("setup");
    if (useChartStore.getState().rightPanelCollapsed) toggleRightPanel();
  };

  // Sync symbol input whenever the store's activeSymbol changes externally
  // (e.g. navigateToAnalysis called from watchlist or screener).
  // Skip sync while the user is actively typing in the input.
  useEffect(() => {
    if (!inputFocused) {
      setSymbolInput(activeSymbol);
    }
  }, [activeSymbol, inputFocused]);

  // Keep an explicitly chosen panel visibility when entering Compare.
  useEffect(() => {
    if (compareActive && !rightPanelCollapsed && !rightPanelVisibilityExplicit) {
      toggleRightPanel();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareActive, rightPanelVisibilityExplicit]);

  // Force-exit compare mode when the primary stock changes.
  const prevCompareConidRef = useRef<number | null>(activeConid);
  useEffect(() => {
    if (prevCompareConidRef.current !== null
        && prevCompareConidRef.current !== activeConid
        && compareActive) {
      exitCompare();
      toast.info(`Exited compare mode for ${activeSymbol || "new symbol"}`);
    }
    prevCompareConidRef.current = activeConid;
  }, [activeConid, activeSymbol, compareActive, exitCompare]);

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
      if (e.key.toLowerCase() === "c") {
        if (useCompareStore.getState().active) {
          exitCompare();
        } else {
          enterCompare(useChartStore.getState().timeframe);
        }
        return;
      }
      if (e.key === "Escape") {
        setDrawingTool(null);
        return;
      }
      if (e.key === "\\") {
        toggleRightPanel();
        return;
      }
      const toolId = SHORTCUT_MAP[e.key.toUpperCase()];
      if (toolId) {
        // Toggle: pressing the same key again exits the tool.
        setDrawingTool(activeDrawingTool === toolId ? null : toolId);
      }
    },
    [setDrawingTool, activeDrawingTool, toggleRightPanel, exitCompare, enterCompare],
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
    loadMore,
    isLoadingMore,
    canLoadMore,
  } = useChartData(activeConid, timeframe, activeIndicators);

  // Surface `no_active_fib` to the user.
  //
  // The `fibonacci` pill means "show me the auto-detected fib." When the
  // detector finds nothing currently in play, we toast once and untoggle
  // the pill so the lit pill doesn't imply a fib that isn't there. This
  // only governs the AUTO layer — any user-drawn (locked) fibs render on
  // their own visibility layer and are unaffected by the untoggle, so we
  // no longer need to special-case their presence here.
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
    mutationFn: (sym: string) => parallaxApi.resolveConid(sym),
    onSuccess: (result) => {
      const moved = useNavigationStore.getState().navigateToAnalysis(result.conid, result.symbol);
      if (!moved) {
        setSymbolInput(useChartStore.getState().activeSymbol);
        return;
      }
      setSymbolInput(result.symbol);
    },
  });

  const resolveSymbol = () => {
    const sym = symbolInput.trim().toUpperCase();
    if (!sym || sym === activeSymbol || analysisContext.setupPlanId != null) return;
    resolveConidMutation.mutate(sym);
  };

  const returnLabel = analysisContext.returnTo === "screener" ? "Back to Names"
    : analysisContext.returnTo === "today" ? "Back to Today"
    : analysisContext.returnTo === "market" ? "Back to Market"
    : analysisContext.returnTo === "settings" ? "Back to Settings"
    : "Back";

  const handleSymbolKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      resolveSymbol();
    }
  };

  return (
    <div className={`grid h-full min-h-0 ${rightPanelCollapsed ? "grid-cols-[minmax(0,1fr)_32px]" : "grid-cols-[minmax(0,1fr)_340px]"}`}>
      {/* ── Center: Chart area ── */}
      <div className="relative flex min-h-0 flex-col overflow-visible">
        {/* Toolbar — hidden in compare mode (CompareView has its own header).
            shrink-0 so it stays at its natural height when sub-panels
            are added below; otherwise flex squeezes it and only the bottom row
            of indicator/timeframe pills remains visible. */}
        {!compareActive && (
          <div className="relative z-30 flex shrink-0 flex-nowrap items-center gap-2 border-b border-border bg-[var(--bg-1)] px-3 py-1.5">
            <button type="button" onClick={() => navigateToNames(analysisContext.returnTo)} className="shrink-0 rounded border border-[var(--border)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-2)] hover:text-[var(--text-1)]">{returnLabel}</button>
            <input
              type="text"
              aria-label="Symbol"
              placeholder="AAPL"
              value={inputFocused ? symbolInput : (symbolInput || activeSymbol)}
              onChange={(e) => setSymbolInput(e.target.value.toUpperCase())}
              onKeyDown={handleSymbolKeyDown}
              onFocus={() => setInputFocused(true)}
              onBlur={() => { setInputFocused(false); resolveSymbol(); }}
              disabled={analysisContext.setupPlanId != null}
              title={analysisContext.setupPlanId != null ? "This chart is tied to the open setup plan." : undefined}
              className={`w-[76px] shrink-0 rounded-md border border-border bg-[var(--bg-0)] px-2 py-1.5 text-center text-sm font-bold text-foreground outline-none transition-all focus:border-[var(--clr-cyan)] focus:shadow-[0_0_12px_var(--glow-cyan)] disabled:opacity-60 ${resolveConidMutation.isPending ? "animate-pulse" : ""}`}
            />
            <div className="flex shrink-0 gap-px rounded-md border border-border bg-[var(--bg-0)] p-0.5">
              {TIMEFRAMES.map((tf) => (
                <button key={tf} onClick={() => setTimeframe(tf)} className={`rounded px-2 py-1 font-data text-[10px] font-medium transition-all ${tf === timeframe ? "bg-[var(--bg-4)] text-foreground shadow-[inset_0_0_8px_var(--glow-cyan)]" : "text-[var(--text-3)] hover:text-[var(--text-2)]"}`}>
                  {tf}
                </button>
              ))}
            </div>
            {companyName && <span className="min-w-0 flex-1 truncate text-[10px] text-[var(--text-3)]">{companyName}</span>}
            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              <button type="button" onClick={handleOpenSetup} className="rounded border border-[var(--border)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-2)] hover:border-[var(--clr-cyan)] hover:text-[var(--text-1)]">Setup</button>
              <button type="button" onClick={handleOpenWatchlists} className="rounded border border-[var(--border)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-2)] hover:text-[var(--text-1)]">Watchlists</button>
              <button
                onClick={() => compareActive ? exitCompare() : enterCompare(timeframe)}
                title={compareActive ? "Exit Compare mode (C)" : "Enter Compare mode (C)"}
                className={`flex shrink-0 items-center gap-1 rounded border px-2.5 py-1.5 text-[11px] font-medium transition-all ${compareActive ? "border-[var(--clr-cyan)] bg-[rgba(0,212,255,0.1)] text-[var(--clr-cyan)]" : "border-[var(--border)] text-[var(--text-3)] hover:border-[var(--clr-cyan)] hover:text-[var(--clr-cyan)]"}`}
              >
                <GitCompare size={13} /> Compare
              </button>
              <details className="relative shrink-0">
                <summary className="cursor-pointer list-none rounded border border-[var(--border)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-2)] hover:text-[var(--text-1)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--clr-cyan)]">Tools</summary>
                <div className="absolute right-0 top-full z-[100] mt-1 flex max-h-[min(620px,calc(100vh-72px))] max-w-[calc(100vw-24px)] overflow-auto rounded-lg border border-[var(--border)] bg-[var(--bg-1)] p-3 shadow-xl">
                  <div className="min-w-[250px] flex-1 pr-3">
                    <h2 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-3)]">Trading and indicators</h2>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <button type="button" onClick={handleTrade} disabled={!activeConid} className="flex items-center gap-1 rounded-full border border-[var(--clr-cyan)]/60 px-2.5 py-1 font-data text-[10px] font-medium text-[var(--clr-cyan)] transition-all hover:bg-[var(--clr-cyan)]/10 disabled:opacity-40"><ShoppingCart size={12} /> Trade</button>
                      <button type="button" onClick={handleViewPortfolio} className="flex items-center gap-1 rounded-full border border-[var(--border)] px-2.5 py-1 font-data text-[10px] font-medium text-[var(--text-3)] transition-all hover:border-[var(--clr-green)] hover:text-[var(--clr-green)]"><BriefcaseBusiness size={12} /> View Portfolio</button>
                      <button type="button" onClick={handleOptions} disabled={!activeConid || !activeSymbol} className="flex items-center gap-1 rounded-full border border-[var(--border)] px-2.5 py-1 font-data text-[10px] font-medium text-[var(--text-3)] transition-all hover:border-[var(--clr-cyan)] hover:text-[var(--clr-cyan)] disabled:opacity-40"><ListTree size={12} /> Options</button>
                    </div>
                    <div className="mt-3"><IndicatorToolbar /></div>
                    {activeIndicators.has("atr") && <div className="mt-2"><AtrBadge indicators={indicators} /></div>}
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
                      {fibDrawMode ? (
                        <button onClick={exitFibDrawMode} className="rounded-full border border-[var(--clr-red)] bg-[rgba(255,68,102,0.1)] px-2.5 py-1 font-data text-[10px] font-medium text-[var(--clr-red)] transition-all hover:bg-[rgba(255,68,102,0.2)]">Cancel Draw</button>
                      ) : (
                        <>
                          <button onClick={() => enterFibDrawMode("retracement")} className="rounded-full border border-[var(--border)] px-2.5 py-1 font-data text-[10px] font-medium text-[var(--text-3)] transition-all hover:border-[var(--clr-green)] hover:text-[var(--clr-green)]" title="Draw Fibonacci retracement — click two points on the chart">Draw Fib</button>
                          <button onClick={() => enterFibDrawMode("extension")} className="rounded-full border border-[var(--border)] px-2.5 py-1 font-data text-[10px] font-medium text-[var(--text-3)] transition-all hover:border-[var(--clr-purple)] hover:text-[var(--clr-purple)]" title="Draw Fibonacci extension — click two points on the chart">Draw Ext</button>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="h-[min(520px,calc(100vh-92px))] shrink-0 border-l border-[var(--border)] pl-3" aria-label="Drawing tools"><DrawingToolbar conid={activeConid} /></div>
                </div>
              </details>
            </div>
          </div>
        )}

        {compareActive ? (
          <CompareView />
        ) : (
          <>
            {/* Main chart — flex-[2] gives it twice the share of remaining space
                vs the sub-panel column below. min-h-[200px] guarantees the candle
                chart never shrinks to zero when 4–5 sub-panels are toggled on
                (which previously caused the candles to "disappear"). */}
            <div className="relative flex-[2] min-h-[200px] bg-[var(--bg-0)]">
              {/* Subtle radial glow background */}
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_60%_30%,rgba(0,212,255,0.02),transparent_50%)]" />

              {activeConid && candles.length > 0 ? (
                // Dim the chart while a non-escalation refetch is in flight so the
                // user sees that the previously-rendered candles are stale (e.g.
                // they just changed the symbol and the new candles haven't arrived
                // yet). isLoadingMore is excluded so the chart stays bright during
                // period-escalation auto-loads (the "Loading older bars…" pill is
                // the indicator there).
                <div className={`h-full transition-opacity ${isFetching && !isLoadingMore ? "opacity-40" : "opacity-100"}`}>
                  <ChartContainer
                    candles={candles}
                    indicators={indicators}
                    fibonacci={fibonacci}
                    activeIndicators={activeIndicators}
                    liveTick={liveTick}
                    conid={activeConid}
                    timeframe={timeframe}
                    symbol={activeSymbol || undefined}
                    onLoadMore={loadMore}
                    isLoadingMore={isLoadingMore}
                    canLoadMore={canLoadMore}
                  />
                </div>
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

              {/* Floating Reset Zoom — hovers over the chart so it doesn't
                  steal toolbar space and doesn't get mixed in with indicators. */}
              {activeConid && candles.length > 0 && (
                <button
                  onClick={requestResetZoom}
                  title="Reset zoom (fits all loaded data)"
                  aria-label="Reset zoom"
                  className="absolute bottom-3 right-3 z-10 flex items-center justify-center rounded-full border border-[var(--border)] bg-[var(--bg-1)]/85 p-2 text-[var(--text-3)] shadow-lg backdrop-blur-sm transition-all hover:border-[var(--clr-cyan)] hover:text-[var(--clr-cyan)]"
                >
                  <RotateCcw size={14} />
                </button>
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
          </>
        )}
      </div>

      {/* ── Right: tabbed Parallax tools sidebar ── */}
      {rightPanelCollapsed ? (
        <div className="flex flex-col items-center border-l border-[var(--border)] bg-[var(--bg-1)] pt-2">
          <button
            onClick={toggleRightPanel}
            aria-label="Open analysis panel"
            title="Expand panel (\)"
            className="flex h-7 w-7 items-center justify-center rounded text-[var(--text-3)] transition-colors hover:text-[var(--clr-cyan)]"
          >
            <ChevronLeft size={14} />
          </button>
        </div>
      ) : (
        <RightSidebar
          activeConid={activeConid}
          activeSymbol={activeSymbol}
          activeTimeframe={timeframe}
          setupPlanEditor={setupPlanEditor}
          onCollapse={toggleRightPanel}
        />
      )}
    </div>
  );
}
