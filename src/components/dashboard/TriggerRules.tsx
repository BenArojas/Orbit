/**
 * Trigger Rules Section — Task 3.7
 *
 * Compact list of trigger rules in the sidebar, plus a modal to create new ones.
 * Each rule shows:
 *   - LED indicator (green dot = enabled, gray = paused)
 *   - Rule name
 *   - Hit count (how many times it's fired)
 *
 * The "create" modal lets the user set up a new trigger rule by filling in:
 *   - Stock (symbol search)
 *   - Indicator (dropdown)
 *   - Condition (above/below/crosses)
 *   - Threshold value
 *   - Source and target IBKR watchlists
 *   - Optional auto-expire days
 *
 * Design from mockup: compact rows with LED dots, small text, minimal chrome.
 */

import { useState, useCallback } from "react";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  api,
  ApiError,
  type TriggerRule,
  type TriggerRuleCreate,
  type TriggerHit,
  type NewsCandleMethod,
} from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSettingsStore } from "@/store/settings";

// ── Indicator options for the create form ──────────────────

const INDICATOR_OPTIONS = [
  { value: "rsi", label: "RSI (14)" },
  { value: "macd", label: "MACD" },
  { value: "ema_9", label: "EMA 9" },
  { value: "ema_21", label: "EMA 21" },
  { value: "ema_50", label: "EMA 50" },
  { value: "ema_200", label: "EMA 200" },
  { value: "fibonacci", label: "Fibonacci" },
  { value: "volume", label: "Volume" },
  { value: "bbands", label: "Bollinger Bands" },
  { value: "vwap", label: "VWAP" },
  { value: "atr", label: "ATR (14)" },
  { value: "stoch", label: "Stochastic" },
  { value: "obv", label: "OBV" },
  { value: "adx", label: "ADX (14)" },
  { value: "news_candle", label: "News Candle" },
];

const CONDITION_OPTIONS = [
  { value: "above", label: "Above" },
  { value: "below", label: "Below" },
  { value: "crosses_above", label: "Crosses Above" },
  { value: "crosses_below", label: "Crosses Below" },
];

// news_candle detection methods (Phase 6.6).
// Threshold meaning is method-specific:
//   volume_spike / range_spike — multiplier of the 20-bar average (e.g. 3.0)
//   gap                         — absolute % gap vs prev close (e.g. 2.0 = 2%)
//   long_wick                   — wick-to-body ratio (e.g. 3.0)
const NEWS_CANDLE_METHODS: { value: NewsCandleMethod; label: string; hint: string }[] = [
  { value: "volume_spike", label: "Volume Spike", hint: "× 20-bar avg volume" },
  { value: "range_spike", label: "Range Spike", hint: "× 20-bar avg range" },
  { value: "gap", label: "Gap", hint: "% |open − prev.close|" },
  { value: "long_wick", label: "Long Wick", hint: "max(wick) ÷ body" },
];

// ── Compact Rule Row ───────────────────────────────────────

function RuleRow({
  rule,
  hitCount,
  onToggle,
  onDelete,
}: {
  rule: TriggerRule;
  hitCount: number;
  onToggle: (id: number, enabled: boolean) => void;
  onDelete: (id: number) => void;
}) {
  return (
    <div className="group flex items-center gap-2 px-3.5 py-[6px] transition-colors hover:bg-[var(--bg-3)]">
      {/* LED indicator */}
      <button
        onClick={() => onToggle(rule.id, !rule.enabled)}
        className="shrink-0"
        title={rule.enabled ? "Click to pause" : "Click to enable"}
      >
        <div
          className="h-[5px] w-[5px] rounded-full"
          style={{
            backgroundColor: rule.enabled ? "var(--clr-green)" : "var(--text-3)",
            boxShadow: rule.enabled ? "0 0 6px var(--clr-green)" : "none",
          }}
        />
      </button>

      {/* Rule name */}
      <span className="min-w-0 flex-1 truncate text-[10px] text-[var(--text-2)]">
        {rule.name}
      </span>

      {/* Hit count */}
      <span className="font-data text-[10px] text-[var(--text-3)]">
        {hitCount}
      </span>

      {/* Delete button (visible on hover) */}
      <button
        onClick={() => onDelete(rule.id)}
        className="ml-1 hidden text-[10px] text-[var(--text-3)] transition-colors hover:text-[var(--clr-red)] group-hover:block"
        title="Delete rule"
      >
        x
      </button>
    </div>
  );
}

