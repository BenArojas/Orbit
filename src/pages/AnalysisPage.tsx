/**
 * Analysis Page — Charts, indicators, Fibonacci, AI panel
 *
 * Thin page shell. Components built in Phase 4 (tasks 4.1–4.12).
 *
 * Layout from mockup: grid with chart area + 340px AI panel
 *   Left: toolbar (symbol input, timeframe bar, indicator pills),
 *         main chart, sub-chart panels (RSI, MACD, etc.)
 *   Right: AI panel (config, signal card, chat)
 */

import { useChartStore } from "@/store";

export default function AnalysisPage() {
  const { activeSymbol, timeframe } = useChartStore();

  return (
    <div className="grid h-full grid-cols-[1fr_340px]">
      {/* Chart area */}
      <div className="flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2.5 border-b border-border bg-[var(--bg-1)] px-3.5 py-2">
          {/* Symbol input placeholder */}
          <input
            type="text"
            placeholder="AAPL"
            defaultValue={activeSymbol}
            className="w-[90px] rounded-md border border-border bg-[var(--bg-0)] px-2.5 py-1.5 text-center text-sm font-bold text-foreground outline-none focus:border-[var(--clr-cyan)] focus:shadow-[0_0_12px_var(--glow-cyan)]"
            readOnly
          />

          {/* Timeframe bar placeholder */}
          <div className="flex gap-px rounded-md border border-border bg-[var(--bg-0)] p-0.5">
            {(["1m", "5m", "15m", "1h", "4h", "1D", "1W", "1M"] as const).map(
              (tf) => (
                <button
                  key={tf}
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

          {/* Indicator pills placeholder */}
          <span className="font-data text-[9px] text-[var(--text-3)]">
            Indicators — Phase 4
          </span>
        </div>

        {/* Chart placeholder */}
        <div className="relative flex flex-1 items-center justify-center bg-[var(--bg-0)]">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_60%_30%,rgba(0,212,255,0.02),transparent_50%)] pointer-events-none" />
          <span className="text-sm text-[var(--text-3)]">
            {activeSymbol
              ? `Chart for ${activeSymbol} — Phase 4`
              : "Select a stock to begin analysis"}
          </span>
        </div>

        {/* Sub-chart panels placeholder */}
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

      {/* AI Panel */}
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
