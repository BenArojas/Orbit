import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { inflectApi } from "@/modules/inflect/api";
import type { InflectStorageCleanupRequest } from "@/modules/inflect/api";

export function useInflectStorage() {
  return useQuery({
    queryKey: ["inflect", "storage"],
    queryFn: ({ signal }) => inflectApi.inflectStorage(signal),
  });
}

export function useInflectStorageCleanup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: InflectStorageCleanupRequest) =>
      inflectApi.inflectStorageCleanup(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inflect", "storage"] });
      toast.success("Raw payloads cleared");
    },
    onError: () => toast.error("Storage cleanup failed"),
  });
}

