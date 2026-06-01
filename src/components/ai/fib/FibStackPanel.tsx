/**
 * FibStackPanel — multi-fib container in the AI sidebar.
 *
 * Reads `activeFibs` from the chart store and renders:
 *   - Header: count badge ("Fibs on chart: N") + "Lock this fib" button.
 *     The count badge turns yellow at FIB_STACK_SOFT_CAP (5+ fibs).
 *   - Primary card: the existing FibScoreCard with the full score
 *     breakdown, glossary, editable weights, candidates list. Reads
 *     activeFibs[0] from the store.
 *   - Locked cards: compact FibLockedCard rows for each locked fib.
 *
 * This component is the public entry the AiChatPanel renders. The old
 * FibScoreCard is still exported for tests but is no longer the
 * top-level fib UI.
 *
 * Branch 4 / plan item 8 of docs/fibonacci-improvements-plan.md.
 */

import { useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useChartStore } from "@/store/chart";
import { FIB_STACK_SOFT_CAP, FIB_STACK_HARD_CAP } from "@/store/chart";
import { api, type FibonacciResult, type TriggerRuleCreate } from "@/lib/api";
import {
  useLockedFibs,
  useLockFib,
  useUnlockFib,
  useClearLockedFibs,
} from "@/hooks/useLockedFibs";
import type { ActiveFib } from "@/store/chart";

import FibScoreCard from "../FibScoreCard";
import FibLockedCard from "./FibLockedCard";

const GOLDEN_POCKET_CORE_LEVELS = [0.618, 0.65];

function findLevel(result: FibonacciResult, level: number) {
  return result.levels.find((l) => Math.abs(l.level - level) < 0.0001);
}

function getGoldenPocketBounds(result: FibonacciResult) {
  const coreLevels = GOLDEN_POCKET_CORE_LEVELS
    .map((level) => findLevel(result, level))
    .filter((level): level is NonNullable<typeof level> => level != null);
  const levels = coreLevels.length === GOLDEN_POCKET_CORE_LEVELS.length
    ? coreLevels
    : result.levels.filter((level) => level.golden_pocket);

  if (levels.length < 2) return null;

  const prices = levels.map((level) => level.price);
  return {
    lower: Math.min(...prices),
    upper: Math.max(...prices),
  };
}

function buildFibTriggerRule({
  conid,
  symbol,
  timeframe,
  result,
}: {
  conid: number;
  symbol: string;
  timeframe: string;
  result: FibonacciResult;
}): TriggerRuleCreate | null {
  const bounds = getGoldenPocketBounds(result);
  if (!bounds || result.no_active_fib) return null;

  const displaySymbol = symbol || `Conid ${conid}`;
  return {
    name: `Fib golden pocket: ${displaySymbol} ${timeframe}`,
    enabled: true,
    timeframe,
    scan_interval_seconds: 300,
    watchlist_name: null,
    conid,
    symbol: symbol || null,
    template_id: null,
    ibkr_mirror_target: null,
    conditions: [
      {
        indicator: "close",
        condition: "above",
        threshold: bounds.lower,
        news_candle_method: null,
      },
      {
        indicator: "close",
        condition: "below",
        threshold: bounds.upper,
        news_candle_method: null,
      },
    ],
  };
}

/**
 * No props — FibStackPanel reads everything it needs (active conid,
 * timeframe, active fibs) from the chart store. This keeps the
 * AiChatPanel callsite simple and avoids prop drilling.
 */
