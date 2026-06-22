/**
 * AiConfigPanel — Analysis configuration section in the AI panel
 *
 * Three configuration rows:
 *   1. Timeframe chips — multi-select which timeframes the AI should analyze
 *   2. Indicator chips — multi-select which indicators to include
 *   3. Chart Context — single-select mode (None / Price Summary / OHLCV / Patterns)
 *      + bar-count slider (5–30) when a non-None mode is selected
 *   4. "Run Analysis" button
 *
 * State is local (useState) since it's only used when sending an analysis
 * request. The "Manual" mode concept has been removed — the right-sidebar
 * tabs (Branch 5) handle non-AI workflows (Watchlists, Triggers).
 */

import { useState, useCallback, useEffect, useRef } from "react";
import type { IndicatorId } from "@/store/chart";
import type { AiContextMode } from "@/modules/parallax/api";

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
  | "OBV"
  | "ATR";

/* ── Constants ── */

const TIMEFRAMES: AiTimeframe[] = ["1H", "4H", "D", "W"];
const INDICATORS: AiIndicator[] = [
  "EMA Stack", "RSI", "Fibonacci", "Volume",
  "MACD", "BB", "ADX", "Stochastic", "VWAP", "OBV", "ATR",
];

const DEFAULT_TIMEFRAMES: AiTimeframe[] = ["4H", "D"];

/** Default bar count per context mode — applied when mode first changes. */
const CONTEXT_MODE_DEFAULTS: Record<AiContextMode, number> = {
  none:     10,
  summary:  10,
  ohlcv:    15,
  patterns: 20,
};

interface ContextModeOption {
  value: AiContextMode;
  label: string;
  /** Short time-impact label shown below the chip row when this mode is active. */
  timeNote: string;
  description: string;
}

const CONTEXT_MODES: ContextModeOption[] = [
  {
    value: "none",
    label: "None",
    timeNote: "",
    description: "Indicator values only — fastest response.",
  },
  {
    value: "summary",
    label: "Price Summary",
    timeNote: "⏱ ~+5% response time",
    description:
      "Adds recent closes + a direction blurb (e.g. '3 higher closes, near session high').",
  },
  {
    value: "ohlcv",
    label: "OHLCV History",
    timeNote: "⏱ ~+25–40% response time",
    description:
      "Full OHLCV table for the selected bar count. Enables pattern recognition. Heavy — best on ≥7B models.",
  },
  {
    value: "patterns",
    label: "Patterns",
    timeNote: "⏱ ~+10–15% response time",
    description:
      "Pre-computed candlestick patterns (Doji, Hammer, Engulfing, etc.) without flooding the model with raw data.",
  },
];

/**
 * Map chart-level IndicatorIds → AI-panel display names.
 *
 * EMA variants (ema9, ema21, ema50, ema200) all collapse into
 * "EMA Stack" since the AI always gets the full stack when any
 * EMA is enabled.
 */
const CHART_TO_AI_INDICATOR: Partial<Record<IndicatorId, AiIndicator>> = {
  ema9: "EMA Stack",
  ema21: "EMA Stack",
  ema50: "EMA Stack",
  ema200: "EMA Stack",
  rsi: "RSI",
  fibonacci: "Fibonacci",
  volume: "Volume",
  macd: "MACD",
  bollinger: "BB",
  adx: "ADX",
  stochastic: "Stochastic",
  vwap: "VWAP",
  obv: "OBV",
  atr: "ATR",
};

/** Convert chart indicator set → AI indicator set */
function chartIndicatorsToAi(chartIds?: Set<IndicatorId>): Set<AiIndicator> {
  if (!chartIds || chartIds.size === 0) return new Set();
  const aiSet = new Set<AiIndicator>();
  for (const id of chartIds) {
    const mapped = CHART_TO_AI_INDICATOR[id];
    if (mapped) aiSet.add(mapped);
  }
  return aiSet;
}

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
      className="rounded-[10px] border px-2 py-[3px] font-mono text-[9px] font-medium transition-all duration-150"
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
    contextMode: AiContextMode;
    contextBars: number;
  }) => void;
  /** Chart-level active indicators — used as default AI selection.
   *  When the trader toggles indicators on the chart, the AI panel
   *  mirrors their selection so the analysis covers what they're looking at. */
  chartIndicators?: Set<IndicatorId>;
  /**
   * True while an analysis is currently streaming. When true the
   * Run Analysis button is disabled (the user cancels from the
   * loading row, not from here — decision 7A in the plan).
   */
  isAnalyzing?: boolean;
  /** Disable a run when the selected provider route is not executable. */
  isRunDisabled?: boolean;
  runLabel?: string;
}

