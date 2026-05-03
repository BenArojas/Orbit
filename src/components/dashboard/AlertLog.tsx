/**
 * Alert Log — Phase 6.7
 *
 * Dashboard bottom panel: chronological feed of every trigger hit (newest first).
 * Rows show time, symbol, rule name, indicator/condition/threshold → actual value,
 * and source → target watchlist movement.
 *
 * Behaviour:
 *   - Populated from GET /triggers/hits (query cache: ["trigger-hits"])
 *   - Live updates: when a WS `trigger_alert` arrives, invalidate the query
 *     so the newly-recorded hit is pulled in immediately.
 *   - Click a row → jumps the Analysis chart to that conid AND shows a brief
 *     floating toast with the trigger description.
 *
 * Height is fixed at 160px (set by the parent grid row in DashboardPage).
 */

import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { api, type TriggerHit } from "@/lib/api";
import { useNavigationStore } from "@/store";
import { useWebSocket, type WsMessage } from "@/hooks/useWebSocket";
import { useIbkrReadyTier } from "@/hooks/useIbkrReadyTier";
import { AlertLogSkeleton } from "./skeletons";

// ── Helpers ──────────────────────────────────────────────────

/** Relative / short time label. */
function formatTime(iso: string): string {
  try {
    // Backend writes UTC timestamps in "YYYY-MM-DD HH:MM:SS" form (no TZ suffix)
    // — normalise so Date treats them as UTC.
    const norm = iso.includes("T") ? iso : iso.replace(" ", "T") + "Z";
    const d = new Date(norm);
    return d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

/** Colour-codes hits by family so the log scans fast. */
const INDICATOR_COLOR: Record<string, string> = {
  rsi: "var(--clr-purple)",
  macd: "var(--clr-purple)",
  stoch: "var(--clr-purple)",
  bbands: "var(--clr-purple)",
  ema_9: "var(--clr-cyan)",
  ema_21: "var(--clr-cyan)",
  ema_50: "var(--clr-cyan)",
  ema_200: "var(--clr-cyan)",
  vwap: "var(--clr-cyan)",
  adx: "var(--clr-cyan)",
  volume: "var(--clr-orange)",
  obv: "var(--clr-orange)",
  atr: "var(--clr-orange)",
  fibonacci: "var(--clr-green)",
  news_candle: "var(--clr-red)",
};

function getDotColor(indicator: string): string {
  return INDICATOR_COLOR[indicator] ?? "var(--text-3)";
}

/** Turn a hit into the short description we show both in-row and in the toast. */
function describe(hit: TriggerHit): string {
  const cond = hit.condition.replace(/_/g, " ");
  const val = Number.isFinite(hit.actual_value)
    ? hit.actual_value.toFixed(2)
    : String(hit.actual_value);
  return `${hit.symbol} ${hit.indicator} ${cond} ${hit.threshold} → ${val}`;
}

// ── Toast ────────────────────────────────────────────────────

interface ToastState {
  id: number;
  title: string;
  body: string;
}

function AlertToast({ toast, onDismiss }: { toast: ToastState; onDismiss: () => void }) {
  useEffect(() => {
    const t = window.setTimeout(onDismiss, 4000);
    return () => window.clearTimeout(t);
  }, [toast.id, onDismiss]);

  return (
    <div
      className="pointer-events-none absolute right-3 top-2 z-20 min-w-[240px] max-w-[360px] rounded-md border border-border bg-[var(--bg-2)]/95 px-3 py-2 shadow-lg backdrop-blur animate-in fade-in"
      style={{ boxShadow: "0 0 16px var(--glow-cyan)" }}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--clr-cyan)]">
        {toast.title}
      </div>
      <div className="mt-0.5 font-data text-[11px] text-[var(--text-1)]">
        {toast.body}
      </div>
    </div>
  );
}

// ── Row ──────────────────────────────────────────────────────

function HitRow({
  hit,
  onClick,
}: {
  hit: TriggerHit;
  onClick: (hit: TriggerHit) => void;
}) {
  return (
    <button
      onClick={() => onClick(hit)}
      className="grid w-full grid-cols-[72px_minmax(70px,1fr)_minmax(140px,1.4fr)_minmax(180px,2fr)_minmax(180px,1.4fr)] items-center gap-2 px-3 py-[5px] text-left transition-colors hover:bg-[var(--bg-3)]"
    >
      {/* Time */}
      <span className="font-data text-[10px] text-[var(--text-3)]">
        {formatTime(hit.triggered_at)}
      </span>

      {/* Symbol + indicator colour dot */}
      <span className="flex items-center gap-1.5">
        <span
          className="h-[6px] w-[6px] shrink-0 rounded-full"
          style={{
            backgroundColor: getDotColor(hit.indicator),
            boxShadow: `0 0 6px ${getDotColor(hit.indicator)}`,
          }}
        />
        <span className="truncate font-data text-[11px] font-semibold text-[var(--text-1)]">
          {hit.symbol}
        </span>
      </span>

      {/* Rule name */}
      <span className="truncate text-[10px] text-[var(--text-2)]">
        {hit.rule_name ?? <span className="italic text-[var(--text-3)]">(deleted rule)</span>}
      </span>

      {/* Trigger description */}
      <span className="truncate font-data text-[10px] text-[var(--text-2)]">
        {hit.indicator}{" "}
        <span className="text-[var(--text-3)]">{hit.condition.replace(/_/g, " ")}</span>{" "}
        {hit.threshold}
        <span className="mx-1 text-[var(--text-3)]">→</span>
        <span className="text-[var(--clr-cyan)]">
          {Number.isFinite(hit.actual_value) ? hit.actual_value.toFixed(2) : hit.actual_value}
        </span>
      </span>

      {/* Watchlist move */}
      <span className="truncate font-data text-[10px] text-[var(--text-3)]">
        {hit.source_watchlist}
        <span className="mx-1 text-[var(--text-3)]">→</span>
        <span className={hit.moved_back ? "text-[var(--text-3)] line-through" : "text-[var(--text-2)]"}>
          {hit.target_watchlist}
        </span>
      </span>
    </button>
  );
}

