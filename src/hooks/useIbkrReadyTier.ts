/**
 * useIbkrReadyTier — staggered IBKR-ready gate
 *
 * When IBKR connects, every query gated by `useIbkrReady()` fires at once.
 * On a fresh connection that can mean 20+ simultaneous requests hitting IBKR
 * before the session has fully settled.
 *
 * This hook adds a tier-based delay on top of `useIbkrReady`. The dashboard
 * uses 4 tiers (Phase 8 / Task 3.4) so components render in a clean
 * general-to-specific cascade with a total cascade time of 800ms:
 *
 *   Tier 1 — 0ms   — MarketPulse, ArcGaugeRow (bundled, above-the-fold)
 *   Tier 2 — 200ms — SectorPerformancePanel, RRGPanel (server-cached)
 *   Tier 3 — 400ms — WatchlistSidebar, TriggerWatchlist
 *   Tier 4 — 800ms — TriggerRules, AlertLog
 *
 * Previous: 9 tiers at 250ms each = 2000ms total cascade.
 * Now: 4 tiers = 800ms total cascade. With server-side bundling (Task 2.1,
 * 2.2) and caching (Task 2.3) the staircase no longer needs to compensate
 * for IBKR pacing pressure — fewer requests reach IBKR so earlier tiers
 * can start sooner.
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
export type Tier = 1 | 2 | 3 | 4;

/** Delay in ms before each tier's gate flips true after IBKR is ready. */
export const TIER_DELAY_MS: Record<Tier, number> = {
  1: 0,
  2: 200,
  3: 400,
  4: 800,
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
