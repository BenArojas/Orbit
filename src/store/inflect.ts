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
  selectedDate: string | null;
  selectedTradeId: string | null;

  setPage: (page: InflectPage) => void;
  setMonth: (year: number, month: number) => void;
  /** Step the selected month by ±1, wrapping across year boundaries. */
  stepMonth: (delta: number) => void;
  selectDay: (date: string | null) => void;
  selectTrade: (tradeId: string | null) => void;
  clearSelection: () => void;
}

export const useInflectStore = create<InflectState>()((set) => ({
  page: "calendar",
  ...currentMonth(),
  selectedDate: null,
  selectedTradeId: null,

  setPage: (page) => set({ page, selectedDate: null, selectedTradeId: null }),

  setMonth: (year, month) => set({ year, month, selectedDate: null, selectedTradeId: null }),

  stepMonth: (delta) =>
    set((state) => {
      // Convert to a 0-based absolute month index, shift, convert back.
      const index = state.year * 12 + (state.month - 1) + delta;
      return {
        year: Math.floor(index / 12),
        month: (index % 12) + 1,
        selectedDate: null,
        selectedTradeId: null,
      };
    }),

  selectDay: (selectedDate) => set({ selectedDate, selectedTradeId: null }),

  selectTrade: (selectedTradeId) => set({ selectedTradeId }),

  clearSelection: () => set({ selectedDate: null, selectedTradeId: null }),
}));
