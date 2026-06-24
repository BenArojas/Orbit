/**
 * ScreenerAiPanel — AI-assisted filter generation for the screener.
 *
 * Collapsible right panel. User describes what they're looking for in plain
 * text (or clicks a preset chip) and the local Ollama model translates it
 * into IBKR native filter codes with reasoning per filter.
 *
 * Flow:
 *   1. User types a query or clicks a preset chip
 *   2. POST /screener/ai-filters → suggested filters + reasoning per filter
 *   3. User reviews suggestions in the panel (with per-filter reasoning)
 *   4. "Apply to Screener" → filters injected into the filter bar pills
 *   5. User tweaks/removes before clicking Scan
 */

import { useState, useRef, useCallback, type KeyboardEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Sparkles,
  Send,
  Loader2,
  Plus,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  ChevronRight,
} from "lucide-react";
import { parallaxApi, type AiFilterSuggestion } from "@/modules/parallax/api";
import { useScreenerStore, type ActiveFilter } from "@/store/screener";
import { useAiStatus } from "@/hooks/useAiStatus";

/**
 * State of an AI suggestion vs the user's existing filter list, by code.
 *
 *   "new"       — code isn't in the bar yet → "Add" button
 *   "duplicate" — same code AND same value already in the bar → "Added" pill
 *   "differs"   — same code but different value → "Update" button (replace)
 */
export type SuggestionState = "new" | "duplicate" | "differs";

export function classifySuggestion(
  suggestion: AiFilterSuggestion,
  filters: ActiveFilter[],
): { state: SuggestionState; existing?: ActiveFilter } {
  const existing = filters.find((f) => f.code === suggestion.code);
  if (!existing) return { state: "new" };
  if (existing.value === suggestion.value) return { state: "duplicate", existing };
  return { state: "differs", existing };
}

// ── Preset chips ──────────────────────────────────────────────

const PRESET_QUERIES = [
  "Oversold large caps",
  "High momentum small caps",
  "Low float high volume",
  "Strong uptrend breakout",
  "Value stocks with growth",
] as const;

// ── Filter suggestion card ────────────────────────────────────

