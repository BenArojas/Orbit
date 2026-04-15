/**
 * useChartData — Fetches candle + indicator data and handles live updates.
 *
 * Combines:
 *   1. TanStack Query — fetches historical candles + all active indicators
 *      in one POST /indicators/compute call
 *   2. WebSocket — subscribes to live price updates for the active conid
 *      and surfaces the latest tick for ChartContainer to update the last candle
 *
 * Returns everything the AnalysisPage needs to render the chart and indicators.
 */

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, useCallback, useRef } from "react";
import { api, type IndicatorComputeResponse } from "@/lib/api";
import type { Timeframe, IndicatorId } from "@/store/chart";
import { useWebSocket, type WsMessage } from "./useWebSocket";
import { useIbkrReady } from "@/context/GatewayContext";

// ── Map frontend timeframe → backend period ──────────────────
// The backend PERIOD_BAR dict uses these keys.

const TIMEFRAME_TO_PERIOD: Record<Timeframe, string> = {
  "1m": "1D",   // 1-minute bars → 1 day of data
  "5m": "5D",   // 5-minute bars → 5 days
  "15m": "1M",  // 15-min bars → 1 month
  "1h": "1M",   // 1-hour bars → 1 month
  "4h": "3M",   // 4-hour bars → 3 months
  "1D": "3M",   // Daily bars → 3 months
  "1W": "1Y",   // Weekly bars → 1 year
  "1M": "5Y",   // Monthly bars → 5 years
};

// ── Map frontend indicator IDs → backend indicator names ─────

function indicatorIdsToBackendNames(ids: Set<IndicatorId>): string[] {
  const nameMap: Record<IndicatorId, string> = {
    rsi: "rsi",
    macd: "macd",
    ema9: "ema_9",
    ema21: "ema_21",
    ema50: "ema_50",
    ema200: "ema_200",
    fibonacci: "fibonacci",
    volume: "volume",
    bollinger: "bbands",
    vwap: "vwap",
    atr: "atr",
    stochastic: "stoch",
    obv: "obv",
    adx: "adx",
  };

  return Array.from(ids)
    .map((id) => nameMap[id])
    .filter(Boolean);
}

// ── Live tick type ───────────────────────────────────────────

export interface LiveTick {
  last: number;
  volume: number;
  high: number;
  low: number;
}

// ── Hook ─────────────────────────────────────────────────────

export function useChartData(
  conid: number | null,
  timeframe: Timeframe,
  activeIndicators: Set<IndicatorId>,
) {
  const [liveTick, setLiveTick] = useState<LiveTick | null>(null);
  const { status: wsStatus, subscribe, unsubscribe, addHandler } = useWebSocket();
  const prevConidRef = useRef<number | null>(null);

  // Convert indicator set to a stable string for query key
  const indicatorKey = Array.from(activeIndicators).sort().join(",");
  const period = TIMEFRAME_TO_PERIOD[timeframe] ?? "3M";

  // ── TanStack Query: fetch candles + indicators ─────────────

  const ibkrReady = useIbkrReady();

  const query = useQuery<IndicatorComputeResponse>({
    queryKey: ["chart-data", conid, period, indicatorKey],
    queryFn: () =>
      api.computeIndicators({
        conid: conid!,
        period,
        indicators: indicatorIdsToBackendNames(activeIndicators),
      }),
    enabled: ibkrReady && conid != null,
    staleTime: 60_000, // 1 min — chart data doesn't need to be as fresh
    gcTime: 5 * 60_000,
  });

  // ── WebSocket: subscribe to live data for active conid ─────

  useEffect(() => {
    if (!conid) return;

    // Unsubscribe from previous conid
    if (prevConidRef.current && prevConidRef.current !== conid) {
      unsubscribe(prevConidRef.current);
    }

    subscribe(conid);
    prevConidRef.current = conid;

    return () => {
      unsubscribe(conid);
    };
  }, [conid, subscribe, unsubscribe]);

  // ── Handle incoming WebSocket messages ─────────────────────

  const handleMessage = useCallback(
    (msg: WsMessage) => {
      if (msg.type !== "market_data" || msg.conid !== conid) return;

      const last = msg.last as number | undefined;
      const volume = msg.volume as number | undefined;
      const high = msg.high as number | undefined;
      const low = msg.low as number | undefined;

      if (last != null) {
        setLiveTick((prev) => ({
          last,
          volume: volume ?? prev?.volume ?? 0,
          high: high ?? prev?.high ?? last,
          low: low ?? prev?.low ?? last,
        }));
      }
    },
    [conid],
  );

  useEffect(() => {
    const removeHandler = addHandler(handleMessage);
    return removeHandler;
  }, [addHandler, handleMessage]);

  // Reset live tick when conid or timeframe changes
  useEffect(() => {
    setLiveTick(null);
  }, [conid, timeframe]);

  return {
    /** OHLCV candle data */
    candles: query.data?.candles ?? [],
    /** Computed indicator results */
    indicators: query.data?.indicators ?? [],
    /** Fibonacci retracement result */
    fibonacci: query.data?.fibonacci ?? null,
    /** Live tick from WebSocket (updates last candle) */
    liveTick,
    /** WebSocket connection status */
    wsStatus,
    /** TanStack Query loading state */
    isLoading: query.isLoading,
    /** TanStack Query error */
    error: query.error,
    /** Refetch chart data manually */
    refetch: query.refetch,
  };
}