// ── Global Notifications Toggle ────────────────────────────

/**
 * Small bell icon in the Trigger Rules header. Flips the global
 * `notifications_enabled` setting so desktop alerts turn on/off.
 */
function NotificationsToggle() {
  const enabled = useSettingsStore((s) => s.notificationsEnabled);
  const setEnabled = useSettingsStore((s) => s.setNotificationsEnabled);

  return (
    <button
      onClick={() => setEnabled(!enabled)}
      title={enabled ? "Desktop alerts on — click to mute" : "Desktop alerts muted — click to enable"}
      className="flex h-5 w-5 items-center justify-center rounded transition-colors hover:bg-[var(--bg-3)]"
    >
      <span
        aria-hidden
        className="text-[11px] leading-none"
        style={{
          color: enabled ? "var(--clr-cyan)" : "var(--text-3)",
          textShadow: enabled ? "0 0 6px var(--glow-cyan)" : "none",
        }}
      >
        {enabled ? "🔔" : "🔕"}
      </span>
    </button>
  );
}

// ── Mutation error helper ──────────────────────────────────

function mutationErrorMessage(action: string, err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401 || err.status === 403)
      return `${action}: not authorized — reconnect to IBKR and try again`;
    if (err.status === 429) return `${action}: rate limited — wait a moment and retry`;
    if (err.status >= 400 && err.status < 500)
      return err.message || `${action}: invalid request`;
  }
  if (err instanceof TypeError) return `${action}: cannot reach backend — check your connection`;
  return `${action}: unexpected error`;
}

// ── Create Rule Modal ──────────────────────────────────────

