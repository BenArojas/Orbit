/**
 * Master Watchlist Sidebar — Task 3.5
 *
 * Fetches watchlists from IBKR and displays instruments with live quotes.
 * Features:
 *   - Dropdown to switch between IBKR watchlists
 *   - Live price, change %, and change amount for each item
 *   - Search/filter within the watchlist
 *   - Click item → navigate to Analysis with that conid
 *   - Glow left-edge indicators for triggered items (Phase 6)
 *
 * Data: GET /watchlist/lists, GET /watchlist/{id}
 * Live updates: WebSocket subscription for all watchlist conids
 */

import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type WatchlistItemResponse } from "../../lib/api";
import { useNavigationStore } from "../../store/navigation";
import { useWatchlistStore } from "../../store/watchlist";
import { ScrollArea } from "../ui/scroll-area";

export default function WatchlistSidebar() {
  const [selectedWatchlistId, setSelectedWatchlistId] = useState<string | null>(null);
  const { searchQuery, setSearchQuery, setMasterWatchlist } = useWatchlistStore();
  const navigateToAnalysis = useNavigationStore((s) => s.navigateToAnalysis);

  // Fetch all IBKR watchlists
  const { data: watchlists } = useQuery({
    queryKey: ["watchlists"],
    queryFn: api.getWatchlists,
    staleTime: 60_000,
  });

  // Auto-select first watchlist
  useEffect(() => {
    if (watchlists?.length && !selectedWatchlistId) {
      setSelectedWatchlistId(watchlists[0].id);
    }
  }, [watchlists, selectedWatchlistId]);

  // Fetch items for selected watchlist
  const { data: watchlistData, isLoading, error } = useQuery({
    queryKey: ["watchlist", selectedWatchlistId],
    queryFn: () => api.getWatchlistItems(selectedWatchlistId!),
    enabled: !!selectedWatchlistId,
    staleTime: 30_000,
    refetchInterval: 30_000, // Refresh quotes every 30s
  });

  // Sync to Zustand store for other components
  useEffect(() => {
    if (watchlistData?.items) {
      setMasterWatchlist(
        watchlistData.items.map((item) => ({
          conid: item.conid,
          symbol: item.symbol,
          companyName: item.companyName,
          lastPrice: item.lastPrice ?? 0,
          change: item.changeAmount ?? 0,
          changePercent: item.changePercent ?? 0,
          triggers: [], // Populated in Phase 6
        }))
      );
    }
  }, [watchlistData, setMasterWatchlist]);

  // Filter items by search
  const filteredItems = useMemo(() => {
    if (!watchlistData?.items) return [];
    if (!searchQuery) return watchlistData.items;
    const q = searchQuery.toLowerCase();
    return watchlistData.items.filter(
      (item) =>
        item.symbol.toLowerCase().includes(q) ||
        item.companyName.toLowerCase().includes(q)
    );
  }, [watchlistData?.items, searchQuery]);

  const itemCount = watchlistData?.items?.length ?? 0;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header with watchlist selector */}
      <div className="sticky top-0 z-10 border-b border-border bg-[var(--bg-1)]/80 backdrop-blur">
        <div className="flex items-center justify-between px-3.5 py-2.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
            Watchlist
          </span>
          <span className="rounded-full bg-[var(--bg-3)] px-1.5 py-0.5 font-data text-[9px] text-[var(--text-3)]">
            {itemCount}
          </span>
        </div>

        {/* Watchlist dropdown + search */}
        <div className="flex flex-col gap-1.5 px-3 pb-2.5">
          {watchlists && watchlists.length > 1 && (
            <select
              value={selectedWatchlistId ?? ""}
              onChange={(e) => setSelectedWatchlistId(e.target.value)}
              className="w-full rounded-md border border-border bg-[var(--bg-2)] px-2 py-1 text-[10px] text-[var(--text-2)] outline-none focus:border-[var(--cyan)]"
            >
              {watchlists.map((wl) => (
                <option key={wl.id} value={wl.id}>
                  {wl.name}
                </option>
              ))}
            </select>
          )}

          <input
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-md border border-border bg-[var(--bg-2)] px-2 py-1 text-[10px] text-[var(--text-1)] placeholder:text-[var(--text-3)] outline-none focus:border-[var(--cyan)]"
          />
        </div>
      </div>

      {/* Items list */}
      <ScrollArea className="flex-1">
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <span className="text-xs text-[var(--text-3)]">Loading...</span>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center gap-2 py-8 px-4">
            <span className="text-xs text-[var(--red)]">Failed to load watchlist</span>
            <span className="text-[10px] text-[var(--text-3)] text-center">
              Make sure IBKR Client Portal is running and authenticated.
            </span>
          </div>
        )}

        {!isLoading && !error && filteredItems.length === 0 && (
          <div className="flex items-center justify-center py-8">
            <span className="text-xs text-[var(--text-3)]">
              {searchQuery ? "No matching items" : "Connect IBKR to load watchlist"}
            </span>
          </div>
        )}

        <div className="divide-y divide-border">
          {filteredItems.map((item) => (
            <WatchlistRow
              key={item.conid}
              item={item}
              onClick={() => navigateToAnalysis(item.conid)}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function WatchlistRow({
  item,
  onClick,
}: {
  item: WatchlistItemResponse;
  onClick: () => void;
}) {
  const changePct = item.changePercent ?? 0;
  const isUp = changePct >= 0;
  const colorClass = isUp ? "text-[var(--green)]" : "text-[var(--red)]";

  return (
    <div
      onClick={onClick}
      className="grid grid-cols-[1fr_50px_52px] items-center px-3.5 py-[7px] cursor-pointer transition-all hover:bg-[var(--bg-3)] relative"
    >
      {/* Symbol + company name */}
      <div className="min-w-0">
        <div className="text-xs font-semibold text-[var(--text-1)]">
          {item.symbol}
        </div>
        <div className="mt-0.5 flex items-center gap-1">
          <span className="text-[9px] text-[var(--text-3)] truncate">
            {item.companyName}
          </span>
          {/* Trigger tags will go here in Phase 6 */}
        </div>
      </div>

      {/* Price */}
      <span className="font-data text-[11px] text-right text-[var(--text-1)]">
        {item.lastPrice != null ? item.lastPrice.toFixed(2) : "--"}
      </span>

      {/* Change % */}
      <span className={`font-data text-[10px] text-right font-medium ${colorClass}`}>
        {changePct >= 0 ? "+" : ""}
        {changePct.toFixed(2)}%
      </span>
    </div>
  );
}
