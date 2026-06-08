import { useQuery } from "@tanstack/react-query";
import { inflectApi } from "@/modules/inflect/api";
import type { InflectTradeDateRange } from "./useInflectTrades";

export function useInflectSymbols(
  accountId: string | null,
  range?: Partial<InflectTradeDateRange>,
) {
  return useQuery({
    queryKey: [
      "inflect",
      "symbols",
      accountId ?? null,
      range?.from ?? null,
      range?.to ?? null,
    ],
    queryFn: ({ signal }) =>
      inflectApi.inflectSymbols(
        { accountId: accountId ?? undefined, from: range?.from, to: range?.to },
        signal,
      ),
    enabled: Boolean(accountId),
  });
}

