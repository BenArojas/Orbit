import { useQuery } from "@tanstack/react-query";
import { moonmarketApi } from "@/modules/moonmarket/api";

export function useOptionExpirations(underlyingConid: number | null, symbol: string | null) {
  return useQuery({
    queryKey: ["moonmarket", "options", "expirations", underlyingConid, symbol],
    enabled: Boolean(underlyingConid && symbol),
    queryFn: ({ signal }) => moonmarketApi.moonmarketOptionExpirations(underlyingConid as number, symbol as string, signal),
  });
}

export function useOptionChain(underlyingConid: number | null, expiration: string | null) {
  return useQuery({
    queryKey: ["moonmarket", "options", "chain", underlyingConid, expiration],
    enabled: Boolean(underlyingConid && expiration),
    queryFn: ({ signal }) => moonmarketApi.moonmarketOptionChain(underlyingConid as number, expiration as string, signal),
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
    queryFn: ({ signal }) => moonmarketApi.moonmarketOptionContract(underlyingConid, expiration, strike, signal),
  });
}

// Loads the whole auto-load strike window in one paced backend request instead
// of one request per strike. Disabled until at least one strike is known.
export function useOptionWindow(
  underlyingConid: number | null,
  expiration: string | null,
  strikes: number[],
) {
  const sortedStrikes = [...strikes].sort((a, b) => a - b);
  return useQuery({
    queryKey: ["moonmarket", "options", "window", underlyingConid, expiration, sortedStrikes],
    enabled: Boolean(underlyingConid && expiration && sortedStrikes.length),
    queryFn: ({ signal }) =>
      moonmarketApi.moonmarketOptionWindow(underlyingConid as number, expiration as string, sortedStrikes, signal),
  });
}
