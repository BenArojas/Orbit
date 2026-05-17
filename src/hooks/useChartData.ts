/**
 * useChartData — Fetches candle + indicator data and handles live updates.
 *
 * Combines:
 *   1. candlesQuery — fetches historical OHLCV candles via POST /indicators/compute
 *      with an empty indicator list. Key: ["candles", conid, timeframe]. Stable
 *      across indicator toggles so the chart never blanks during rapid toggling.
 *   2. indicatorsQuery — fetches computed indicator results via POST /indicators/compute
 *      with the active indicator set. Key: ["indicators", conid, timeframe, indicatorKey].
 *      Refetches when indicators change without disturbing the candle series.
 *   3. WebSocket — subscribes to live price updates for the active conid
 *      and surfaces the latest tick for ChartContainer to update the last candle.
 *
 * Returns everything the AnalysisPage needs to render the chart and indicators.
 */

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { api, type FibonacciResult, type IndicatorComputeResponse } from "@/lib/api";
import type { Timeframe, IndicatorId } from "@/store/chart";
import { useChartStore } from "@/store/chart";
import { fibonacciResultFromCandidate } from "@/lib/fib";
import { useFibConfig } from "./useFibConfig";
import { useWebSocket, type WsMessage } from "./useWebSocket";
import { useIbkrReady } from "@/context/GatewayContext";

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

  // ── TanStack Query: fetch candles + indicators ─────────────

  const ibkrReady = useIbkrReady();

  const candlesQuery = useQuery<IndicatorComputeResponse>({
    queryKey: ["candles", conid, timeframe],
    queryFn: () =>
      api.computeIndicators({
        conid: conid!,
        timeframe,
        indicators: [],
      }),
    enabled: ibkrReady && conid != null,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });

  const indicatorsQuery = useQuery<IndicatorComputeResponse>({
    queryKey: ["indicators", conid, timeframe, indicatorKey],
    queryFn: () =>
      api.computeIndicators({
        conid: conid!,
        timeframe,
        indicators: indicatorIdsToBackendNames(activeIndicators),
      }),
    enabled: ibkrReady && conid != null,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    placeholderData: keepPreviousData,
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

  // ── Fib override resolution (Branch 3) ─────────────────────
  //
  // When the user clicks a candidate in the Candidates panel the
  // store's `displayedFibOverride` is set. We synthesize a
  // FibonacciResult from that candidate using the canonical ratio
  // arrays from /fibonacci/config so the chart can re-paint without
  // hitting the backend. When no override is set, we pass through the
  // server's auto-detected fib unchanged.

  const displayedFibOverride = useChartStore((s) => s.displayedFibOverride);
  const { config: fibConfig } = useFibConfig();

  const fibonacci: FibonacciResult | null = useMemo(() => {
    const autoFib = indicatorsQuery.data?.fibonacci ?? null;
    if (!displayedFibOverride) return autoFib;
    if (!fibConfig) {
      // Config still loading — fall through to auto result. Override
      // will apply on the next render once the config arrives.
      return autoFib;
    }
    // Bug-2 fix: pass through the auto fib's candidates list so the
    // Candidates panel stays populated after the user picks one. The
    // user can then pick a different candidate without having to
    // un-set the override first.
    return fibonacciResultFromCandidate(
      displayedFibOverride,
      fibConfig.ratios,
      fibConfig.extension_ratios,
      autoFib?.candidates ?? [],
    );
  }, [indicatorsQuery.data?.fibonacci, displayedFibOverride, fibConfig]);

  /**
   * Indicates which fib is being rendered:
   *   "auto"     — the server's auto-detected primary.
   *   "override" — a candidate the user picked from the panel.
   *   "none"     — fib indicator is off, no fib available, or fib was
   *                explicitly cleared by the user.
   */
  const fibSource: "auto" | "override" | "none" = !fibonacci
    ? "none"
    : displayedFibOverride
      ? "override"
      : "auto";

  // Branch 4: publish the computed primary fib into the store so the
  // chart overlay and FibStackPanel can read the whole stack
  // (primary + locked) from one place. When the indicator is off or
  // the backend signals no_active_fib, we publish null so the stack
  // doesn't carry a stale entry.
  const setPrimaryFib = useChartStore((s) => s.setPrimaryFib);

  useEffect(() => {
    if (!fibonacci || fibonacci.no_active_fib) {
      setPrimaryFib(null);
      return;
    }
    setPrimaryFib(fibonacci, fibSource === "override" ? "manual" : "auto");
  }, [fibonacci, fibSource, setPrimaryFib]);

  return {
    /** OHLCV candle data */
    candles: candlesQuery.data?.candles ?? [],
    /** Computed indicator results */
    indicators: indicatorsQuery.data?.indicators ?? [],
    /**
     * Fibonacci result to render. When the user has clicked a
     * candidate from the Candidates panel, this is the synthesized
     * result for THAT candidate. Otherwise it's the server's
     * auto-detection.
     */
    fibonacci,
    /** Where the rendered fib came from. */
    fibSource,
    /** Live tick from WebSocket (updates last candle) */
    liveTick,
    /** WebSocket connection status */
    wsStatus,
    /** TanStack Query loading state */
    isLoading: candlesQuery.isLoading,
    /** True while a fetch (initial or background) is in flight */
    isFetching: candlesQuery.isFetching,
    /** TanStack Query error */
    error: candlesQuery.error,
    /** Refetch chart data manually */
    refetch: candlesQuery.refetch,
  };
}
