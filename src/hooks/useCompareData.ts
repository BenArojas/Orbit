/**
 * useCompareData — Per-pane data fetching for Compare Mode.
 *
 * Fetches historical candles for the stock and/or reference conid via the
 * existing POST /indicators/compute endpoint with an empty indicator list.
 * Query keys mirror useChartData (["candles", conid, timeframe, period]) so
 * the TanStack Query cache is shared — if the same conid is already loaded in
 * the main chart, Compare Mode gets the data instantly from cache.
 *
 * Subscribes to live WebSocket ticks for whichever conids are active in the
 * current layout. Uses the ref-counted singleton from useWebSocket so multiple
 * panes can share subscriptions without duplicating traffic.
 *
 * Layout controls which conids are fetched and subscribed:
 *   "overlay"   — both stock and reference
 *   "stockOnly" — stock only
 *   "refOnly"   — reference only
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";

import { api, type CandleData, type IndicatorComputeResponse } from "@/lib/api";
import { useIbkrReady } from "@/context/GatewayContext";
import { useWebSocket, type WsMessage } from "./useWebSocket";
import type { Timeframe } from "@/store/chart";
import type { Layout } from "@/store/compare";

// ── Types ────────────────────────────────────────────────────

export interface CompareLiveTick {
  last: number;
  volume: number;
  high: number;
  low: number;
}

interface UseCompareDataResult {
  stockCandles: CandleData[] | undefined;
  refCandles: CandleData[] | undefined;
  stockLiveTick: CompareLiveTick | null;
  refLiveTick: CompareLiveTick | null;
  isLoading: boolean;
  error: unknown;
}

// ── Constants ────────────────────────────────────────────────

const HISTORY_PERIOD = "3M";

// ── Hook ─────────────────────────────────────────────────────

export function useCompareData(
  stockConid: number | null,
  refConid: number | null,
  timeframe: Timeframe,
  layout: Layout,
): UseCompareDataResult {
  const ibkrReady = useIbkrReady();
  const { subscribe, unsubscribe, addHandler } = useWebSocket();

  const wantsStock = layout !== "refOnly";
  const wantsRef = layout !== "stockOnly";

  // ── TanStack Query: fetch candles ─────────────────────────
  //
  // Query keys intentionally match useChartData's candle query key shape
  // (["candles", conid, timeframe, period]) so Compare panes share the cache
  // with the main chart and avoid redundant network requests.

  const stockQuery = useQuery<IndicatorComputeResponse>({
    queryKey: ["candles", stockConid, timeframe, HISTORY_PERIOD],
    queryFn: ({ signal }) =>
      api.computeIndicators({
        conid: stockConid!,
        timeframe,
        indicators: [],
        history_period: HISTORY_PERIOD,
      }, signal),
    enabled: ibkrReady && wantsStock && stockConid != null,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });

  const refQuery = useQuery<IndicatorComputeResponse>({
    queryKey: ["candles", refConid, timeframe, HISTORY_PERIOD],
    queryFn: ({ signal }) =>
      api.computeIndicators({
        conid: refConid!,
        timeframe,
        indicators: [],
        history_period: HISTORY_PERIOD,
      }, signal),
    enabled: ibkrReady && wantsRef && refConid != null,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });

  // ── WebSocket: subscribe to live data for active conids ───
  //
  // Refs track the currently-subscribed conid. Each effect run is a
  // diff (subscribe new, unsubscribe old) — there is no cleanup return
  // on these effects. The unmount cleanup is a SEPARATE effect at the
  // bottom with empty deps. Mixing the diff and the drain in the same
  // effect was the source of the subscribe-storm we saw on dashboard
  // → analysis navigation (two panes' effects running in interleaved
  // order produced fake refcount-0 transitions that pinged IBKR).

  const prevStockConidRef = useRef<number | null>(null);
  const prevRefConidRef = useRef<number | null>(null);

  useEffect(() => {
    const prev = prevStockConidRef.current;
    if (wantsStock && stockConid != null) {
      if (prev !== stockConid) {
        if (prev != null) unsubscribe(prev);
        subscribe(stockConid);
        prevStockConidRef.current = stockConid;
      }
    } else if (prev != null) {
      unsubscribe(prev);
      prevStockConidRef.current = null;
    }
  }, [wantsStock, stockConid, subscribe, unsubscribe]);

  useEffect(() => {
    const prev = prevRefConidRef.current;
    if (wantsRef && refConid != null) {
      if (prev !== refConid) {
        if (prev != null) unsubscribe(prev);
        subscribe(refConid);
        prevRefConidRef.current = refConid;
      }
    } else if (prev != null) {
      unsubscribe(prev);
      prevRefConidRef.current = null;
    }
  }, [wantsRef, refConid, subscribe, unsubscribe]);

  // Unmount-only cleanup — drains whichever conids are currently held.
  useEffect(() => {
    return () => {
      if (prevStockConidRef.current != null) {
        unsubscribe(prevStockConidRef.current);
        prevStockConidRef.current = null;
      }
      if (prevRefConidRef.current != null) {
        unsubscribe(prevRefConidRef.current);
        prevRefConidRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Live tick state ───────────────────────────────────────

  const [stockLiveTick, setStockLiveTick] = useState<CompareLiveTick | null>(null);
  const [refLiveTick, setRefLiveTick] = useState<CompareLiveTick | null>(null);

  // Reset ticks when conid or timeframe changes
  useEffect(() => { setStockLiveTick(null); }, [stockConid, timeframe]);
  useEffect(() => { setRefLiveTick(null); }, [refConid, timeframe]);

  // ── Handle incoming WebSocket messages ─────────────────────

  const handleMessage = useCallback(
    (msg: WsMessage) => {
      if (msg.type !== "market_data") return;
      const last = msg.last as number | undefined;
      if (last == null) return;
      const volume = msg.volume as number | undefined;
      const high = msg.high as number | undefined;
      const low = msg.low as number | undefined;
      if (msg.conid === stockConid) {
        setStockLiveTick((prev) => ({
          last,
          volume: volume ?? prev?.volume ?? 0,
          high: high ?? prev?.high ?? last,
          low: low ?? prev?.low ?? last,
        }));
      } else if (msg.conid === refConid) {
        setRefLiveTick((prev) => ({
          last,
          volume: volume ?? prev?.volume ?? 0,
          high: high ?? prev?.high ?? last,
          low: low ?? prev?.low ?? last,
        }));
      }
    },
    [stockConid, refConid],
  );

  useEffect(() => {
    const remove = addHandler(handleMessage);
    return remove;
  }, [addHandler, handleMessage]);

  // ── Return ────────────────────────────────────────────────

  return {
    stockCandles: stockQuery.data?.candles,
    refCandles: refQuery.data?.candles,
    stockLiveTick,
    refLiveTick,
    isLoading: stockQuery.isLoading || refQuery.isLoading,
    error: stockQuery.error ?? refQuery.error,
  };
}
