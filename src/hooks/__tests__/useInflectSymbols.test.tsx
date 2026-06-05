import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/api", () => ({
  api: {
    inflectSymbols: vi.fn().mockResolvedValue({
      account_id: "DU1",
      symbols: [{ conid: 265598, symbol: "AAPL" }],
    }),
  },
}));

import { api } from "@/lib/api";
import { useInflectSymbols } from "../useInflectSymbols";

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return Wrapper;
}

describe("useInflectSymbols", () => {
  it("fetches period-aware symbol options", async () => {
    const Wrapper = makeWrapper();
    const range = { from: 1_000, to: 2_000 };
    const { result } = renderHook(() => useInflectSymbols("DU1", range), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.inflectSymbols).toHaveBeenCalledWith(
      { accountId: "DU1", from: 1_000, to: 2_000 },
      expect.anything(),
    );
  });
});

