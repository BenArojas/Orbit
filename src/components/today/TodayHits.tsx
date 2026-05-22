/**
 * TodayHits — hero grid of currently-firing trigger setups.
 *
 * Loads the active hits list, derives the available watchlist filter chips
 * from it, and wires per-card actions to the existing mutation hooks
 * (`useDismissHit` / `useSnoozeHit`) and navigation store.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type TriggerHit } from "@/lib/api";
import { useNavigationStore } from "@/store/navigation";
import { useDismissHit, useSnoozeHit } from "@/hooks/useHitMutations";
import { HitCard } from "./HitCard";
import { TodayHitsFilters, type HitFilter } from "./TodayHitsFilters";

export function TodayHits() {
  const [filter, setFilter] = useState<HitFilter>({ kind: "all" });
  const navigateToAnalysis = useNavigationStore((s) => s.navigateToAnalysis);
  const dismiss = useDismissHit();
  const snooze = useSnoozeHit();

  const { data: hits, isLoading } = useQuery<TriggerHit[]>({
    queryKey: ["trigger-hits", "active"],
    queryFn: () => api.getTriggerHits({ status: "active", limit: 200 }),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const watchlistNames = useMemo(
    () =>
      Array.from(
        new Set(
          (hits ?? [])
            .map((h) => h.watchlist_name)
            .filter((n): n is string => !!n),
        ),
      ),
    [hits],
  );

  const filtered = useMemo(() => {
    if (!hits) return [];
    if (filter.kind === "watchlist") {
      return hits.filter((h) => h.watchlist_name === filter.name);
    }
    if (filter.kind === "high-conf") {
      return hits.filter((h) => h.condition_values.length >= 3);
    }
    return hits;
  }, [hits, filter]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] font-semibold text-[var(--text-1)]">
          Setups firing — {filtered.length}{" "}
          {filter.kind !== "all" ? "shown" : "today"}
        </h2>
        <TodayHitsFilters
          value={filter}
          onChange={setFilter}
          watchlistNames={watchlistNames}
        />
      </div>

      {isLoading ? (
        <div className="text-[10px] text-[var(--text-3)]">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded border border-dashed border-border px-4 py-6 text-center text-[10px] text-[var(--text-3)]">
          No setups firing yet. Triggers run every 5 min during market hours.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {filtered.map((h) => (
            <HitCard
              key={h.id}
              hit={h}
              onOpenChart={(hit) => navigateToAnalysis(hit.conid, hit.symbol)}
              onDismiss={(hit) => dismiss.mutate(hit.id)}
              onSnooze={(hit, mins) =>
                snooze.mutate({ id: hit.id, minutes: mins })
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
