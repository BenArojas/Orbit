import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useCandleRollover } from "./useCandleRollover";
import { chartHistoryPeriodForTimeframe, clampHistoryPeriodToTimeframe } from "./historyPeriods";
import { useCompareStore } from "@/store/compare";

it("keeps 30m ticks inside their candle, reconciles rollover once, and persists independent Compare timeframes", async () => {
  const candles = [{ time: 1800, open: 100, high: 105, low: 99, close: 102, volume: 50 }];
  const refetch = vi.fn().mockResolvedValue(undefined);
  const { result, rerender } = renderHook(({ receivedAt }) => useCandleRollover("30m", candles, { timestamp: receivedAt, last: 103 }, refetch), { initialProps: { receivedAt: 3599 } });
  expect(result.current?.last).toBe(103);
  rerender({ receivedAt: 3600 });
  expect(result.current).toBeNull();
  expect(refetch).toHaveBeenCalledTimes(1);
  rerender({ receivedAt: 3610 });
  expect(refetch).toHaveBeenCalledTimes(1);
  candles.push({ ...candles[0], time: 3600, open: 103, close: 103 });
  rerender({ receivedAt: 3611 });
  expect(result.current?.last).toBe(103);
  expect(candles[0].close).toBe(102);
  expect(chartHistoryPeriodForTimeframe("30m", "3M")).toBe("1W");
  expect(clampHistoryPeriodToTimeframe("1Y", "30m")).toBe("1W");
  act(() => {
    useCompareStore.getState().enter("30m");
    useCompareStore.getState().addPane();
    useCompareStore.getState().setPaneTimeframe(useCompareStore.getState().panes[1].id, "1D");
  });
  await useCompareStore.persist.rehydrate();
  expect(useCompareStore.getState().panes.map((pane) => pane.timeframe)).toEqual(["30m", "1D"]);
  useCompareStore.getState().exit();
});
