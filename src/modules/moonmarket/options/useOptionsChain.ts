import { useMutation, useQuery } from "@tanstack/react-query";
import { api, type MoonMarketOptionsChainData } from "@/lib/api";

export function useOptionExpirations(underlyingConid: number | null, symbol: string | null) {
  return useQuery({
    queryKey: ["moonmarket", "options", "expirations", underlyingConid, symbol],
    enabled: Boolean(underlyingConid && symbol),
    queryFn: ({ signal }) => api.moonmarketOptionExpirations(underlyingConid as number, symbol as string, signal),
  });
}

export function useOptionChain(underlyingConid: number | null, expiration: string | null) {
  return useQuery({
    queryKey: ["moonmarket", "options", "chain", underlyingConid, expiration],
    enabled: Boolean(underlyingConid && expiration),
    queryFn: ({ signal }) => api.moonmarketOptionChain(underlyingConid as number, expiration as string, signal),
  });
}

export function useLazyOptionStrike(onLoaded: (chain: MoonMarketOptionsChainData, strike: number) => void) {
  return useMutation({
    mutationFn: ({
      underlyingConid,
      expiration,
      strike,
    }: {
      underlyingConid: number;
      expiration: string;
      strike: number;
    }) => api.moonmarketOptionContract(underlyingConid, expiration, strike),
    onSuccess: (response) => {
      onLoaded({ [response.strike.toFixed(2)]: response.data }, response.strike);
    },
  });
}
