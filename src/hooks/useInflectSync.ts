/**
 * useInflectSync — manual "sync fills now" trigger for the Inflect journal.
 *
 * IBKR only returns ~7 days of executions, so a background service keeps the
 * fills table fresh. This mutation lets the user force a sync, then invalidates
 * the calendar and trades queries so the freshly upserted fills re-derive into
 * trades immediately.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";

export function useInflectSync(accountId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (signal?: AbortSignal) => api.inflectSync(accountId, signal),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["inflect", "calendar"] });
      qc.invalidateQueries({ queryKey: ["inflect", "trades"] });
      toast.success(`Synced ${res.synced} fills`);
    },
    onError: () => toast.error("Failed to sync fills"),
  });
}