// ── Main ─────────────────────────────────────────────────────

export default function AlertLog() {
  const queryClient = useQueryClient();
  const { addHandler } = useWebSocket();
  const navigateToAnalysis = useNavigationStore((s) => s.navigateToAnalysis);

  const [toast, setToast] = useState<ToastState | null>(null);

  // Tier 4 in the 4-tier dashboard cascade (Phase 8 / Task 3.4): 800ms.
  const tierReady = useIbkrReadyTier(4);

  // Rule 4: WS-event-driven — staleTime = refetchInterval / 2 as safety net;
  // WS trigger_alert invalidation is the primary freshness mechanism (below).
  const { data: hits, isLoading, isError } = useQuery<TriggerHit[]>({
    queryKey: ["trigger-hits"],
    queryFn: () => api.getTriggerHits(200),
    refetchInterval: 60_000,
    staleTime: 30_000,
    enabled: tierReady,
  });

  // Invalidate the hits query whenever the scanner broadcasts a fresh alert so
  // we pick up the new row without waiting for the 60s refetch.
  useEffect(() => {
    const off = addHandler((msg: WsMessage) => {
      if (msg.type !== "trigger_alert") return;
      queryClient.invalidateQueries({ queryKey: ["trigger-hits"] });
    });
    return off;
  }, [addHandler, queryClient]);

  const handleClick = useCallback(
    (hit: TriggerHit) => {
      // 1. Jump the chart to this symbol.
      navigateToAnalysis(hit.conid);

      // 2. Flash a toast with the description.
      setToast({
        id: Date.now(),
        title: hit.rule_name ? `Trigger · ${hit.rule_name}` : `Trigger · ${hit.symbol}`,
        body: describe(hit),
      });
    },
    [navigateToAnalysis],
  );

  // Phase 8.9 — collapse behaviour:
  //   - Tier not ready OR first fetch in-flight → skeleton (short)
  //   - No hits → just show the header row (fully collapsed)
  //   - Hits → show column header + scrollable list, capped at ~160 px
  const showSkeleton = !tierReady || (isLoading && !hits);
  const hasHits = !!hits && hits.length > 0;
  const collapsed = !showSkeleton && !isError && !hasHits;

  return (
    <div className="relative flex flex-col border-t border-border bg-[var(--bg-1)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
          Alert Log
        </span>
        <span className="flex items-center gap-2">
          {collapsed && (
            <span className="text-[9px] text-[var(--text-3)] opacity-70">
              no alerts
            </span>
          )}
          <span className="rounded-full bg-[var(--bg-3)] px-1.5 py-0.5 font-data text-[9px] text-[var(--text-3)]">
            {hits?.length ?? 0}
          </span>
        </span>
      </div>

      {/* Collapsed? Nothing else to render — the dashboard reclaims this space. */}
      {!collapsed && (
        <>
          {/* Column header — hidden while collapsed to keep the bar minimal */}
          {!showSkeleton && (
            <div className="grid grid-cols-[72px_minmax(70px,1fr)_minmax(140px,1.4fr)_minmax(180px,2fr)_minmax(180px,1.4fr)] items-center gap-2 border-b border-border bg-[var(--bg-2)]/60 px-3 py-1 text-[9px] uppercase tracking-wider text-[var(--text-3)]">
              <span>Time</span>
              <span>Symbol</span>
              <span>Rule</span>
              <span>Condition → Actual</span>
              <span>Source → Target</span>
            </div>
          )}

          {/* Rows — capped height when populated so the dashboard keeps room above */}
          <div
            className="overflow-y-auto"
            style={{ maxHeight: "160px" }}
          >
            {showSkeleton ? (
              <AlertLogSkeleton rows={4} />
            ) : isError ? (
              <div className="flex items-center justify-center gap-1.5 py-4">
                <span className="text-[10px] text-[var(--clr-red)]">Failed to load alerts</span>
                <span className="text-[10px] text-[var(--text-3)]">— will retry</span>
              </div>
            ) : (
              hits!.map((hit) => (
                <HitRow key={hit.id} hit={hit} onClick={handleClick} />
              ))
            )}
          </div>
        </>
      )}

      {/* Click toast (floats inside the panel) */}
      {toast && <AlertToast toast={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
