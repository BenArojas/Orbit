/**
 * useIbkrReadyTier — staggered IBKR-ready gate (Phase 7.4a)
 *
 * When IBKR connects, every query gated by `useIbkrReady()` fires at once.
 * On a fresh connection that can mean 15+ simultaneous requests hitting IBKR
 * before the session has fully settled.
 *
 * This hook adds a tier-based delay on top of `useIbkrReady`:
 *
 *   Tier 1 — fires immediately  (critical path: symbol lookup, watchlists, rules)
 *   Tier 2 — fires after 800ms  (important: watchlist items, quotes, trigger hits)
 *   Tier 3 — fires after 2 000ms (heavy background: sector performance, RRG)
 *
 * The delay resets whenever `ibkrReady` drops to false (disconnect / re-auth),
 * so the stagger applies again on reconnect.
 *
 * Usage:
 *   const ready = useIbkrReadyTier(3);
 *   useQuery({ ..., enabled: ready });
 */

import { useEffect, useRef, useState } from "react";
import { useIbkrReady } from "@/context/GatewayContext";

const TIER_DELAY_MS: Record<1 | 2 | 3, number> = {
  1: 0,
  2: 800,
  3: 2_000,
};

export function useIbkrReadyTier(tier: 1 | 2 | 3): boolean {
  const ibkrReady = useIbkrReady();
  const [timerFired, setTimerFired] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Clear any in-flight timer when ibkrReady changes
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (!ibkrReady) {
      // Reset so the delay applies again on reconnect
      setTimerFired(false);
      return;
    }

    const delay = TIER_DELAY_MS[tier];

    if (delay === 0) {
      setTimerFired(true);
      return;
    }

    timerRef.current = setTimeout(() => {
      setTimerFired(true);
      timerRef.current = null;
    }, delay);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [ibkrReady, tier]);

  return ibkrReady && timerFired;
}