export default function AiConfigPanel({
  onRunAnalysis,
  chartIndicators,
  isAnalyzing = false,
  isRunDisabled = false,
  runLabel = "Run Analysis",
}: AiConfigPanelProps) {
  const [selectedTf, setSelectedTf] = useState<Set<AiTimeframe>>(
    () => new Set(DEFAULT_TIMEFRAMES)
  );
  const [selectedInd, setSelectedInd] = useState<Set<AiIndicator>>(
    () => chartIndicatorsToAi(chartIndicators)
  );
  const [contextMode, setContextMode] = useState<AiContextMode>("none");
  const [contextBars, setContextBars] = useState<number>(10);

  // Track whether the user has manually toggled any AI indicator.
  // Once they have, we stop auto-syncing from the chart so their
  // manual choices aren't overwritten.
  const userOverrodeRef = useRef(false);

  // Sync AI indicator selection from chart indicators — but only
  // if the user hasn't manually overridden the AI selection yet.
  useEffect(() => {
    if (userOverrodeRef.current) return;
    setSelectedInd(chartIndicatorsToAi(chartIndicators));
  }, [chartIndicators]);

  const toggleTf = useCallback((tf: AiTimeframe) => {
    setSelectedTf((prev) => {
      const next = new Set(prev);
      if (next.has(tf)) next.delete(tf);
      else next.add(tf);
      return next;
    });
  }, []);

  const toggleInd = useCallback((ind: AiIndicator) => {
    userOverrodeRef.current = true; // User manually changed AI selection
    setSelectedInd((prev) => {
      const next = new Set(prev);
      if (next.has(ind)) next.delete(ind);
      else next.add(ind);
      return next;
    });
  }, []);

  /** Context mode toggle — clicking the active mode deselects back to "none". */
  const handleContextModeClick = useCallback((mode: AiContextMode) => {
    setContextMode((prev) => {
      const next = prev === mode ? "none" : mode;
      // Reset bar count to the mode's default when switching
      setContextBars(CONTEXT_MODE_DEFAULTS[next]);
      return next;
    });
  }, []);

  const handleRun = () => {
    onRunAnalysis?.({
      timeframes: Array.from(selectedTf),
      indicators: Array.from(selectedInd),
      contextMode,
      contextBars,
    });
  };

  const activeContextOption = CONTEXT_MODES.find((m) => m.value === contextMode);

  return (
    <div className="flex shrink-0 flex-col gap-3 border-b border-[var(--border)] px-4 py-3">
      {/* Header */}
      <div className="flex items-center gap-1.5 text-xs font-semibold">
        <div className="h-2 w-2 rounded-full bg-[var(--clr-cyan)] shadow-[0_0_10px_var(--clr-cyan)] animate-glow" />
        AI Analysis
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

      {/* Chart Context row */}
      <div>
        <div className="mb-1.5 flex items-center gap-1.5">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
            Chart Context
          </span>
          {/* Info tooltip */}
          <div className="group relative flex items-center">
            <span
              className="flex h-3.5 w-3.5 cursor-default items-center justify-center rounded-full border border-[var(--border)] text-[8px] font-bold text-[var(--text-3)] transition-colors group-hover:border-[var(--clr-cyan)] group-hover:text-[var(--clr-cyan)]"
              aria-label="Chart context information"
            >
              i
            </span>
            <div
              className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 w-56 -translate-x-1/2 rounded-md border border-[var(--border)] bg-[var(--bg-1)] px-2.5 py-2 text-[9px] leading-relaxed text-[var(--text-2)] opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100"
              role="tooltip"
            >
              <p className="mb-1 font-semibold text-[var(--text-1)]">Why does this affect speed?</p>
              <p>
                Each mode adds raw price data to the prompt. More data = more tokens the model
                must process before generating a response.
              </p>
              <p className="mt-1">
                On slower hardware or smaller models, heavier prompts take longer and are more
                likely to time out. Start with <span className="font-semibold text-[var(--clr-cyan)]">None</span> — add context only if the analysis feels too generic.
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {CONTEXT_MODES.map((m) => (
            <Chip
              key={m.value}
              label={m.label}
              selected={contextMode === m.value}
              onClick={() => handleContextModeClick(m.value)}
            />
          ))}
        </div>

        {/* Time impact warning — shown when any non-None mode is selected */}
        {contextMode !== "none" && activeContextOption && (
          <div className="mt-2 flex flex-col gap-2">
            <p className="text-[9px] text-[var(--text-3)]">
              <span className="text-[var(--clr-amber)]">{activeContextOption.timeNote}</span>
              {" — "}{activeContextOption.description}
            </p>

            {/* Bar count slider */}
            <div className="flex items-center gap-2">
              <span className="w-16 text-[9px] text-[var(--text-3)]">Bars: {contextBars}</span>
              <input
                type="range"
                min={5}
                max={30}
                step={1}
                value={contextBars}
                onChange={(e) => setContextBars(Number(e.target.value))}
                className="h-1 flex-1 cursor-pointer accent-[var(--clr-cyan)]"
                aria-label="Chart context bar count"
              />
              <span className="w-4 text-right text-[9px] text-[var(--text-3)]">30</span>
            </div>
          </div>
        )}
      </div>

      {/* Run button.
          The ▶ glyph + label live in a single text node so screen readers
          read the button as "▶ Run Analysis" and test queries against
          the full label work cleanly. */}
      <button
        onClick={handleRun}
        disabled={
          selectedTf.size === 0
          || selectedInd.size === 0
          || isAnalyzing
          || isRunDisabled
        }
        data-testid="run-analysis-button"
        title={
          isAnalyzing
            ? "Analysis in progress — cancel below"
            : undefined
        }
        className="flex items-center justify-center gap-1.5 rounded-md border border-[var(--clr-cyan)] bg-[var(--glow-cyan)] px-3 py-2 text-xs font-semibold text-[var(--clr-cyan)] transition-all hover:shadow-[0_0_16px_var(--glow-cyan)] disabled:opacity-40 disabled:cursor-not-allowed"
      >
        ▶ {runLabel}
      </button>
    </div>
  );
}

/** Re-export types for use by parent components */
export type { AiTimeframe, AiIndicator };
