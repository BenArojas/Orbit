import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCancelOrder, useModifyOrder } from "../useOrderMutations";

const mockApi = vi.hoisted(() => ({
  moonmarketCancelOrder: vi.fn(),
  moonmarketModifyOrder: vi.fn(),
}));

vi.mock("@/modules/moonmarket/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/moonmarket/api")>();
  return {
    ...actual,
    moonmarketApi: {
      ...actual.moonmarketApi,
      ...mockApi,
    },
  };
});

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { wrapper, invalidateSpy };
}

describe("useCancelOrder", () => {
  beforeEach(() => {
    mockApi.moonmarketCancelOrder.mockReset();
    mockApi.moonmarketCancelOrder.mockResolvedValue({ account_id: "DU1", ok: true });
  });

  it("invalidates live orders, funds, and portfolio on success", async () => {
    const { wrapper, invalidateSpy } = makeWrapper();
    const { result } = renderHook(() => useCancelOrder(), { wrapper });

    result.current.mutate({ accountId: "DU1", orderId: "o1" });

    await waitFor(() => expect(mockApi.moonmarketCancelOrder).toHaveBeenCalledWith("DU1", "o1"));
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["moonmarket", "live-orders", "DU1"] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["moonmarket", "funds", "DU1"] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["moonmarket", "portfolio", "DU1"] });
    });
  });
});

describe("useModifyOrder", () => {
  beforeEach(() => {
    mockApi.moonmarketModifyOrder.mockReset();
    mockApi.moonmarketModifyOrder.mockResolvedValue({ account_id: "DU1", ok: true });
  });

  it("invalidates live orders, funds, and portfolio on success", async () => {
    const { wrapper, invalidateSpy } = makeWrapper();
    const { result } = renderHook(() => useModifyOrder(), { wrapper });

    result.current.mutate({
      accountId: "DU1",
      orderId: "o1",
      order: { conid: 1, side: "BUY", quantity: 1, orderType: "LMT", tif: "DAY", price: 10 },
    });

    await waitFor(() => expect(mockApi.moonmarketModifyOrder).toHaveBeenCalled());
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["moonmarket", "live-orders", "DU1"] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["moonmarket", "funds", "DU1"] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["moonmarket", "portfolio", "DU1"] });
    });
  });
});
