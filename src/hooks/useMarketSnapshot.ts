/**
 * useMarketSnapshot — Today page 7-cell context strip data source.
 *
 * Bundles the four existing market-context endpoints into a single
 * normalized shape so `<TodayContextStrip />` stays a dumb renderer:
 *   - quotes for SPX + VIX (resolved at runtime per env)
 *   - sector ETF performance (top / worst)
 *   - market breadth gauge
 *   - sector rotation (offensive vs defensive leader)
 *
 * Refetches every 30 s; treats any sub-call failing as that cell
 * being `null` so the strip degrades gracefully instead of crashing.
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

type SnapshotCell<T> = T | null;

export interface MarketSnapshot {
  spx: SnapshotCell<{ last: number; changePct: number }>;
  vix: SnapshotCell<{ last: number; changePct: number }>;
  breadth: SnapshotCell<{ value: number; label: string }>;
  strength: SnapshotCell<{ value: number; label: string }>;
  rotation: SnapshotCell<{ leader: string }>;
  topSector: SnapshotCell<{ ticker: string; changePct: number }>;
  worstSector: SnapshotCell<{ ticker: string; changePct: number }>;
}

function breadthLabel(pct: number): string {
  if (pct >= 75) return "strong";
  if (pct >= 55) return "bullish";
  if (pct >= 45) return "mixed";
  if (pct >= 25) return "bearish";
  return "weak";
}

function rotationLabel(value: number): string {
  if (value >= 70) return "offensive";
  if (value >= 55) return "risk-on";
  if (value > 45) return "neutral";
  if (value > 30) return "risk-off";
  return "defensive";
}

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch {
    return null;
  }
}

export function useMarketSnapshot() {
  return useQuery<MarketSnapshot>({
    queryKey: ["today-context-strip"],
    queryFn: async ({ signal }) => {
      // Resolve SPX/VIX conids at runtime — paper/live envs differ.
      const [spxResolved, vixResolved] = await Promise.all([
        safe(api.resolveConid("SPX", undefined, signal)),
        safe(api.resolveConid("VIX", undefined, signal)),
      ]);

      const conids: number[] = [];
      if (spxResolved) conids.push(spxResolved.conid);
      if (vixResolved) conids.push(vixResolved.conid);

      const [quotesRes, sectors, breadth, rotation] = await Promise.all([
        conids.length
          ? safe(api.quotesBundled(conids, signal))
          : Promise.resolve(null),
        safe(api.sectorPerformance(signal)),
        safe(api.marketBreadth(signal)),
        safe(api.sectorRotation(signal)),
      ]);

      const items = quotesRes?.items ?? [];
      const spxQ = spxResolved
        ? items.find((q) => q.conid === spxResolved.conid) ?? null
        : null;
      const vixQ = vixResolved
        ? items.find((q) => q.conid === vixResolved.conid) ?? null
        : null;

      const sortedSectors = (sectors ?? [])
        .filter((s) => s.changePercent != null)
        .map((s) => ({ ticker: s.symbol, changePct: s.changePercent as number }))
        .sort((a, b) => b.changePct - a.changePct);

      // Pick the leading RRG-style sector from sectorRotation:
      // the strongest offensive constituent (highest pct), else best sector.
      const rotationLeader = (() => {
        if (!rotation) return null;
        const allOff = (rotation.offensive ?? []).filter((s) => s.pct != null);
        if (allOff.length) {
          const top = [...allOff].sort(
            (a, b) => (b.pct as number) - (a.pct as number),
          )[0];
          return top?.symbol ?? null;
        }
        return sortedSectors[0]?.ticker ?? null;
      })();

      return {
        spx:
          spxQ && spxQ.lastPrice != null && spxQ.changePercent != null
            ? { last: spxQ.lastPrice, changePct: spxQ.changePercent }
            : null,
        vix:
          vixQ && vixQ.lastPrice != null && vixQ.changePercent != null
            ? { last: vixQ.lastPrice, changePct: vixQ.changePercent }
            : null,
        breadth: breadth
          ? { value: Math.round(breadth.value), label: breadthLabel(breadth.value) }
          : null,
        strength: breadth
          ? { value: Math.round(breadth.value), label: breadthLabel(breadth.value) }
          : null,
        rotation:
          rotation && rotationLeader
            ? { leader: rotationLeader }
            : rotation
              ? { leader: rotationLabel(rotation.value) }
              : null,
        topSector: sortedSectors[0] ?? null,
        worstSector:
          sortedSectors.length > 0
            ? sortedSectors[sortedSectors.length - 1]
            : null,
      };
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}
