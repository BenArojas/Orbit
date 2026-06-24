import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { parallaxApi } from "@/modules/parallax/api";

export function useCreateWatchlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => parallaxApi.createWatchlist(name),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ["watchlists"] });
      toast.success(`Created "${created.name}"`);
    },
    onError: (err) =>
      toast.error(
        `Couldn't create watchlist: ${err instanceof Error ? err.message : String(err)}`,
      ),
  });
}

export function useDeleteWatchlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (watchlistId: string) => parallaxApi.deleteWatchlist(watchlistId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["watchlists"] });
      toast.success("Watchlist deleted");
    },
    onError: (err) =>
      toast.error(
        `Couldn't delete watchlist: ${err instanceof Error ? err.message : String(err)}`,
      ),
  });
}
