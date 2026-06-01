import type {
  InflectCalendarDay,
  InflectCalendarResponse,
  InflectFill,
  InflectJournalEntry,
  InflectJournalUpsertRequest,
  InflectSetupsResponse,
  InflectSyncResponse,
  InflectTrade,
  InflectTradeStatus,
  InflectTradesResponse,
  InflectWeekRollup,
} from "@/lib/api";

export type {
  InflectCalendarDay,
  InflectCalendarResponse,
  InflectFill,
  InflectJournalEntry,
  InflectJournalUpsertRequest,
  InflectSetupsResponse,
  InflectSyncResponse,
  InflectTrade,
  InflectTradeStatus,
  InflectTradesResponse,
  InflectWeekRollup,
};

/** Inflect sub-pages, mirrored in the layout nav and the Zustand store. */
export type InflectPage = "calendar" | "trades";
