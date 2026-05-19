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

  // Track the currently-subscribed set so each effect run only emits
  // the *delta* (newly-added / newly-removed conids). The unmount
  // cleanup is a SEPARATE effect with an empty dep array — putting the
  // drain logic in the dep-tracking effect's cleanup is the bug this
  // hook had previously: every conid-list change would cause cleanup
  // → drain ALL → body re-subscribe ALL. On MarketPulse cold-load that
  // amplified into a 12-deep subscribe-storm.
  const subscribedRef = useRef<Set<number>>(new Set());

  // Diff effect — runs whenever the conid list changes. No cleanup
  // return on purpose: we only want to add/remove deltas here.
  useEffect(() => {
    const prev = subscribedRef.current;
    const next = new Set(conids);
    for (const c of next) {
      if (!prev.has(c)) subscribe(c);
    }
    for (const c of prev) {
      if (!next.has(c)) unsubscribe(c);
    }
    subscribedRef.current = next;
    // We intentionally depend on the conid list's *content* (joined),
    // not the array identity — callers don't have to memoize the array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conids.join(",")]);

  // Unmount-only cleanup. Empty deps → this effect's cleanup function
  // runs exactly once when the component unmounts, draining whatever
  // is in subscribedRef at that point.
  useEffect(() => {
    return () => {
      for (const c of subscribedRef.current) {
        unsubscribe(c);
      }
      subscribedRef.current = new Set();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleMessage = useCallback(
    (msg: WsMessage) => {
      if (msg.type !== "market_data") return;
      const c = msg.conid;
      if (c == null || !subscribedRef.current.has(c)) return;
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
