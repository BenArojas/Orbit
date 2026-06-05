import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useStockTags } from "../useStockTags";

vi.mock("@/lib/api", () => ({
  api: {
    getStockTags: vi.fn().mockResolvedValue({
      1: [{ rule_id: 7, rule_name: "Golden Pocket", indicators: ["rsi"], fired_at: "x" }],
      2: [],
    }),
  },
}));

// Stub useWebSocket so the hook can register a handler without a live connection.
vi.mock("@/hooks/useWebSocket", () => ({
  useWebSocket: () => ({ addHandler: () => () => {} }),
}));

describe("useStockTags", () => {
  it("fetches tags for the given conid list", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useStockTags([1, 2]), { wrapper });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(result.current.data?.[1]).toHaveLength(1);
    expect(result.current.data?.[2]).toHaveLength(0);
  });
});
