/**
 * useIbkrReadyTier — staggered IBKR-ready gate
 *
 * When IBKR connects, every query gated by `useIbkrReady()` fires at once.
 * On a fresh connection that can mean 20+ simultaneous requests hitting IBKR
 * before the session has fully settled.
 *
 * This hook adds a tier-based delay on top of `useIbkrReady`. The dashboard
 * uses 9 tiers (Phase 8 / Task 8.9) so components render in a clean
 * general-to-specific cascade:
 *
 *   Tier 1 — 0ms    — Market Pulse (12 tickers)
 *   Tier 2 — 250ms  — Arc Gauge Row
 *   Tier 3 — 500ms  — Sector Performance
 *   Tier 4 — 750ms  — Relative Rotation Graph
 *   Tier 5 — 1000ms — Master Watchlist sidebar
 *   Tier 6 — 1250ms — Trigger Hits watchlist
 *   Tier 7 — 1500ms — Trigger Rules
 *   Tier 8 — 1750ms — Watchlist expiry config
 *   Tier 9 — 2000ms — Alert Log
 *
 * The delay resets whenever `ibkrReady` drops to false (disconnect / re-auth),
 * so the stagger applies again on reconnect. This is also what drives
 * "skeleton while reconnecting" behaviour on route re-entry.
 *
 * Usage:
 *   const ready = useIbkrReadyTier(3);
 *   useQuery({ ..., enabled: ready });
 */

import { useEffect, useRef, useState } from "react";
import { useIbkrReady } from "@/context/GatewayContext";

/** Number of tiers supported. Keep in sync with TIER_DELAY_MS. */
export type Tier = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/** Delay in ms before each tier's gate flips true after IBKR is ready. */
export const TIER_DELAY_MS: Record<Tier, number> = {
  1: 0,
  2: 250,
  3: 500,
  4: 750,
  5: 1_000,
  6: 1_250,
  7: 1_500,
  8: 1_750,
  9: 2_000,
};

export function useIbkrReadyTier(tier: Tier): boolean {
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
