/**
 * TodayTimeline — chronological feed of all trigger hits (active + dismissed
 * + snoozed). Each row jumps to Analysis on click.
 *
 * Subscribes to WS `trigger_alert` events to invalidate the hits queries
 * (so the feed updates the instant the scanner fires, without waiting for
 * the 60 s refetch).
 */

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { parallaxApi, type TriggerHit } from "@/modules/parallax/api";
import { useNavigationStore } from "@/store/navigation";
import { useWebSocket, type WsMessage } from "@/hooks/useWebSocket";
import { formatTriggerConditionValue } from "@/components/triggers/formatTriggerCondition";

const fmtTime = (iso: string) => {
  const norm = iso.includes("T") ? iso : iso.replace(" ", "T") + "Z";
  return new Date(norm).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

export function TodayTimeline() {
  const qc = useQueryClient();
  const { addHandler } = useWebSocket();
  const navigateToAnalysis = useNavigationStore((s) => s.navigateToAnalysis);

  const { data: hits } = useQuery<TriggerHit[]>({
    queryKey: ["trigger-hits", "timeline"],
    queryFn: () => parallaxApi.getTriggerHits({ status: "all", limit: 200 }),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    const off = addHandler((m: WsMessage) => {
      if (m.type === "trigger_alert") {
        qc.invalidateQueries({ queryKey: ["trigger-hits"] });
      }
    });
    return off;
  }, [addHandler, qc]);

  const rows = (hits ?? []).slice(0, 50);

  return (
    <div className="rounded-md border border-border bg-[var(--bg-1)] p-2">
      <div className="mb-1 text-[10px] uppercase tracking-wider text-[var(--text-3)]">
        Timeline
      </div>
      {rows.length === 0 ? (
        <div className="px-2 py-3 text-center text-[9.5px] text-[var(--text-3)]">
          No hits yet today.
        </div>
      ) : (
        rows.map((h) => (
          <button
            key={h.id}
            type="button"
            onClick={() => navigateToAnalysis(h.conid, h.symbol)}
            className="grid w-full grid-cols-[52px_60px_1fr_90px] items-center gap-2 px-2 py-[3px] text-left hover:bg-[var(--bg-3)]"
          >
            <span className="font-data text-[9px] text-[var(--text-3)]">
              {fmtTime(h.triggered_at)}
            </span>
            <span className="font-data text-[10px] font-semibold text-[var(--text-1)]">
              {h.symbol}
            </span>
            <span className="truncate text-[9.5px] text-[var(--text-2)]">
              {h.rule_name ?? "(deleted rule)"} ·{" "}
              {h.condition_values
                .map(formatTriggerConditionValue)
                .join(", ")}
            </span>
            <span className="truncate text-[8.5px] text-[var(--text-3)]">
              {h.watchlist_name ?? "—"}
            </span>
          </button>
        ))
      )}
    </div>
  );
}
