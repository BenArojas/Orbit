/**
 * TanStack Query hooks for locked Fibonacci CRUD.
 *
 * Locked fibs persist across app restarts (stored in SQLite) and render
 * on ALL timeframes. These hooks wrap the three lock endpoints:
 *   POST   /fibonacci/lock         → useLockFib()
 *   DELETE /fibonacci/lock/{id}    → useUnlockFib()
 *   GET    /fibonacci/locks/{conid} → useLockedFibs(conid)
 *
 * Branch 4: the GET hook also publishes each lock into the chart
 * store's `activeFibs` array so the overlay and FibStackPanel can
 * render them without re-implementing the merge logic.
 */

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type {
  FibonacciLevel,
  FibonacciResult,
  LockFibonacciRequest,
  LockedFibonacciResponse,
} from "@/lib/api";
import { useChartStore } from "@/store/chart";
import { useFibConfig } from "./useFibConfig";
import { buildLevelsFromCandidate, GOLDEN_POCKET_RATIOS } from "@/lib/fib";

// ── Query key factory ────────────────────────────────────────

const LOCKED_FIBS_KEY = "locked-fibs";

function lockedFibsKey(conid: number) {
  return [LOCKED_FIBS_KEY, conid] as const;
}

// ── Synthesize a FibonacciResult from a locked DB row ────────
//
// Locked fibs are stored as raw swing endpoints (high/low price + time
// + direction). The chart overlay needs level prices to render — we
// reuse the Branch 3 `buildLevelsFromCandidate` math so the displayed
// levels match exactly what the user drew. Score / clarity / candidate
// metadata is unavailable for locked fibs (they were never scored by
// the server), so those fields carry zero / placeholder values.
//
// `ratios` and `extensionRatios` are sourced from /fibonacci/config so
// the level math agrees with the backend's canonical set.
function lockedFibToResult(
  lock: LockedFibonacciResponse,
  ratios: number[],
  extensionRatios: number[],
): FibonacciResult {
  const { levels, extensions } = buildLevelsFromCandidate(
    {
      swing_high: lock.swing_high_price,
      swing_low: lock.swing_low_price,
      direction: lock.direction,
    },
    ratios,
    extensionRatios,
  );
  return {
    tool_mode: lock.tool_type,
    swing_high: lock.swing_high_price,
    swing_low: lock.swing_low_price,
    swing_high_time: lock.swing_high_time,
    swing_low_time: lock.swing_low_time,
    direction: lock.direction,
    levels,
    extensions,
    score: 0,
    swing_clarity: 0,
    timeframe_clarity: "clean",
    candidates: [],
    convergence_zones: [],
    is_nested: false,
    parent_fib_id: null,
    reasoning: lock.user_note
      ? `Locked fib: ${lock.user_note}`
      : "Locked fib (user-drawn). Levels show on every timeframe.",
    source: "locked",
    no_active_fib: false,
    no_active_fib_reason: null,
  };
}

// Re-export so other modules can use the constant without crossing
// into lib/fib internals.
export { GOLDEN_POCKET_RATIOS };

// ── Helper: render locked fibs as ActiveFibs in the store ────
//
// Mounted alongside the GET query so the store always reflects the
// latest server snapshot. Bug-2 fix: this is now a FULL sync (replace
// the locked portion with whatever the server returned) rather than
// an append-only merge. The previous loop-and-addLockedFib pattern
// couldn't propagate removals, which made the unlock UX broken — see
// the comment on the chart store's replaceLockedFibs action for the
// full failure mode.
function useMergeLockedFibsIntoStore(
  lockedFibs: LockedFibonacciResponse[] | undefined,
): void {
  const replaceLockedFibs = useChartStore((s) => s.replaceLockedFibs);
  const { config: fibConfig } = useFibConfig();

  useEffect(() => {
    if (!lockedFibs || !fibConfig) return;
    const entries = lockedFibs.map((lock) => ({
      lockId: lock.id,
      result: lockedFibToResult(
        lock,
        fibConfig.ratios,
        fibConfig.extension_ratios,
      ),
    }));
    replaceLockedFibs(entries);
  }, [lockedFibs, fibConfig, replaceLockedFibs]);
}

// Re-exported alias to placate unused-import linters when consumers
// only want the side effect of merging. Not currently used externally.
export { lockedFibToResult };
// Re-export FibonacciLevel for consumers that build level lists.
export type { FibonacciLevel };

// ── Queries ──────────────────────────────────────────────────

/**
 * Fetch all locked fib drawings for an instrument.
 *
 * Enabled only when conid is truthy. The cache survives timeframe
 * switches because locked fibs show on ALL timeframes.
 */
export function useLockedFibs(conid: number | null) {
  const query = useQuery<LockedFibonacciResponse[]>({
    queryKey: lockedFibsKey(conid ?? 0),
    queryFn: () => api.getLockedFibs(conid!),
    enabled: conid != null && conid > 0,
    staleTime: 60_000,  // 1 min
    gcTime: 10 * 60_000, // 10 min
  });

  // Branch 4: surface each locked fib in the chart store's activeFibs
  // array. Side effect — the caller only cares about the query state.
  useMergeLockedFibsIntoStore(query.data);

  return query;
}

// ── Mutations ────────────────────────────────────────────────

/**
 * Lock a fib drawing.
 *
 * On success:
 *   - Optimistically merge the new lock into the TanStack Query cache
 *     so the FibStackPanel reflects it without waiting for a GET
 *     refetch (the merge effect then picks it up via replaceLockedFibs).
 *   - Clear `displayedFibOverride` so the primary "snaps back" to the
 *     auto-detected fib. Without this, locking a candidate-pick would
 *     leave the primary as the synthesized override result (with an
 *     empty candidates list) — the UX gap users hit as "lock removed
 *     my candidates panel."
 *   - Invalidate the lockedFibs query so the next render picks up
 *     any server-side changes we haven't anticipated.
 */
