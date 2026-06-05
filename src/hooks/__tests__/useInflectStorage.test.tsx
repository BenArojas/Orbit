import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/api", () => ({
  api: {
    inflectStorage: vi.fn().mockResolvedValue({
      file_size_bytes: 4096,
      table_counts: { fills: 2 },
      raw_json_bytes: 120,
    }),
    inflectStorageCleanup: vi.fn().mockResolvedValue({
      before_date: "2026-06-01",
      cleared_raw_payloads: 1,
      deleted_rows: 0,
      export_recommended: true,
      message: "Raw payloads cleared.",
    }),
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { api } from "@/lib/api";
import { useInflectStorage, useInflectStorageCleanup } from "../useInflectStorage";

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const spy = vi.spyOn(qc, "invalidateQueries");
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { Wrapper, spy };
}

describe("useInflectStorage", () => {
  it("fetches stats and invalidates after cleanup", async () => {
    const { Wrapper, spy } = makeWrapper();
    const stats = renderHook(() => useInflectStorage(), { wrapper: Wrapper });
    const cleanup = renderHook(() => useInflectStorageCleanup(), { wrapper: Wrapper });

    await waitFor(() => expect(stats.result.current.isSuccess).toBe(true));
    await act(async () => {
      await cleanup.result.current.mutateAsync({
        before_date: "2026-06-01",
        confirm: true,
      });
    });

    expect(api.inflectStorage).toHaveBeenCalled();
    expect(api.inflectStorageCleanup).toHaveBeenCalledWith({
      before_date: "2026-06-01",
      confirm: true,
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["inflect", "storage"] });
  });
});

