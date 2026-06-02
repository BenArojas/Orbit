/**
 * useInflectBackfill — polls the local basis-recovery queue for a trade symbol.
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useInflectBackfill({
  accountId,
  conid,
  enabled = true,
}: {
  accountId?: string | null;
  conid?: number | null;
  enabled?: boolean;
}) {
  const canFetch = Boolean(enabled && accountId && conid != null);

  return useQuery({
    queryKey: ["inflect", "backfill-status", accountId ?? null, conid ?? null],
    queryFn: ({ signal }) =>
      api.inflectBackfillStatus({ accountId: accountId as string, conid: conid as number }, signal),
    enabled: canFetch,
    refetchInterval: canFetch ? 60_000 : false,
    select: (response) => response.items.find((item) => item.conid === conid) ?? null,
  });
}
