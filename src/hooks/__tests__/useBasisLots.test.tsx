import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/api", () => ({
  api: {
    inflectBasisLots: vi.fn().mockResolvedValue([]),
    inflectBasisAudit: vi.fn().mockResolvedValue({ account_id: "DU1", conid: 265598, items: [] }),
    inflectCreateBasisLot: vi.fn().mockResolvedValue({
      id: 1,
      account_id: "DU1",
      conid: 265598,
      side: "LONG",
      quantity: 10,
      entry_date: "2026-05-01",
      entry_price: 100,
      commission: null,
      note: null,
    }),
    inflectUpdateBasisLot: vi.fn().mockResolvedValue({ id: 1 }),
    inflectDeleteBasisLot: vi.fn().mockResolvedValue({ deleted: true }),
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { api } from "@/lib/api";
import {
  useBasisAudit,
  useBasisLots,
  useCreateBasisLot,
  useDeleteBasisLot,
  useUpdateBasisLot,
} from "../useBasisLots";

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const spy = vi.spyOn(qc, "invalidateQueries");
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { Wrapper, spy };
}

describe("useBasisLots", () => {
  it("fetches basis lots and audit for an account/conid", async () => {
    const { Wrapper } = makeWrapper();
    const lots = renderHook(() => useBasisLots("DU1", 265598), { wrapper: Wrapper });
    const audit = renderHook(() => useBasisAudit("DU1", 265598), { wrapper: Wrapper });

    await waitFor(() => expect(lots.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(audit.result.current.isSuccess).toBe(true));

    expect(api.inflectBasisLots).toHaveBeenCalledWith(
      { accountId: "DU1", conid: 265598 },
      expect.anything(),
    );
    expect(api.inflectBasisAudit).toHaveBeenCalledWith(
      { accountId: "DU1", conid: 265598 },
      expect.anything(),
    );
  });

  it("create/update/delete mutations invalidate derived Inflect views", async () => {
    const { Wrapper, spy } = makeWrapper();
    const create = renderHook(() => useCreateBasisLot("DU1"), { wrapper: Wrapper });
    const update = renderHook(() => useUpdateBasisLot("DU1"), { wrapper: Wrapper });
    const deleteLot = renderHook(() => useDeleteBasisLot("DU1"), { wrapper: Wrapper });

    await act(async () => {
      await create.result.current.mutateAsync({
        conid: 265598,
        side: "LONG",
        quantity: 10,
        entry_date: "2026-05-01",
        entry_price: 100,
        commission: null,
        note: null,
      });
      await update.result.current.mutateAsync({
        lotId: 1,
        body: {
          conid: 265598,
          side: "SHORT",
          quantity: 5,
          entry_date: "2026-05-02",
          entry_price: 101,
          commission: 1,
          note: "edited",
        },
      });
      await deleteLot.result.current.mutateAsync({ lotId: 1, conid: 265598 });
    });

    expect(api.inflectCreateBasisLot).toHaveBeenCalledWith("DU1", expect.objectContaining({ conid: 265598 }));
    expect(api.inflectUpdateBasisLot).toHaveBeenCalledWith(1, "DU1", expect.objectContaining({ side: "SHORT" }));
    expect(api.inflectDeleteBasisLot).toHaveBeenCalledWith(1, "DU1");
    expect(spy).toHaveBeenCalledWith({ queryKey: ["inflect", "basis-lots", "DU1", 265598] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["inflect", "basis-audit", "DU1", 265598] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["inflect", "backfill-status"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["inflect", "trades"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["inflect", "calendar"] });
  });
});