function CreateRuleModal() {
  const [open, setOpen] = useState(false);
  const [symbolError, setSymbolError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    symbol: "",
    conid: 0,
    indicator: "rsi",
    condition: "below",
    threshold: 30,
    target_watchlist: "",
    source_watchlist: "",
    timeframe: "1D",
    auto_expire_days: null as number | null,
    news_candle_method: null as NewsCandleMethod | null,
  });

  const isNewsCandle = form.indicator === "news_candle";

  const queryClient = useQueryClient();

  // Resolve symbol to conid when the user presses Enter / clicks Resolve.
  // `form.symbol` is captured into `attempted` at call time so the error
  // message always reflects the symbol the request was made for, even if
  // the field value changes before the response arrives.
  const resolveSymbol = useCallback(async () => {
    const attempted = form.symbol.toUpperCase();
    if (!attempted) return;
    setSymbolError(null);
    try {
      const result = await api.resolveConid(attempted);
      setForm((prev) => ({
        ...prev,
        conid: result.conid,
        symbol: result.symbol,
      }));
    } catch (err) {
      const isNotFound =
        err instanceof ApiError && err.status === 404;
      setSymbolError(
        isNotFound
          ? `Symbol "${attempted}" not found`
          : `Could not resolve "${attempted}" — check your connection and try again`,
      );
    }
  }, [form.symbol]);

  const createMutation = useMutation({
    mutationFn: (rule: TriggerRuleCreate) => api.createTriggerRule(rule),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trigger-rules"] });
      toast.success("Trigger rule created");
      setOpen(false);
      resetForm();
    },
    onError: (err) => toast.error(mutationErrorMessage("Failed to create trigger rule", err)),
  });

  function resetForm() {
    setForm({
      name: "",
      symbol: "",
      conid: 0,
      indicator: "rsi",
      condition: "below",
      threshold: 30,
      target_watchlist: "",
      source_watchlist: "",
      timeframe: "1D",
      auto_expire_days: null,
      news_candle_method: null,
    });
  }

  function handleIndicatorChange(value: string) {
    if (value === "news_candle") {
      // Default news_candle rules to gap detection with the "fires" condition.
      setForm((prev) => ({
        ...prev,
        indicator: value,
        condition: "fires",
        news_candle_method: prev.news_candle_method ?? "gap",
      }));
    } else {
      // Leaving news_candle — restore a sane default condition.
      setForm((prev) => ({
        ...prev,
        indicator: value,
        condition: prev.condition === "fires" ? "below" : prev.condition,
        news_candle_method: null,
      }));
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.conid || !form.name || !form.target_watchlist || !form.source_watchlist) return;
    if (isNewsCandle && !form.news_candle_method) return;

    createMutation.mutate({
      name: form.name,
      conid: form.conid,
      symbol: form.symbol,
      indicator: form.indicator,
      condition: isNewsCandle ? "fires" : form.condition,
      threshold: form.threshold,
      target_watchlist: form.target_watchlist,
      source_watchlist: form.source_watchlist,
      timeframe: form.timeframe,
      auto_expire_days: form.auto_expire_days,
      news_candle_method: isNewsCandle ? form.news_candle_method : null,
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 px-1.5 text-[9px] text-[var(--text-3)] hover:text-[var(--clr-cyan)]"
        >
          + Add
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md border-border bg-[var(--bg-2)]">
        <DialogHeader>
          <DialogTitle className="text-sm text-[var(--text-1)]">
            Create Trigger Rule
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {/* Rule name */}
          <div>
            <label className="mb-1 block text-[10px] text-[var(--text-3)]">Rule Name</label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g., AAPL RSI Oversold"
              className="h-8 bg-[var(--bg-1)] text-xs"
            />
          </div>

          {/* Symbol + resolve */}
          <div>
            <label className="mb-1 block text-[10px] text-[var(--text-3)]">Symbol</label>
            <div className="flex gap-2">
              <Input
                value={form.symbol}
                onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase() })}
                placeholder="AAPL"
                className="h-8 bg-[var(--bg-1)] font-data text-xs"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={resolveSymbol}
                className="h-8 text-[10px]"
              >
                Resolve
              </Button>
            </div>
            {form.conid > 0 && (
              <span className="mt-0.5 block font-data text-[9px] text-[var(--clr-green)]">
                conid: {form.conid}
              </span>
            )}
            {symbolError && (
              <span className="mt-0.5 block text-[9px] text-[var(--clr-red)]">
                {symbolError}
              </span>
            )}
          </div>

          {/* Indicator + (Condition | Method) + Threshold */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="mb-1 block text-[10px] text-[var(--text-3)]">Indicator</label>
              <select
                value={form.indicator}
                onChange={(e) => handleIndicatorChange(e.target.value)}
                className="h-8 w-full rounded-md border border-border bg-[var(--bg-1)] px-2 text-[10px] text-[var(--text-1)]"
              >
                {INDICATOR_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] text-[var(--text-3)]">
                {isNewsCandle ? "Method" : "Condition"}
              </label>
              {isNewsCandle ? (
                <select
                  value={form.news_candle_method ?? "gap"}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      news_candle_method: e.target.value as NewsCandleMethod,
                    })
                  }
                  className="h-8 w-full rounded-md border border-border bg-[var(--bg-1)] px-2 text-[10px] text-[var(--text-1)]"
                >
                  {NEWS_CANDLE_METHODS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              ) : (
                <select
                  value={form.condition}
                  onChange={(e) => setForm({ ...form, condition: e.target.value })}
                  className="h-8 w-full rounded-md border border-border bg-[var(--bg-1)] px-2 text-[10px] text-[var(--text-1)]"
                >
                  {CONDITION_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <label className="mb-1 block text-[10px] text-[var(--text-3)]">Threshold</label>
              <Input
                type="number"
                value={form.threshold}
                onChange={(e) => setForm({ ...form, threshold: Number(e.target.value) })}
                className="h-8 bg-[var(--bg-1)] font-data text-xs"
              />
            </div>
          </div>

          {/* Method hint — only for news_candle */}
          {isNewsCandle && form.news_candle_method && (
            <div className="-mt-1 font-data text-[9px] text-[var(--text-3)]">
              Threshold:{" "}
              {
                NEWS_CANDLE_METHODS.find((m) => m.value === form.news_candle_method)
                  ?.hint
              }
            </div>
          )}

          {/* Watchlists */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[10px] text-[var(--text-3)]">
                Source Watchlist
              </label>
              <Input
                value={form.source_watchlist}
                onChange={(e) => setForm({ ...form, source_watchlist: e.target.value })}
                placeholder="My Stocks"
                className="h-8 bg-[var(--bg-1)] text-xs"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] text-[var(--text-3)]">
                Target Watchlist
              </label>
              <Input
                value={form.target_watchlist}
                onChange={(e) => setForm({ ...form, target_watchlist: e.target.value })}
                placeholder="RSI Oversold"
                className="h-8 bg-[var(--bg-1)] text-xs"
              />
            </div>
          </div>

          {/* Timeframe + Auto-expire */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[10px] text-[var(--text-3)]">Timeframe</label>
              <select
                value={form.timeframe}
                onChange={(e) => setForm({ ...form, timeframe: e.target.value })}
                className="h-8 w-full rounded-md border border-border bg-[var(--bg-1)] px-2 text-[10px] text-[var(--text-1)]"
              >
                <option value="1D">Daily</option>
                <option value="1W">Weekly</option>
                <option value="1M">Monthly</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] text-[var(--text-3)]">
                Auto-expire (days)
              </label>
              <Input
                type="number"
                value={form.auto_expire_days ?? ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    auto_expire_days: e.target.value ? Number(e.target.value) : null,
                  })
                }
                placeholder="None"
                className="h-8 bg-[var(--bg-1)] font-data text-xs"
              />
            </div>
          </div>

          {/* Submit */}
          <Button
            type="submit"
            disabled={createMutation.isPending || !form.conid || !form.name}
            className="bg-gradient-cta text-sm font-semibold"
          >
            {createMutation.isPending ? "Creating..." : "Create Rule"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Trigger Rules Section ─────────────────────────────

export default function TriggerRules() {
  const queryClient = useQueryClient();

  const { data: rules, isLoading, isError } = useQuery<TriggerRule[]>({
    queryKey: ["trigger-rules"],
    queryFn: () => api.getTriggerRules(),
    staleTime: 30_000,
  });

  const { data: hits } = useQuery<TriggerHit[]>({
    queryKey: ["trigger-hits"],
    queryFn: () => api.getTriggerHits(200),
    staleTime: 30_000,
  });

  // Count hits per rule
  const hitCounts = new Map<number, number>();
  hits?.forEach((h) => {
    hitCounts.set(h.rule_id, (hitCounts.get(h.rule_id) ?? 0) + 1);
  });

  // Toggle enabled/disabled
  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      api.updateTriggerRule(id, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["trigger-rules"] }),
    onError: (err) => toast.error(mutationErrorMessage("Failed to update trigger rule", err)),
  });

  // Delete rule
  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteTriggerRule(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trigger-rules"] });
      queryClient.invalidateQueries({ queryKey: ["trigger-hits"] });
    },
    onError: (err) => toast.error(mutationErrorMessage("Failed to delete trigger rule", err)),
  });

  function handleToggle(id: number, enabled: boolean) {
    toggleMutation.mutate({ id, enabled });
  }

  function handleDelete(id: number) {
    deleteMutation.mutate(id);
  }

  return (
    <div className="flex flex-col">
      {/* Section header */}
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-t border-border bg-[var(--bg-1)]/80 px-3.5 py-2 backdrop-blur">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
          Trigger Rules
        </span>
        <div className="flex items-center gap-1">
          <NotificationsToggle />
          <CreateRuleModal />
        </div>
      </div>

      {/* Rule list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-4">
          <span className="text-[10px] text-[var(--text-3)]">Loading...</span>
        </div>
      ) : isError ? (
        <div className="flex items-center justify-center py-4">
          <span className="text-[10px] text-[var(--clr-red)]">Failed to load rules</span>
        </div>
      ) : !rules || rules.length === 0 ? (
        <div className="flex items-center justify-center py-4">
          <span className="text-[10px] text-[var(--text-3)]">
            No trigger rules yet
          </span>
        </div>
      ) : (
        <div className="flex flex-col">
          {rules.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              hitCount={hitCounts.get(rule.id) ?? 0}
              onToggle={handleToggle}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
