import { useEffect, useRef } from "react";
import type { CandleData } from "@/modules/parallax/api";
import type { Timeframe } from "@/store/chart";

const INTRADAY_SECONDS: Partial<Record<Timeframe, number>> = {
  "1m": 60, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "4h": 14400,
};

export function tickFitsCandle(timeframe: Timeframe, candleTime: number, receivedAt?: number): boolean {
  const seconds = INTRADAY_SECONDS[timeframe];
  return !seconds || (receivedAt != null && receivedAt >= candleTime && receivedAt < candleTime + seconds);
}

export function useCandleRollover<T extends { timestamp?: number }>(
  timeframe: Timeframe, candles: CandleData[] | undefined, tick: T | null,
  refetch: () => Promise<unknown>,
): T | null {
  const lastRefresh = useRef("");
  const lastTime = candles?.[candles.length - 1]?.time;
  const seconds = INTRADAY_SECONDS[timeframe];
  const receivedAt = tick?.timestamp;
  useEffect(() => {
    if (!seconds || lastTime == null || receivedAt == null || receivedAt < lastTime + seconds) return;
    const key = `${timeframe}:${lastTime}:${Math.floor(receivedAt / seconds)}`;
    if (lastRefresh.current === key) return;
    lastRefresh.current = key;
    // Reconcile provider OHLCV; receipt time cannot establish a new candle's trades or volume.
    void refetch();
  }, [timeframe, lastTime, seconds, receivedAt, refetch]);
  return lastTime != null && tickFitsCandle(timeframe, lastTime, receivedAt) ? tick : null;
}
