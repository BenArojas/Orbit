/**
 * useLiveQuotes — Subscribe to live last-price/change updates for a set
 * of conids and return a Map<conid, LiveTick>.
 *
 * Same WebSocket subscription mechanics as useChartData / useCompareData
 * (singleton WS, ref-counted at the transport layer) but tailored to the
 * "many tickers, one consumer" shape — the Market Pulse bar uses this to
 * replace its 10-second polling cycle on quotesBundled.
 *
 * Returns the latest tick for each conid; consumers merge with their
 * snapshot data (snapshot provides initial values and any fields the
 * live stream doesn't carry, like volume aggregates).
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { useWebSocket, type WsMessage } from "./useWebSocket";

export interface LiveQuoteTick {
  last: number;
  changePct?: number;
  changeAmt?: number;
  bid?: number;
  ask?: number;
  high?: number;
  low?: number;
  volume?: number;
}

export function useLiveQuotes(conids: number[]): Map<number, LiveQuoteTick> {
  const { subscribe, unsubscribe, addHandler } = useWebSocket();
  const [ticks, setTicks] = useState<Map<number, LiveQuoteTick>>(() => new Map());

  // Track the previously-subscribed set so we know which to add/remove
  // when the conid list changes. A bare Set comparison avoids the
  // common "subscribe-then-unsubscribe-same-conid-on-re-render" thrash
  // that breaks ref-counting at the WS singleton layer.
  const prevConidsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    const prev = prevConidsRef.current;
    const next = new Set(conids);
    // Subscribe to new ones
    for (const c of next) {
      if (!prev.has(c)) subscribe(c);
    }
    // Unsubscribe from removed ones
    for (const c of prev) {
      if (!next.has(c)) unsubscribe(c);
    }
    prevConidsRef.current = next;
    // Cleanup-on-unmount drains the whole set.
    return () => {
      for (const c of prevConidsRef.current) {
        unsubscribe(c);
      }
      prevConidsRef.current = new Set();
    };
    // We intentionally depend on the conid list's identity. Callers
    // should memoize or stabilize the array (e.g. via a sorted-join key
    // upstream) so we don't churn the WS subscriptions on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conids.join(",")]);

  const handleMessage = useCallback(
    (msg: WsMessage) => {
      if (msg.type !== "market_data") return;
      const c = msg.conid;
      if (c == null || !prevConidsRef.current.has(c)) return;
      const last = msg.last as number | undefined;
      if (last == null) return;
      setTicks((prev) => {
        const next = new Map(prev);
        const prior = next.get(c);
        next.set(c, {
          last,
          changePct: (msg.change_pct as number | undefined) ?? prior?.changePct,
          changeAmt: (msg.change_amt as number | undefined) ?? prior?.changeAmt,
          bid: (msg.bid as number | undefined) ?? prior?.bid,
          ask: (msg.ask as number | undefined) ?? prior?.ask,
          high: (msg.high as number | undefined) ?? prior?.high,
          low: (msg.low as number | undefined) ?? prior?.low,
          volume: (msg.volume as number | undefined) ?? prior?.volume,
        });
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    const remove = addHandler(handleMessage);
    return remove;
  }, [addHandler, handleMessage]);

  return ticks;
}
