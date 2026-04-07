/**
 * TanStack Query hooks for locked Fibonacci CRUD.
 *
 * Locked fibs persist across app restarts (stored in SQLite) and render
 * on ALL timeframes. These hooks wrap the three lock endpoints:
 *   POST   /fibonacci/lock         → useLockFib()
 *   DELETE /fibonacci/lock/{id}    → useUnlockFib()
 *   GET    /fibonacci/locks/{conid} → useLockedFibs(conid)
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { LockFibonacciRequest, LockedFibonacciResponse } from "@/lib/api";

// ── Query key factory ────────────────────────────────────────

const LOCKED_FIBS_KEY = "locked-fibs";

function lockedFibsKey(conid: number) {
  return [LOCKED_FIBS_KEY, conid] as const;
}

// ── Queries ──────────────────────────────────────────────────

/**
 * Fetch all locked fib drawings for an instrument.
 *
 * Enabled only when conid is truthy. The cache survives timeframe
 * switches because locked fibs show on ALL timeframes.
 */
export function useLockedFibs(conid: number | null) {
  return useQuery<LockedFibonacciResponse[]>({
    queryKey: lockedFibsKey(conid ?? 0),
    queryFn: () => api.getLockedFibs(conid!),
    enabled: conid != null && conid > 0,
    staleTime: 60_000,  // 1 min
    gcTime: 10 * 60_000, // 10 min
  });
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
  return useMutation({
    mutationFn: ({ id }: { id: number; conid: number }) =>
      api.unlockFibonacci(id),
    onSuccess: (_data, { conid }) => {
      qc.invalidateQueries({ queryKey: lockedFibsKey(conid) });
    },
  });
}