export function useLockFib() {
  const qc = useQueryClient();
  const clearDisplayedFib = useChartStore((s) => s.clearDisplayedFib);
  const addLockedFib = useChartStore((s) => s.addLockedFib);
  const removeActiveFib = useChartStore((s) => s.removeActiveFib);
  return useMutation({
    mutationFn: (req: LockFibonacciRequest) => api.lockFibonacci(req),
    // Synchronous optimistic write. `onMutate` runs the instant `mutate()`
    // is called — before the network request — so the just-drawn fib lands
    // in the lockedFibs cache (and from there into the chart store's
    // activeFibs via the merge effect) immediately.
    //
    // This closes a race: drawing a fib also toggles the `fibonacci`
    // indicator on, which triggers a chart-data refetch. If that refetch's
    // `no_active_fib: true` result arrived before the lock POST resolved,
    // AnalysisPage's guard would still see zero locked fibs and wrongly
    // toast + untoggle the indicator — hiding the fib the user just drew.
    // Optimistic insertion guarantees the locked fib is present before any
    // network response can win that race.
    onMutate: async (req) => {
      await qc.cancelQueries({ queryKey: lockedFibsKey(req.conid) });
      const previous = qc.getQueryData<LockedFibonacciResponse[]>(
        lockedFibsKey(req.conid),
      );
      // Negative id can't collide with a real (positive) SQLite row id.
      const tempId = -Date.now();
      const optimistic: LockedFibonacciResponse = {
        id: tempId,
        conid: req.conid,
        timeframe: req.timeframe,
        tool_type: req.tool_type,
        swing_high_price: req.swing_high_price,
        swing_high_time: req.swing_high_time,
        swing_low_price: req.swing_low_price,
        swing_low_time: req.swing_low_time,
        direction: req.direction,
        user_note: req.user_note ?? null,
        locked_at: new Date().toISOString(),
      };
      qc.setQueryData<LockedFibonacciResponse[]>(
        lockedFibsKey(req.conid),
        (prev) => (prev ? [...prev, optimistic] : [optimistic]),
      );
      const primary = useChartStore
        .getState()
        .activeFibs.find((fib) => fib.id === "primary");
      if (primary) {
        addLockedFib(tempId, { ...primary.result, source: "locked" });
      }
      return { previous, tempId };
    },
    onError: (_err, req, ctx) => {
      // Roll back to the snapshot taken in onMutate so a failed lock
      // doesn't leave a phantom fib on the chart.
      if (ctx?.previous !== undefined) {
        qc.setQueryData(lockedFibsKey(req.conid), ctx.previous);
      }
      if (ctx?.tempId != null) {
        removeActiveFib(`lock-${ctx.tempId}`);
      }
    },
    onSuccess: (data, req, ctx) => {
      // Swap the optimistic placeholder for the server's real row.
      qc.setQueryData<LockedFibonacciResponse[]>(
        lockedFibsKey(req.conid),
        (prev) => {
          const withoutTemp = (prev ?? []).filter((l) => l.id !== ctx?.tempId);
          // Dedupe by id in case the idempotent POST returned an id we
          // already have.
          if (withoutTemp.some((l) => l.id === data.id)) return withoutTemp;
          return [...withoutTemp, data];
        },
      );
      clearDisplayedFib();
      qc.invalidateQueries({ queryKey: lockedFibsKey(req.conid) });
    },
  });
}

/**
 * Unlock (remove) a locked fib drawing.
 * Requires the lock id AND the conid so we can invalidate the right query.
 *
 * Bug-2 fix: writes the optimistic removal directly into the query
 * cache BEFORE invalidation. Without this, the merge effect would
 * re-add the just-removed lock from the still-stale cache before the
 * refetch could complete.
 */
export function useClearLockedFibs() {
  const qc = useQueryClient();
  const replaceLockedFibs = useChartStore((s) => s.replaceLockedFibs);
  return useMutation({
    mutationFn: (conid: number) => api.clearLockedFibs(conid),
    onSuccess: (_data, conid) => {
      // Optimistic: empty the cached list and drop every locked entry
      // from the store so the chart re-paints with just the primary.
      qc.setQueryData<LockedFibonacciResponse[]>(lockedFibsKey(conid), []);
      replaceLockedFibs([]);
      qc.invalidateQueries({ queryKey: lockedFibsKey(conid) });
    },
  });
}

export function useUnlockFib() {
  const qc = useQueryClient();
  const removeActiveFib = useChartStore((s) => s.removeActiveFib);
  return useMutation({
    mutationFn: ({ id }: { id: number; conid: number }) =>
      api.unlockFibonacci(id),
    onSuccess: (_data, { conid, id }) => {
      // 1. Optimistic cache write — drop the lock from the cached
      //    list FIRST so any synchronous re-renders that read it
      //    see the right state.
      qc.setQueryData<LockedFibonacciResponse[]>(
        lockedFibsKey(conid),
        (prev) => prev?.filter((l) => l.id !== id) ?? [],
      );
      // 2. Optimistic store update — drop from activeFibs so the
      //    chart re-paints immediately.
      removeActiveFib(`lock-${id}`);
      // 3. Invalidate — schedule a confirming refetch.
      qc.invalidateQueries({ queryKey: lockedFibsKey(conid) });
    },
  });
}
