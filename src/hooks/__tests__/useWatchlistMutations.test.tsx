import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCreateWatchlist, useDeleteWatchlist } from "../useWatchlistMutations";

vi.mock("@/modules/parallax/api", () => ({
  parallaxApi: {
    createWatchlist: vi.fn().mockResolvedValue({ id: "123", name: "My List" }),
    deleteWatchlist: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { parallaxApi } from "@/modules/parallax/api";

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const spy = vi.spyOn(qc, "invalidateQueries");
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { Wrapper, spy };
}

describe("useCreateWatchlist", () => {
  it("calls api.createWatchlist and invalidates watchlists", async () => {
    const { Wrapper, spy } = makeWrapper();
    const { result } = renderHook(() => useCreateWatchlist(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync("My List");
    });
    expect(parallaxApi.createWatchlist).toHaveBeenCalledWith("My List");
    expect(spy).toHaveBeenCalledWith({ queryKey: ["watchlists"] });
  });
});

describe("useDeleteWatchlist", () => {
  it("calls api.deleteWatchlist and invalidates watchlists", async () => {
    const { Wrapper, spy } = makeWrapper();
    const { result } = renderHook(() => useDeleteWatchlist(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync("123");
    });
    expect(parallaxApi.deleteWatchlist).toHaveBeenCalledWith("123");
    expect(spy).toHaveBeenCalledWith({ queryKey: ["watchlists"] });
  });
});
