/**
 * useInstrument — fetches a cached instrument record by conid.
 *
 * Hits GET /instruments/{conid} which reads from the local SQLite cache.
 * The cache is populated automatically on every conid resolution, search,
 * quote fetch, or screener run — so for any instrument the user has already
 * looked up, this returns instantly without hitting IBKR.
 *
 * Returns { symbol, companyName } and loading/error state.
 * All fields are null while loading or when conid is null.
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface UseInstrumentResult {
  symbol: string | null;
  companyName: string | null;
  isLoading: boolean;
}

export function useInstrument(conid: number | null): UseInstrumentResult {
  const { data, isLoading } = useQuery({
    queryKey: ["instrument", conid],
    queryFn: () => api.getInstrument(conid!),
    enabled: conid != null,
    staleTime: 5 * 60_000, // 5 min — instrument metadata is stable
    retry: false,          // don't retry if the instrument isn't cached yet
  });

  return {
    symbol:      data?.symbol ?? null,
    companyName: data?.company_name ?? null,
    isLoading,
  };
}
