import { useQueries } from "@tanstack/react-query";
import { parallaxApi, type RSRating } from "@/modules/parallax/api";

const ratingQueryKey = ["parallax", "rs-ratings"] as const;

export function useRSRatings(conids: number[]) {
  const unique = [...new Set(conids)];
  const batches: number[][] = [];
  for (let index = 0; index < unique.length; index += 250) batches.push(unique.slice(index, index + 250));
  const queries = useQueries({
    queries: batches.map((batch) => ({
      queryKey: [...ratingQueryKey, batch.join(",")],
      queryFn: ({ signal }: { signal: AbortSignal }) => parallaxApi.rsRatings(batch, signal),
      staleTime: 60_000,
      retry: false,
    })),
  });
  const published = queries.find((query) => query.data)?.data;
  return {
    items: queries.flatMap((query) => query.data?.items ?? []) as RSRating[],
    isLoading: queries.some((query) => query.isPending),
    isError: queries.some((query) => query.isError),
    sourceStatus: published?.status,
    freshness: published?.freshness,
    sourcePublishedAt: published?.source_published_at,
  };
}
