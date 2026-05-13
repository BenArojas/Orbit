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
// latest server snapshot. Dedupes via the store action's lockId check.
function useMergeLockedFibsIntoStore(
  lockedFibs: LockedFibonacciResponse[] | undefined,
): void {
  const addLockedFib = useChartStore((s) => s.addLockedFib);
  const activeFibs = useChartStore((s) => s.activeFibs);
  const { config: fibConfig } = useFibConfig();

  useEffect(() => {
    if (!lockedFibs || !fibConfig) return;
    // Any locked entry currently in the store that's no longer in the
    // server response should be dropped (e.g., the user deleted it
    // server-side from another tab). For v1 we accept that this won't
    // run mid-app since we only mutate locks from this client.
    for (const lock of lockedFibs) {
      const result = lockedFibToResult(
        lock,
        fibConfig.ratios,
        fibConfig.extension_ratios,
      );
      addLockedFib(lock.id, result);
    }
  }, [lockedFibs, fibConfig, addLockedFib, activeFibs.length]);
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
 * Invalidates the locked-fibs query for the instrument on success.
 */
export function useLockFib() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: LockFibonacciRequest) => api.lockFibonacci(req),
    onSuccess: (_data, req) => {
      qc.invalidateQueries({ queryKey: lockedFibsKey(req.conid) });
    },
  });
}

/**
 * Unlock (remove) a locked fib drawing.
 * Requires the lock id AND the conid so we can invalidate the right query.
 */
export function useUnlockFib() {
  const qc = useQueryClient();
  const removeActiveFib = useChartStore((s) => s.removeActiveFib);
  return useMutation({
    mutationFn: ({ id }: { id: number; conid: number }) =>
      api.unlockFibonacci(id),
    onSuccess: (_data, { conid, id }) => {
      qc.invalidateQueries({ queryKey: lockedFibsKey(conid) });
      // Branch 4: optimistically drop the lock from the active stack
      // so the chart updates immediately rather than waiting for the
      // GET refetch.
      removeActiveFib(`lock-${id}`);
    },
  });
}
