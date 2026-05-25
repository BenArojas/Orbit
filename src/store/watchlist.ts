/**
 * Watchlist Store — Master watchlist + dynamic trigger watchlists
 *
 * The master watchlist is synced FROM IBKR (read-only source of truth).
 * Dynamic watchlists are populated by trigger hits from the backend scanner.
 *
 * Orbit integration: All instruments are identified by conid (IBKR contract ID).
 * The instruments table in SQLite caches conid → symbol/name lookups.
 * MoonMarket and Inflect also read from this table.
 */

import { create } from "zustand";

/** A single watchlist item with live quote data */
export interface WatchlistItem {
  conid: number;
  symbol: string;
  companyName: string;
  lastPrice: number;
  change: number;
  changePercent: number;
  /** Active trigger indicators (for glow edge display) */
  triggers: string[];
}

/** IBKR watchlist group */
export interface WatchlistGroup {
  id: string;
  name: string;
  items: WatchlistItem[];
}

interface WatchlistState {
  /** Master IBKR-synced watchlist */
  masterWatchlist: WatchlistItem[];

  /** Dynamic trigger-populated watchlists */
  triggerWatchlists: WatchlistGroup[];

  /** Which watchlist is currently selected in sidebar */
  activeWatchlistId: string | null;

  /** Search/filter query for watchlist */
  searchQuery: string;

  /** Actions */
  setMasterWatchlist: (items: WatchlistItem[]) => void;
  setTriggerWatchlists: (groups: WatchlistGroup[]) => void;
  setActiveWatchlist: (id: string | null) => void;
  setSearchQuery: (q: string) => void;

  /** Update a single item's live data (from WebSocket) */
  updateItemQuote: (
    conid: number,
    data: { lastPrice?: number; change?: number; changePercent?: number }
  ) => void;
}

export const useWatchlistStore = create<WatchlistState>()((set) => ({
  masterWatchlist: [],
  triggerWatchlists: [],
  activeWatchlistId: null,
  searchQuery: "",

  setMasterWatchlist: (items) => set({ masterWatchlist: items }),

  setTriggerWatchlists: (groups) => set({ triggerWatchlists: groups }),

  setActiveWatchlist: (id) => set({ activeWatchlistId: id }),

  setSearchQuery: (q) => set({ searchQuery: q }),

  updateItemQuote: (conid, data) =>
    set((state) => ({
      masterWatchlist: state.masterWatchlist.map((item) =>
        item.conid === conid ? { ...item, ...data } : item
      ),
      triggerWatchlists: state.triggerWatchlists.map((group) => ({
        ...group,
        items: group.items.map((item) =>
          item.conid === conid ? { ...item, ...data } : item
        ),
      })),
    })),
}));
