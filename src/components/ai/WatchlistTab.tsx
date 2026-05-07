/**
 * WatchlistTab — Manage which IBKR watchlists contain the active instrument.
 *
 * Renders a checkbox row per watchlist. Checking adds the conid; unchecking
 * removes it. Uses the membership endpoint to seed initial state, then updates
 * optimistically so the UI feels instant.
 *
 * Rules:
 *   - Never stores or compares by ticker string — all ops use conid.
 *   - All data flows through the FastAPI sidecar (/watchlist/*).
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

interface WatchlistTabProps {
  /** IBKR contract ID of the currently displayed instrument */
  activeConid: number | null;
  /** Display symbol — shown in the empty state message */
  activeSymbol: string;
}

export default function WatchlistTab({ activeConid, activeSymbol }: WatchlistTabProps) {
  const qc = useQueryClient();

  // All watchlists for this account
  const { data: watchlists, isLoading: loadingLists } = useQuery({
    queryKey: ["watchlists"],
    queryFn: () => api.getWatchlists(),
    staleTime: 30_000,
  });

  // Which watchlists contain this conid
  const { data: membership, isLoading: loadingMembership } = useQuery({
    queryKey: ["watchlist-membership", activeConid],
    queryFn: () => api.watchlistMembership(activeConid!),
    enabled: activeConid != null,
    staleTime: 10_000,
  });

  const memberSet = new Set(membership?.watchlist_ids ?? []);

  const addMutation = useMutation({
    mutationFn: ({ watchlistId }: { watchlistId: string }) =>
      api.watchlistAddInstrument(watchlistId, activeConid!),
    onSuccess: (_data, { watchlistId }) => {
      // Re-check membership for this stock
      qc.invalidateQueries({ queryKey: ["watchlist-membership", activeConid] });
      // Bust the dashboard sidebar's instrument cache for this watchlist so it
      // reflects the new item immediately (staleTime: Infinity means it won't
      // refetch on its own without an explicit invalidation).
      qc.invalidateQueries({ queryKey: ["watchlist-instruments", watchlistId] });
    },
  });

  const removeMutation = useMutation({
    mutationFn: ({ watchlistId }: { watchlistId: string }) =>
      api.watchlistRemoveInstrument(watchlistId, activeConid!),
    onSuccess: (_data, { watchlistId }) => {
      qc.invalidateQueries({ queryKey: ["watchlist-membership", activeConid] });
      qc.invalidateQueries({ queryKey: ["watchlist-instruments", watchlistId] });
    },
  });

  const handleToggle = (watchlistId: string, currentlyIn: boolean) => {
    if (!activeConid) return;
    if (currentlyIn) {
      removeMutation.mutate({ watchlistId });
    } else {
      addMutation.mutate({ watchlistId });
    }
  };

  // ── Render ──

  if (!activeConid) {
    return (
      <div className="flex h-full items-center justify-center px-4">
        <p className="text-center text-[11px] text-[var(--text-3)]">
          Select a symbol to manage watchlists.
        </p>
      </div>
    );
  }

  const isLoading = loadingLists || loadingMembership;
  const isMutating = addMutation.isPending || removeMutation.isPending;

  return (
    <div className="flex flex-col gap-1 overflow-y-auto px-4 py-3">
      {/* Header */}
      <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
        {activeSymbol || "Symbol"} — Watchlists
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-4 text-[11px] text-[var(--text-3)]">
          <div className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--clr-cyan)] border-t-transparent" />
          Loading watchlists…
        </div>
      ) : !watchlists || watchlists.length === 0 ? (
        <p className="py-4 text-[11px] text-[var(--text-3)]">
          No watchlists found. Create one in Interactive Brokers first.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {watchlists.map((wl) => {
            const isMember = memberSet.has(wl.id);
            return (
              <li key={wl.id}>
                <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-[var(--bg-2)]">
                  <input
                    type="checkbox"
                    checked={isMember}
                    disabled={isMutating}
                    onChange={() => handleToggle(wl.id, isMember)}
                    className="accent-[var(--clr-cyan)] disabled:opacity-50"
                    aria-label={`Toggle ${wl.name}`}
                  />
                  <span className="text-[11px] text-[var(--text-2)]">{wl.name}</span>
                  {isMember && (
                    <span className="ml-auto text-[9px] text-[var(--clr-cyan)]">✓</span>
                  )}
                </label>
              </li>
            );
          })}
        </ul>
      )}

      {/* Mutation error */}
      {(addMutation.isError || removeMutation.isError) && (
        <p className="mt-2 rounded-md border border-[var(--clr-red)] bg-[rgba(255,68,102,0.08)] px-2 py-1.5 text-[10px] text-[var(--clr-red)]">
          {((addMutation.error || removeMutation.error) as Error)?.message ?? "Operation failed"}
        </p>
      )}
    </div>
  );
}
