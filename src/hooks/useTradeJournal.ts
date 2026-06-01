/**
 * useTradeJournal — trade detail + journal annotation for the Inflect module.
 *
 * `useInflectTrade` loads a single round-trip trade (fills + attached journal
 * entry) for the detail drawer. `useSaveTradeJournal` upserts the setup/notes/
 * tags annotation, then invalidates the trade detail, the trades list, and the
 * calendar so every view reflects the new annotation without a manual refresh.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { InflectJournalUpsertRequest } from "@/modules/inflect/types";

export function useInflectTrade(tradeId: string | null, accountId?: string) {
  return useQuery({
    queryKey: ["inflect", "trade", tradeId, accountId ?? null],
    queryFn: ({ signal }) => api.inflectTrade(tradeId as string, accountId, signal),
    enabled: tradeId != null,
  });
}

export function useSaveTradeJournal(accountId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tradeId, body }: { tradeId: string; body: InflectJournalUpsertRequest }) =>
      api.inflectSaveJournal(tradeId, body, accountId),
    onSuccess: (_entry, { tradeId }) => {
      qc.invalidateQueries({ queryKey: ["inflect", "trade", tradeId] });
      qc.invalidateQueries({ queryKey: ["inflect", "trades"] });
      qc.invalidateQueries({ queryKey: ["inflect", "calendar"] });
      toast.success("Journal saved");
    },
    onError: () => toast.error("Failed to save journal"),
  });
}
