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

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { parallaxApi } from "@/modules/parallax/api";
import {
  useCreateWatchlist,
  useDeleteWatchlist,
} from "@/hooks/useWatchlistMutations";

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
    queryFn: () => parallaxApi.getWatchlists(),
    staleTime: 30_000,
  });

  // Which watchlists contain this conid
  const { data: membership, isLoading: loadingMembership } = useQuery({
    queryKey: ["watchlist-membership", activeConid],
    queryFn: () => parallaxApi.watchlistMembership(activeConid!),
    enabled: activeConid != null,
    staleTime: 10_000,
  });

  const memberSet = new Set(membership?.watchlist_ids ?? []);

  const addMutation = useMutation({
    mutationFn: ({ watchlistId }: { watchlistId: string }) =>
      parallaxApi.watchlistAddInstrument(watchlistId, activeConid!),
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
      parallaxApi.watchlistRemoveInstrument(watchlistId, activeConid!),
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

  // ── Create / delete watchlist ──
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const createWatchlist = useCreateWatchlist();
  const deleteWatchlist = useDeleteWatchlist();

  const submitCreate = () => {
    const name = newName.trim();
    if (!name) return;
    createWatchlist.mutate(name, {
      onSuccess: () => {
        setCreating(false);
        setNewName("");
      },
    });
  };

  const handleDeleteWatchlist = (id: string, name: string) => {
    if (
      !window.confirm(
        `Delete watchlist "${name}"? This removes it from IBKR too.`,
      )
    ) {
      return;
    }
    deleteWatchlist.mutate(id);
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
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
          {activeSymbol || "Symbol"} — Watchlists
        </span>
        <button
          type="button"
          onClick={() => {
            setCreating((c) => !c);
            setNewName("");
          }}
          className="text-[10px] text-[var(--text-3)] transition-colors hover:text-[var(--clr-cyan)]"
        >
          + New watchlist
        </button>
      </div>

      {creating && (
        <div className="mb-1 flex items-center gap-1">
          <input
            type="text"
            autoFocus
            placeholder="New watchlist name..."
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitCreate();
              if (e.key === "Escape") {
                setCreating(false);
                setNewName("");
              }
            }}
            className="w-full rounded-md border border-border bg-[var(--bg-2)] px-2 py-1 text-[10px] text-[var(--text-1)] placeholder:text-[var(--text-3)] outline-none focus:border-[var(--clr-cyan)]"
          />
          <button
            type="button"
            title="Create"
            onClick={submitCreate}
            disabled={!newName.trim() || createWatchlist.isPending}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[12px] leading-none text-[var(--text-3)] transition-colors hover:text-[var(--clr-green)] disabled:opacity-40"
          >
            ✓
          </button>
        </div>
      )}

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
              <li key={wl.id} className="group flex items-center gap-1">
                <label className="flex flex-1 cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-[var(--bg-2)]">
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
                <button
                  type="button"
                  title={`Delete ${wl.name}`}
                  aria-label={`Delete ${wl.name}`}
                  onClick={() => handleDeleteWatchlist(wl.id, wl.name)}
                  disabled={deleteWatchlist.isPending}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[12px] leading-none text-[var(--text-3)] opacity-0 transition-all hover:text-[var(--clr-red)] group-hover:opacity-100 disabled:opacity-40"
                >
                  ×
                </button>
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
