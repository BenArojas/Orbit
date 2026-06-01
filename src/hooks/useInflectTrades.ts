/**
 * useInflectTrades — round-trip trade list for the Inflect journal.
 *
 * Fetches `/inflect/trades` for the selected account, optionally filtered by
 * OPEN/CLOSED status. Trades are derived on demand from fills server-side, so
 * the journal save + sync mutations invalidate `["inflect", "trades"]` to pick
 * up new annotations and freshly synced executions.
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { InflectTradeStatus } from "@/modules/inflect/types";

export function useInflectTrades(accountId?: string, status?: InflectTradeStatus) {
  return useQuery({
    queryKey: ["inflect", "trades", accountId ?? null, status ?? "ALL"],
    queryFn: ({ signal }) => api.inflectTrades({ accountId, status }, signal),
  });
}