export default function FibStackPanel() {
  const activeFibs = useChartStore((s) => s.activeFibs);
  const conid = useChartStore((s) => s.activeConid);
  const symbol = useChartStore((s) => s.activeSymbol);
  const timeframe = useChartStore((s) => s.timeframe);
  const qc = useQueryClient();

  // Keep the lock list query mounted so its side-effect (merging
  // locked fibs into activeFibs) stays alive.
  useLockedFibs(conid);
  const toggleFibVisibility = useChartStore((s) => s.toggleFibVisibility);
  const lockMutation = useLockFib();
  const unlockMutation = useUnlockFib();
  const clearMutation = useClearLockedFibs();
  const createTriggerMutation = useMutation({
    mutationFn: (rule: TriggerRuleCreate) => api.createTriggerRule(rule),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["trigger-rules"] });
      toast.success("Fib trigger created");
    },
    onError: (err) =>
      toast.error(
        `Could not create fib trigger: ${
          err instanceof Error ? err.message : String(err)
        }`,
      ),
  });

  const primary: ActiveFib | undefined = activeFibs[0]?.id === "primary"
    ? activeFibs[0]
    : undefined;
  const locked = useMemo(
    () => activeFibs.filter((f) => f.source === "locked"),
    [activeFibs],
  );

  // Total stored fibs drives the lock caps (hidden fibs still occupy a
  // slot on the server). The header label, though, reports how many are
  // actually painted on the chart right now — hidden ones don't count.
  const count = activeFibs.length;
  const visibleCount = useMemo(
    () =>
      activeFibs.filter((f) =>
        f.source === "locked" ? !f.hidden : !f.result.no_active_fib,
      ).length,
    [activeFibs],
  );
  const atSoftCap = count >= FIB_STACK_SOFT_CAP;
  const atHardCap = count >= FIB_STACK_HARD_CAP;

  const handleLockPrimary = () => {
    if (!primary || !conid) return;
    if (atHardCap) return;
    const r = primary.result;
    lockMutation.mutate({
      conid,
      timeframe,
      tool_type: r.tool_mode,
      swing_high_price: r.swing_high,
      swing_high_time: r.swing_high_time,
      swing_low_price: r.swing_low,
      swing_low_time: r.swing_low_time,
      direction: r.direction,
    });
  };

  const handleCreateFibTrigger = () => {
    if (!primary || conid == null) return;
    const rule = buildFibTriggerRule({
      conid,
      symbol,
      timeframe,
      result: primary.result,
    });
    if (!rule) {
      toast.error("This fib has no golden pocket levels to alert on");
      return;
    }
    createTriggerMutation.mutate(rule);
  };

  const handleUnlock = (fib: ActiveFib) => {
    if (!conid || fib.lockId == null) return;
    unlockMutation.mutate({ id: fib.lockId, conid });
  };

  const handleClearAll = () => {
    if (conid == null) return;
    clearMutation.mutate(conid);
  };

  const handleToggleVisibility = (fib: ActiveFib) => {
    toggleFibVisibility(fib.id);
  };

  // Nothing to render when no fibs are active and no primary is
  // expected (e.g., indicator off). The caller already gates on
  // fibonacci availability, but bailing here keeps DOM clean.
  if (count === 0 && !primary) {
    return null;
  }

  return (
    <div
      data-testid="fib-stack-panel"
      className="flex flex-col gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-1)] p-2"
    >
      {/* ── Header: count + lock button ── */}
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2">
          <span
            data-testid="fib-stack-count"
            className="rounded px-1.5 py-0.5 font-data text-[10px] font-semibold uppercase tracking-wider"
            style={{
              color: atSoftCap
                ? "var(--clr-amber,#ff9f1c)"
                : "var(--text-2)",
              background: atSoftCap
                ? "rgba(255,159,28,0.12)"
                : "rgba(255,255,255,0.05)",
            }}
            title={
              atSoftCap
                ? `${count}/${FIB_STACK_HARD_CAP} — chart is getting crowded`
                : undefined
            }
          >
            Fibs on chart: {visibleCount}
          </span>
          {atSoftCap && (
            <span
              data-testid="fib-stack-soft-warning"
              className="font-data text-[10px] text-[var(--clr-amber,#ff9f1c)]"
            >
              {atHardCap
                ? "Max reached — remove one before locking another."
                : "Many fibs on the chart — readability may suffer."}
            </span>
          )}
        </div>

        {primary && conid != null && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleCreateFibTrigger}
              disabled={
                createTriggerMutation.isPending
                || primary.result.no_active_fib
                || getGoldenPocketBounds(primary.result) == null
              }
              data-testid="fib-create-alert-button"
              title="Create a trigger when price enters this fib's golden pocket"
              className="rounded border border-[var(--border)] px-2 py-0.5 font-data text-[10px] font-semibold text-[var(--text-2)] transition-colors hover:border-[var(--clr-cyan)] hover:text-[var(--clr-cyan)] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {createTriggerMutation.isPending ? "Creating…" : "Create alert"}
            </button>
            <button
              type="button"
              onClick={handleLockPrimary}
              disabled={
                atHardCap
                || lockMutation.isPending
                || primary.result.no_active_fib
              }
              data-testid="fib-lock-primary-button"
              title={
                atHardCap
                  ? "Maximum number of locked fibs reached"
                  : "Lock the current primary fib so it stays on every timeframe"
              }
              className="rounded border border-[var(--clr-cyan)] bg-[var(--glow-cyan)] px-2 py-0.5 font-data text-[10px] font-semibold text-[var(--clr-cyan)] transition-all hover:shadow-[0_0_8px_var(--glow-cyan)] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {lockMutation.isPending ? "Locking…" : "Lock this fib"}
            </button>
          </div>
        )}
      </div>

      {/* ── Primary card ── */}
      {primary && <FibScoreCard fibonacci={primary.result} />}

      {/* ── Locked cards ── */}
      {locked.length > 0 && (
        <div
          data-testid="fib-locked-list"
          className="flex flex-col gap-1.5"
        >
          <div className="flex items-center justify-between px-1">
            <span className="font-data text-[10px] uppercase tracking-wider text-[var(--text-3)]">
              Locked ({locked.length})
            </span>
            <button
              type="button"
              onClick={handleClearAll}
              disabled={clearMutation.isPending}
              data-testid="fib-clear-all-button"
              title="Remove every locked fib for this instrument"
              className="rounded border border-transparent px-1.5 py-0.5 font-data text-[10px] text-[var(--text-3)] transition-colors hover:border-[var(--clr-red)] hover:text-[var(--clr-red)] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {clearMutation.isPending ? "Clearing…" : "Clear all"}
            </button>
          </div>
          {locked.map((fib, i) => (
            <FibLockedCard
              key={fib.id}
              fib={fib}
              index={i + 1}
              onDelete={handleUnlock}
              onToggleVisibility={handleToggleVisibility}
              isDeleting={unlockMutation.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}
