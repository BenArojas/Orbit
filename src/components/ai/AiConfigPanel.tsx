/**
 * AiConfigPanel — Analysis configuration section in the AI panel
 *
 * Two sections:
 *   1. Timeframe chips — multi-select which timeframes the AI should analyze
 *   2. Indicator chips — multi-select which indicators to include in analysis
 *   3. "Run Analysis" button
 *
 * Also includes the AI Assist / Manual toggle at the top header area.
 *
 * State is local (useState) since it's only used when sending an analysis
 * request. When Ollama integration is built (4.10–4.12), this state will
 * be passed to the analysis API call.
 */

import { useState, useCallback } from "react";

/* ── Types ── */

type AiTimeframe = "1H" | "4H" | "D" | "W";
type AiIndicator =
  | "EMA Stack"
  | "RSI"
  | "Fibonacci"
  | "Volume"
  | "MACD"
  | "BB"
  | "ADX"
  | "Stochastic"
  | "VWAP"
  | "OBV";

type AiMode = "assist" | "manual";

/* ── Constants ── */

const TIMEFRAMES: AiTimeframe[] = ["1H", "4H", "D", "W"];
const INDICATORS: AiIndicator[] = [
  "EMA Stack", "RSI", "Fibonacci", "Volume",
  "MACD", "BB", "ADX", "Stochastic", "VWAP", "OBV",
];

const DEFAULT_TIMEFRAMES: AiTimeframe[] = ["4H", "D"];
const DEFAULT_INDICATORS: AiIndicator[] = ["EMA Stack", "RSI", "Fibonacci", "Volume"];

/* ── Chip sub-component ── */

interface ChipProps {
  label: string;
  selected: boolean;
  onClick: () => void;
}

function Chip({ label, selected, onClick }: ChipProps) {
  return (
    <button
      onClick={onClick}
      className="rounded-[10px] border px-2 py-[3px] font-mono text-[9px] font-medium transition-all duration-150 cursor-pointer"
      style={
        selected
          ? {
              borderColor: "var(--clr-cyan)",
              color: "var(--clr-cyan)",
              background: "var(--glow-cyan)",
            }
          : {
              borderColor: "var(--border)",
              color: "var(--text-3)",
              background: "transparent",
            }
      }
    >
      {label}
    </button>
  );
}

/* ── Main component ── */

interface AiConfigPanelProps {
  /** Called when user clicks "Run Analysis" — passes selected config */
  onRunAnalysis?: (config: {
    timeframes: AiTimeframe[];
    indicators: AiIndicator[];
    mode: AiMode;
  }) => void;
}

export default function AiConfigPanel({ onRunAnalysis }: AiConfigPanelProps) {
  const [mode, setMode] = useState<AiMode>("assist");
  const [selectedTf, setSelectedTf] = useState<Set<AiTimeframe>>(
    () => new Set(DEFAULT_TIMEFRAMES)
  );
  const [selectedInd, setSelectedInd] = useState<Set<AiIndicator>>(
    () => new Set(DEFAULT_INDICATORS)
  );

  const toggleTf = useCallback((tf: AiTimeframe) => {
    setSelectedTf((prev) => {
      const next = new Set(prev);
      if (next.has(tf)) next.delete(tf);
      else next.add(tf);
      return next;
    });
  }, []);

  const toggleInd = useCallback((ind: AiIndicator) => {
    setSelectedInd((prev) => {
      const next = new Set(prev);
      if (next.has(ind)) next.delete(ind);
      else next.add(ind);
      return next;
    });
  }, []);

  const handleRun = () => {
    onRunAnalysis?.({
      timeframes: Array.from(selectedTf),
      indicators: Array.from(selectedInd),
      mode,
    });
  };

  return (
    <div className="flex flex-col gap-3 border-b border-[var(--border)] px-4 py-3">
      {/* Header with mode toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold">
          <div className="h-2 w-2 rounded-full bg-[var(--clr-cyan)] shadow-[0_0_10px_var(--clr-cyan)] animate-glow" />
          AI Analysis
        </div>
        <div className="flex gap-px rounded-full border border-[var(--border)] bg-[var(--bg-0)] p-0.5">
          <button
            onClick={() => setMode("assist")}
            className={`rounded-full px-3 py-1 text-[10px] font-medium transition-all ${
              mode === "assist"
                ? "bg-[var(--bg-4)] text-foreground shadow-[0_0_8px_var(--glow-cyan)]"
                : "text-[var(--text-3)] hover:text-[var(--text-2)]"
            }`}
          >
            AI Assist
          </button>
          <button
            onClick={() => setMode("manual")}
            className={`rounded-full px-3 py-1 text-[10px] font-medium transition-all ${
              mode === "manual"
                ? "bg-[var(--bg-4)] text-foreground shadow-[0_0_8px_var(--glow-cyan)]"
                : "text-[var(--text-3)] hover:text-[var(--text-2)]"
            }`}
          >
            Manual
          </button>
        </div>
      </div>

      {/* Timeframe row */}
      <div>
        <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
          Analyze Timeframes
        </div>
        <div className="flex flex-wrap gap-1.5">
          {TIMEFRAMES.map((tf) => (
            <Chip
              key={tf}
              label={tf}
              selected={selectedTf.has(tf)}
              onClick={() => toggleTf(tf)}
            />
          ))}
        </div>
      </div>

      {/* Indicator row */}
      <div>
        <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
          Indicators
        </div>
        <div className="flex flex-wrap gap-1.5">
          {INDICATORS.map((ind) => (
            <Chip
              key={ind}
              label={ind}
              selected={selectedInd.has(ind)}
              onClick={() => toggleInd(ind)}
            />
          ))}
        </div>
      </div>

      {/* Run button */}
      <button
        onClick={handleRun}
        disabled={selectedTf.size === 0 || selectedInd.size === 0}
        className="flex items-center justify-center gap-1.5 rounded-md border border-[var(--clr-cyan)] bg-[var(--glow-cyan)] px-3 py-2 text-xs font-semibold text-[var(--clr-cyan)] transition-all hover:shadow-[0_0_16px_var(--glow-cyan)] disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <span>▶</span> Run Analysis
      </button>
    </div>
  );
}

/** Re-export types for use by parent components */
export type { AiTimeframe, AiIndicator, AiMode };
