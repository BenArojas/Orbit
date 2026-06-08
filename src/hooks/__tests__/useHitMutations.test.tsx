import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useDismissHit, useSnoozeHit } from "../useHitMutations";

vi.mock("@/modules/parallax/api", () => ({
  parallaxApi: {
    dismissTriggerHit: vi.fn().mockResolvedValue(undefined),
    snoozeTriggerHit: vi.fn().mockResolvedValue(undefined),
  },
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

describe("useDismissHit", () => {
  it("calls api.dismissTriggerHit and invalidates trigger-hits + stock-tags", async () => {
    const { Wrapper, spy } = makeWrapper();
    const { result } = renderHook(() => useDismissHit(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync(42);
    });
    expect(parallaxApi.dismissTriggerHit).toHaveBeenCalledWith(42);
    expect(spy).toHaveBeenCalledWith({ queryKey: ["trigger-hits"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["stock-tags"] });
  });
});

describe("useSnoozeHit", () => {
  it("calls api.snoozeTriggerHit and invalidates trigger-hits + stock-tags", async () => {
    const { Wrapper, spy } = makeWrapper();
    const { result } = renderHook(() => useSnoozeHit(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: 7, minutes: 30 });
    });
    expect(parallaxApi.snoozeTriggerHit).toHaveBeenCalledWith(7, 30);
    expect(spy).toHaveBeenCalledWith({ queryKey: ["trigger-hits"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["stock-tags"] });
  });
});
