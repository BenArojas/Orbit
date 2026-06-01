/**
 * Inflect Store — Zustand UI state for the trading-journal module.
 *
 * Holds only view state: which sub-page is showing, which calendar month is
 * selected, and which trade's detail/journal drawer is open. Server data
 * (calendar, trades, journal) lives in TanStack Query, never here.
 *
 * The selected month is stored as a 1-based {year, month} pair (month 1–12),
 * matching the backend `/inflect/calendar?year&month` contract.
 */

import { create } from "zustand";
import type { InflectPage } from "@/modules/inflect/types";

function currentMonth(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

interface InflectState {
  page: InflectPage;
  year: number;
  month: number;
  selectedTradeId: string | null;

  setPage: (page: InflectPage) => void;
  setMonth: (year: number, month: number) => void;
  /** Step the selected month by ±1, wrapping across year boundaries. */
  stepMonth: (delta: number) => void;
  selectTrade: (tradeId: string | null) => void;
}

export const useInflectStore = create<InflectState>()((set) => ({
  page: "calendar",
  ...currentMonth(),
  selectedTradeId: null,

  setPage: (page) => set({ page }),

  setMonth: (year, month) => set({ year, month }),

  stepMonth: (delta) =>
    set((state) => {
      // Convert to a 0-based absolute month index, shift, convert back.
      const index = state.year * 12 + (state.month - 1) + delta;
      return { year: Math.floor(index / 12), month: (index % 12) + 1 };
    }),

  selectTrade: (selectedTradeId) => set({ selectedTradeId }),
}));
