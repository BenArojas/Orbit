/**
 * useInflectCalendar — monthly P&L calendar for the Inflect journal.
 *
 * Fetches `/inflect/calendar?year&month` for the selected account. The query
 * key includes account/year/month so switching any of them refetches; the
 * journal save + sync mutations invalidate `["inflect", "calendar"]` to keep
 * day totals fresh after an annotation or a fills resync.
 */

import { useQuery } from "@tanstack/react-query";
import { inflectApi } from "@/modules/inflect/api";

export function useInflectCalendar(year: number, month: number, accountId?: string) {
  return useQuery({
    queryKey: ["inflect", "calendar", accountId ?? null, year, month],
    queryFn: ({ signal }) => inflectApi.inflectCalendar(year, month, accountId, signal),
  });
}
