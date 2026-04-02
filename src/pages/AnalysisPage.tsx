/**
 * Analysis Page — Charts, indicators, Fibonacci, AI panel
 *
 * Thin page shell. Composes Phase 4 components:
 *   - IndicatorToolbar (4.6) — pill toggles in the toolbar
 *   - AiConfigPanel (4.7) — timeframe + indicator chips in AI panel
 *   - ActionSignalCard (4.8) — signal result display in AI panel
 *   - Chart (4.1–4.3) — placeholder until Ben builds chart wrapper
 *   - Fibonacci (4.4–4.5) — placeholder until Ofek builds it
 *   - AI Chat (4.9) — placeholder until Ben builds it
 *
 * Layout from mockup: grid with chart area + 340px AI panel
 *   Left: toolbar (symbol input, timeframe bar, indicator pills),
 *         main chart, sub-chart panels (RSI, MACD, etc.)
 *   Right: AI panel (config, signal card, chat)
 */

import { useState } from "react";
import { useChartStore } from "@/store";
import { IndicatorToolbar } from "@/components/indicators";
import {
  AiConfigPanel,
  ActionSignalCard,
  type SignalData,
} from "@/components/ai";

export default function AnalysisPage() {
  const { activeSymbol, timeframe, setTimeframe } = useChartStore();

  /** Signal card data — null until AI analysis runs (Phase 4.10+) */
  const [signal, setSignal] = useState<SignalData | null>(null);

  const handleRunAnalysis = (config: {
    timeframes: string[];
    indicators: string[];
    mode: string;
  }) => {
    // TODO (Phase 4.10–4.12): Send config to /ai/analyze endpoint
    // and call setSignal() with the response data.
    // For now, clear any stale signal and log the request.
    setSignal(null);
    console.log("[Analysis] Run requested:", config);
  };

  return (
    <div className="grid h-full grid-cols-[1fr_340px]">
      {/* ── Left: Chart area ── */}
      <div className="flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2.5 border-b border-border bg-[var(--bg-1)] px-3.5 py-2">
          {/* Symbol input */}
          <input
            type="text"
            placeholder="AAPL"
            defaultValue={activeSymbol}
            className="w-[90px] rounded-md border border-border bg-[var(--bg-0)] px-2.5 py-1.5 text-center text-sm font-bold text-foreground outline-none focus:border-[var(--clr-cyan)] focus:shadow-[0_0_12px_var(--glow-cyan)]"
            readOnly
          />

          {/* Timeframe bar */}
          <div className="flex gap-px rounded-md border border-border bg-[var(--bg-0)] p-0.5">
            {(["1m", "5m", "15m", "1h", "4h", "1D", "1W", "1M"] as const).map(
              (tf) => (
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
              )
            )}
          </div>

          {/* Indicator pills (task 4.6) */}
          <IndicatorToolbar />
        </div>

        {/* Chart placeholder — Phase 4.1–4.3 (Ben) */}
        <div className="relative flex flex-1 items-center justify-center bg-[var(--bg-0)]">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_60%_30%,rgba(0,212,255,0.02),transparent_50%)] pointer-events-none" />
          <span className="text-sm text-[var(--text-3)]">
            {activeSymbol
              ? `Chart for ${activeSymbol} — waiting for chart wrapper (4.1)`
              : "Select a stock to begin analysis"}
          </span>
        </div>

        {/* Sub-chart panels placeholder — Phase 4.3 (Ben) */}
        <div className="flex h-[140px] border-t border-border">
          {["RSI", "MACD"].map((label) => (
            <div
              key={label}
              className="relative flex-1 border-r border-border bg-[var(--bg-0)] last:border-r-0"
            >
              <span className="absolute left-2.5 top-1 text-[8px] font-semibold text-[var(--text-3)]">
                {label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Right: AI Panel ── */}
      <div className="flex flex-col border-l border-border bg-[var(--bg-1)] overflow-y-auto">
        {/* Config section (task 4.7) */}
        <AiConfigPanel onRunAnalysis={handleRunAnalysis} />

        {/* Signal card (task 4.8) */}
        <ActionSignalCard signal={signal} />

        {/* Chat placeholder — Phase 4.9 (Ben) */}
        <div className="flex flex-1 flex-col">
          <div className="flex-1 p-4">
            <div className="rounded-lg bg-[var(--bg-0)] px-3 py-2 text-[11px] text-[var(--text-2)]">
              {activeSymbol
                ? `${activeSymbol} loaded. Hit "Run Analysis" or ask me anything.`
                : "Select a stock to begin."}
            </div>
          </div>

          {/* Chat input placeholder */}
          <div className="flex items-center gap-2 border-t border-[var(--border)] px-3 py-2">
            <input
              className="flex-1 rounded-md border border-[var(--border)] bg-[var(--bg-0)] px-3 py-1.5 text-xs text-foreground placeholder:text-[var(--text-3)] outline-none focus:border-[var(--clr-cyan)]"
              placeholder="Ask about the chart..."
              readOnly
            />
            <button className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-0)] text-[var(--text-3)] transition-colors hover:border-[var(--clr-cyan)] hover:text-[var(--clr-cyan)]">
              →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
