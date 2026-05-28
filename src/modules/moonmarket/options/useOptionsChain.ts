import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

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

export function useOptionStrike(
  underlyingConid: number,
  expiration: string,
  strike: number,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["moonmarket", "options", "contract", underlyingConid, expiration, strike],
    enabled: Boolean(underlyingConid && expiration && strike && enabled),
    queryFn: ({ signal }) => api.moonmarketOptionContract(underlyingConid, expiration, strike, signal),
  });
}
