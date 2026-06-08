/**
 * useInflectTrades — round-trip trade list for the Inflect journal.
 *
 * Fetches `/inflect/trades` for the selected account, optionally filtered by
 * OPEN/CLOSED status. Trades are derived on demand from fills server-side, so
 * the journal save + sync mutations invalidate `["inflect", "trades"]` to pick
 * up new annotations and freshly synced executions.
 */

import { useQuery } from "@tanstack/react-query";
import { inflectApi } from "@/modules/inflect/api";
import type { InflectTradeStatus } from "@/modules/inflect/types";

export interface InflectTradeDateRange {
  from: number;
  to: number;
}

export function selectedDateRangeMs(dateKey: string): InflectTradeDateRange {
  const [year, month, day] = dateKey.split("-").map(Number);
  const start = new Date(year, month - 1, day).getTime();
  const end = new Date(year, month - 1, day + 1).getTime() - 1;
  return { from: start, to: end };
}

export function useInflectTrades(
  accountId?: string,
  status?: InflectTradeStatus,
  range?: InflectTradeDateRange,
  enabled = true,
) {
  return useQuery({
    queryKey: [
      "inflect",
      "trades",
      accountId ?? null,
      status ?? "ALL",
      range?.from ?? null,
      range?.to ?? null,
    ],
    queryFn: ({ signal }) => inflectApi.inflectTrades({ accountId, status, ...range }, signal),
    enabled,
  });
}
