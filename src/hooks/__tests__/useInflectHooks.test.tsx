/**
 * Inflect hook tests — query wiring + mutation invalidation.
 *
 * The interesting behavior is that saving a journal entry and syncing fills
 * both invalidate the calendar and trades caches, so every view re-derives
 * after an annotation or a resync. The API client is mocked; we assert on the
 * call arguments and the invalidation keys.
 */

import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/modules/inflect/api", () => ({
  inflectApi: {
    inflectCalendar: vi.fn().mockResolvedValue({
      account_id: "DU1", year: 2026, month: 6, days: [], weeks: [],
      total_net_pnl: 0, days_traded: 0,
    }),
    inflectTrades: vi.fn().mockResolvedValue({ account_id: "DU1", trades: [] }),
    inflectTrade: vi.fn().mockResolvedValue({ trade_id: "DU1:1:e1" }),
    inflectSaveJournal: vi.fn().mockResolvedValue({
      trade_id: "DU1:1:e1", account_id: "DU1", conid: 1, setup: "Breakout",
      notes: null, tags: [], created_at: null, updated_at: null,
    }),
    inflectSync: vi.fn().mockResolvedValue({ account_id: "DU1", synced: 4 }),
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { inflectApi } from "@/modules/inflect/api";
import { useInflectCalendar } from "../useInflectCalendar";
import { selectedDateRangeMs, useInflectTrades } from "../useInflectTrades";
import { useInflectSync } from "../useInflectSync";
import { useInflectTrade, useSaveTradeJournal } from "../useTradeJournal";

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const spy = vi.spyOn(qc, "invalidateQueries");
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { Wrapper, spy };
}

describe("useInflectCalendar", () => {
  it("fetches the calendar for the given account/year/month", async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useInflectCalendar(2026, 6, "DU1"), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(inflectApi.inflectCalendar).toHaveBeenCalledWith(2026, 6, "DU1", expect.anything());
  });
});

describe("useInflectTrades", () => {
  it("fetches trades with an optional status filter", async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useInflectTrades("DU1", "CLOSED"), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(inflectApi.inflectTrades).toHaveBeenCalledWith(
      { accountId: "DU1", status: "CLOSED" },
      expect.anything(),
    );
  });

  it("fetches trades with a selected-day date range", async () => {
    const { Wrapper } = makeWrapper();
    const range = selectedDateRangeMs("2026-06-02");
    const { result } = renderHook(() => useInflectTrades("DU1", "CLOSED", range), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(inflectApi.inflectTrades).toHaveBeenCalledWith(
      { accountId: "DU1", status: "CLOSED", from: range.from, to: range.to },
      expect.anything(),
    );
  });

  it("computes an inclusive local-day range", () => {
    const range = selectedDateRangeMs("2026-06-02");
    expect(range.from).toBe(new Date(2026, 5, 2).getTime());
    expect(range.to).toBe(new Date(2026, 5, 3).getTime() - 1);
  });
});

describe("useInflectTrade", () => {
  it("does not fetch when tradeId is null", () => {
    const { Wrapper } = makeWrapper();
    renderHook(() => useInflectTrade(null, "DU1"), { wrapper: Wrapper });
    expect(inflectApi.inflectTrade).not.toHaveBeenCalled();
  });

  it("fetches when a tradeId is provided", async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useInflectTrade("DU1:1:e1", "DU1"), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(inflectApi.inflectTrade).toHaveBeenCalledWith("DU1:1:e1", "DU1", expect.anything());
  });
});

describe("useSaveTradeJournal", () => {
  it("saves and invalidates trade, trades, and calendar", async () => {
    const { Wrapper, spy } = makeWrapper();
    const { result } = renderHook(() => useSaveTradeJournal("DU1"), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        tradeId: "DU1:1:e1",
        body: { setup: "Breakout", notes: null, tags: [] },
      });
    });
    expect(inflectApi.inflectSaveJournal).toHaveBeenCalledWith(
      "DU1:1:e1", { setup: "Breakout", notes: null, tags: [] }, "DU1",
    );
    expect(spy).toHaveBeenCalledWith({ queryKey: ["inflect", "trade", "DU1:1:e1"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["inflect", "trades"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["inflect", "calendar"] });
  });
});

describe("useInflectSync", () => {
  it("syncs and invalidates calendar + trades", async () => {
    const { Wrapper, spy } = makeWrapper();
    const { result } = renderHook(() => useInflectSync("DU1"), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync(undefined);
    });
    expect(inflectApi.inflectSync).toHaveBeenCalledWith("DU1", undefined);
    expect(spy).toHaveBeenCalledWith({ queryKey: ["inflect", "calendar"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["inflect", "trades"] });
  });
});
