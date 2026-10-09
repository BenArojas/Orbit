import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { parallaxApi, type TriggerHit } from "@/modules/parallax/api";

function invalidateHits(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["trigger-hits"] });
  qc.invalidateQueries({ queryKey: ["stock-tags"] });
}

export function useDismissHit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => parallaxApi.dismissTriggerHit(id),
    onMutate: () => qc.cancelQueries({ queryKey: ["trigger-hits"] }),
    onSuccess: async (_, id) => {
      await qc.cancelQueries({ queryKey: ["trigger-hits"] });
      const hit = qc.getQueriesData<TriggerHit[]>({ queryKey: ["trigger-hits"] }).flatMap(([, hits]) => hits ?? []).find((item) => item.id === id);
      const dismissedAt = new Date().toISOString();
      if (hit) qc.getQueriesData<TriggerHit[]>({ queryKey: ["trigger-hits"] }).forEach(([key]) => {
        qc.setQueryData<TriggerHit[]>(key, (hits) => {
          const updated = hits?.map((item) => item.rule_id === hit.rule_id && item.conid === hit.conid && item.id <= id ? { ...item, dismissed_at: dismissedAt } : item);
          return key[1] === "active" ? updated?.filter((item) => !item.dismissed_at) : updated;
        });
      });
      invalidateHits(qc);
    },
    onError: () => toast.error("Failed to dismiss hit"),
  });
}

export function useSnoozeHit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, minutes }: { id: number; minutes: number }) =>
      parallaxApi.snoozeTriggerHit(id, minutes),
    onSuccess: () => invalidateHits(qc),
    onError: () => toast.error("Failed to snooze hit"),
  });
}
