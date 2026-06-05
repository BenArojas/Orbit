import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/api", () => ({
  api: {
    inflectBackfillStatus: vi.fn().mockResolvedValue({ account_id: "DU1", items: [] }),
  },
}));

import { api } from "@/lib/api";
import { useInflectBackfill } from "../useInflectBackfill";

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return Wrapper;
}

describe("useInflectBackfill", () => {
  it("does not poll when disabled", () => {
    const Wrapper = makeWrapper();
    renderHook(() => useInflectBackfill({ accountId: "DU1", conid: 265598, enabled: false }), {
      wrapper: Wrapper,
    });
    expect(api.inflectBackfillStatus).not.toHaveBeenCalled();
  });

  it("fetches per-conid backfill status when enabled", async () => {
    const Wrapper = makeWrapper();
    const { result } = renderHook(
      () => useInflectBackfill({ accountId: "DU1", conid: 265598, enabled: true }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.inflectBackfillStatus).toHaveBeenCalledWith(
      { accountId: "DU1", conid: 265598 },
      expect.anything(),
    );
  });
});
