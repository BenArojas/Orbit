import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/api", () => ({
  api: {
    getInstrument: vi.fn().mockResolvedValue({
      conid: 265598,
      symbol: "AAPL",
      company_name: "Apple Inc",
      sec_type: "STK",
      cached_at: "2026-06-07 10:00:00",
    }),
  },
}));

import { api } from "@/lib/api";
import { useInstrument } from "../useInstrument";

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return Wrapper;
}

describe("useInstrument", () => {
  it("reads display identity from the cached instrument API shape", async () => {
    const { result } = renderHook(() => useInstrument(265598), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.symbol).toBe("AAPL"));

    expect(api.getInstrument).toHaveBeenCalledWith(265598, expect.anything());
    expect(result.current.companyName).toBe("Apple Inc");
    expect(result.current.isLoading).toBe(false);
  });
});