function SuggestionCard({
  suggestion,
  state,
  existing,
  onAdd,
}: {
  suggestion: AiFilterSuggestion;
  state: SuggestionState;
  existing?: ActiveFilter;
  onAdd: () => void;
}) {
  const [showReasoning, setShowReasoning] = useState(false);

  const isDuplicate = state === "duplicate";
  const isUpdate = state === "differs";

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-2)] p-2.5">
      {/* Top row: label + add button */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5 flex-1 min-w-0">
          <span className="font-data text-[11px] font-medium text-[var(--text-1)] leading-tight">
            {suggestion.display_label}
          </span>
          <span className="font-mono text-[9px] text-[var(--text-3)]">
            {suggestion.code} = {suggestion.value}
          </span>
          {/* When the AI's value differs from the user's, surface the diff so
              they know what "Update" will do. */}
          {isUpdate && existing && (
            <span
              data-testid="ai-suggestion-diff"
              className="font-mono text-[9px] text-[var(--clr-orange)]"
            >
              your value: {existing.value}
            </span>
          )}
        </div>

        <button
          onClick={onAdd}
          disabled={isDuplicate}
          aria-label={
            isDuplicate
              ? `${suggestion.code} already added`
              : isUpdate
              ? `Update ${suggestion.code} value`
              : `Add ${suggestion.code}`
          }
          className={`flex-shrink-0 flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium transition-colors ${
            isDuplicate
              ? "text-[var(--clr-green)] cursor-default"
              : isUpdate
              ? "bg-[var(--clr-orange)]/15 text-[var(--clr-orange)] hover:bg-[var(--clr-orange)]/25"
              : "bg-[var(--clr-cyan)]/15 text-[var(--clr-cyan)] hover:bg-[var(--clr-cyan)]/25"
          }`}
        >
          {isDuplicate ? (
            <>
              <CheckCircle2 size={10} />
              Added
            </>
          ) : isUpdate ? (
            <>
              <RefreshCw size={10} />
              Update
            </>
          ) : (
            <>
              <Plus size={10} />
              Add
            </>
          )}
        </button>
      </div>

      {/* Reasoning toggle */}
      <button
        onClick={() => setShowReasoning((v) => !v)}
        className="mt-1.5 flex items-center gap-1 text-[9px] text-[var(--text-3)] transition-colors hover:text-[var(--text-2)]"
      >
        <ChevronRight
          size={9}
          className={`transition-transform ${showReasoning ? "rotate-90" : ""}`}
        />
        Why?
      </button>

      {showReasoning && (
        <p className="mt-1 text-[10px] leading-relaxed text-[var(--text-2)] border-t border-[var(--border)] pt-1.5">
          {suggestion.reasoning}
        </p>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────

interface ScreenerAiPanelProps {
  /** Whether the panel is currently open */
  isOpen: boolean;
}

export default function ScreenerAiPanel({ isOpen }: ScreenerAiPanelProps) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<AiFilterSuggestion[]>([]);
  const [summary, setSummary] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // `filters` is read live so the panel reflects the actual filter bar state
  // (no local addedCodes drift after the user removes a pill, picks a new
  // scanner, or applies a Try-this card).
  const { filters, addFilter, updateFilter, selectedPreset } = useScreenerStore();
  const { isReady, selectedModel, ollamaState } = useAiStatus();

  // ── AI mutation ──

  const aiMutation = useMutation({
    mutationFn: (q: string) => {
      if (!selectedModel) throw new Error("No model selected");
      return parallaxApi.screenerAiFilters({
        query: q,
        model: selectedModel,
        preset_context: selectedPreset?.display_name,
      });
    },
    onMutate: () => {
      setError(null);
      setSuggestions([]);
      setSummary("");
    },
    onSuccess: (data) => {
      setSuggestions(data.filters);
      setSummary(data.summary);
    },
    onError: (err) => {
      setError((err as Error).message || "AI filter generation failed");
    },
  });

  // ── Handlers ──

  const handleSubmit = useCallback(() => {
    const q = query.trim();
    if (!q || aiMutation.isPending) return;
    aiMutation.mutate(q);
  }, [query, aiMutation]);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleChip = (chip: string) => {
    setQuery(chip);
    aiMutation.mutate(chip);
  };

  const handleAddSuggestion = (suggestion: AiFilterSuggestion) => {
    const { state, existing } = classifySuggestion(suggestion, filters);

    if (state === "duplicate") {
      // Same code + same value already in the bar — no-op
      return;
    }

    if (state === "differs" && existing) {
      // Same code, different value → replace the existing filter's value
      // in-place rather than creating a duplicate pill with two values.
      updateFilter(existing.id, suggestion.value, suggestion.display_label);
      return;
    }

    // state === "new" — append a fresh pill
    const filter: ActiveFilter = {
      id: `ai-${suggestion.code}-${Date.now()}`,
      code: suggestion.code,
      value: suggestion.value,
      display_label: suggestion.display_label,
    };
    addFilter(filter);
  };

  const handleApplyAll = () => {
    // No-ops on duplicates, replaces on differs, adds on new — all routed
    // through handleAddSuggestion so behavior matches the per-card click.
    suggestions.forEach(handleAddSuggestion);
  };

  // ── Not open ──

  if (!isOpen) return null;

  // ── Ollama not ready ──

  const notReady =
    ollamaState === "not_installed" ||
    ollamaState === "no_models" ||
    ollamaState === "installed" ||
    !isReady;

  return (
    <div className="flex h-full w-[300px] flex-shrink-0 flex-col border-l border-[var(--border)] bg-[var(--bg-1)]">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        <div
          className="h-2 w-2 rounded-full flex-shrink-0"
          style={{
            background: isReady ? "var(--clr-green)" : "var(--clr-orange)",
            boxShadow: isReady
              ? "0 0 8px var(--clr-green)"
              : "0 0 6px var(--clr-orange)",
          }}
        />
        <span className="text-[11px] font-semibold text-[var(--text-1)]">
          AI Filters
        </span>
        {selectedModel && (
          <span className="ml-auto font-mono text-[9px] text-[var(--text-3)] truncate max-w-[120px]">
            {selectedModel.split(":")[0]}
          </span>
        )}
      </div>

      {/* Not ready state */}
      {notReady && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center">
          <AlertCircle size={24} className="text-[var(--clr-orange)]" />
          <div>
            <p className="text-[11px] font-medium text-[var(--text-1)]">
              Ollama not ready
            </p>
            <p className="mt-1 text-[10px] text-[var(--text-3)]">
              {ollamaState === "not_installed"
                ? "Install Ollama to use AI filters"
                : ollamaState === "no_models"
                  ? "Pull a model to enable AI filters"
                  : "Select a model in the Analysis page"}
            </p>
          </div>
        </div>
      )}

      {/* Ready state */}
      {!notReady && (
        <>
          {/* Preset chips */}
          <div className="flex flex-wrap gap-1.5 border-b border-[var(--border)] p-3">
            <p className="w-full text-[9px] uppercase tracking-wider text-[var(--text-3)] mb-0.5">
              Quick prompts
            </p>
            {PRESET_QUERIES.map((chip) => (
              <button
                key={chip}
                onClick={() => handleChip(chip)}
                disabled={aiMutation.isPending}
                className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--text-2)] transition-colors hover:border-[var(--clr-cyan)] hover:text-[var(--clr-cyan)] disabled:opacity-40"
              >
                {chip}
              </button>
            ))}
          </div>

          {/* Input */}
          <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe what you're looking for…"
              disabled={aiMutation.isPending}
              className="flex-1 rounded-md border border-[var(--border)] bg-[var(--bg-0)] px-2.5 py-1.5 text-[11px] text-[var(--text-1)] placeholder:text-[var(--text-3)] outline-none transition-all focus:border-[var(--clr-cyan)] disabled:opacity-50"
            />
            <button
              onClick={handleSubmit}
              disabled={!query.trim() || aiMutation.isPending}
              className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-0)] text-[var(--text-3)] transition-colors hover:border-[var(--clr-cyan)] hover:text-[var(--clr-cyan)] disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {aiMutation.isPending ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Send size={13} />
              )}
            </button>
          </div>

          {/* Results */}
          <div className="flex-1 overflow-y-auto p-3">
            {/* Loading */}
            {aiMutation.isPending && (
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <Loader2 size={20} className="animate-spin text-[var(--clr-cyan)]" />
                <p className="text-[10px] text-[var(--text-3)]">
                  Generating filters…
                </p>
              </div>
            )}

            {/* Error */}
            {error && !aiMutation.isPending && (
              <div className="flex items-start gap-2 rounded-lg border border-[var(--clr-red)]/20 bg-[var(--clr-red)]/5 p-3">
                <AlertCircle size={13} className="flex-shrink-0 text-[var(--clr-red)] mt-0.5" />
                <p className="text-[10px] text-[var(--clr-red)]">{error}</p>
              </div>
            )}

            {/* Empty state */}
            {!aiMutation.isPending && !error && suggestions.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <Sparkles size={20} className="text-[var(--text-3)]" />
                <p className="text-[11px] text-[var(--text-2)]">
                  Ask me what you're looking for
                </p>
                <p className="text-[10px] text-[var(--text-3)]">
                  I'll translate it into IBKR filter codes
                </p>
              </div>
            )}

            {/* Suggestions */}
            {!aiMutation.isPending && suggestions.length > 0 && (
              <div className="flex flex-col gap-2">
                {/* Summary */}
                {summary && (
                  <p className="text-[10px] leading-relaxed text-[var(--text-2)] pb-1 border-b border-[var(--border)]">
                    {summary}
                  </p>
                )}

                {/* Filter cards — classification is recomputed per render
                    so any external change (filter removed, scanner switched,
                    Try-this card applied) is reflected immediately. */}
                {suggestions.map((s) => {
                  const { state, existing } = classifySuggestion(s, filters);
                  return (
                    <SuggestionCard
                      key={s.code}
                      suggestion={s}
                      state={state}
                      existing={existing}
                      onAdd={() => handleAddSuggestion(s)}
                    />
                  );
                })}

                {/* Apply all — visible whenever any suggestion is "new" or
                    "differs" (i.e. would do something). Hidden only when
                    every suggestion already matches the filter bar exactly. */}
                {suggestions.some(
                  (s) => classifySuggestion(s, filters).state !== "duplicate",
                ) && (
                  <button
                    onClick={handleApplyAll}
                    className="mt-1 w-full rounded-lg border border-[var(--clr-cyan)]/30 bg-[var(--clr-cyan)]/10 py-2 text-[11px] font-medium text-[var(--clr-cyan)] transition-colors hover:bg-[var(--clr-cyan)]/20"
                  >
                    Apply All Filters
                  </button>
                )}

                {/* All applied — every suggestion already in the bar with
                    the same value the AI suggested. */}
                {suggestions.length > 0 &&
                  suggestions.every(
                    (s) => classifySuggestion(s, filters).state === "duplicate",
                  ) && (
                    <div className="flex items-center justify-center gap-1.5 rounded-lg border border-[var(--clr-green)]/20 bg-[var(--clr-green)]/5 py-2 text-[10px] text-[var(--clr-green)]">
                      <CheckCircle2 size={12} />
                      All filters added — click Scan
                    </div>
                  )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
