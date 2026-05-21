import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";

function invalidateHits(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["trigger-hits"] });
  qc.invalidateQueries({ queryKey: ["stock-tags"] });
}

export function useDismissHit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.dismissTriggerHit(id),
    onSuccess: () => invalidateHits(qc),
    onError: () => toast.error("Failed to dismiss hit"),
  });
}

export function useSnoozeHit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, minutes }: { id: number; minutes: number }) =>
      api.snoozeTriggerHit(id, minutes),
    onSuccess: () => invalidateHits(qc),
    onError: () => toast.error("Failed to snooze hit"),
  });
}
