import { CheckCircle2, Clock, DatabaseZap, History, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { InflectBackfillQueueStatus, InflectBackfillStatusItem } from "@/modules/inflect/api";

const STATUS_COPY: Record<
  InflectBackfillQueueStatus,
  { label: string; tone: "neutral" | "active" | "good" | "warn"; icon: typeof Clock }
> = {
  pending: { label: "Backfill queued", tone: "neutral", icon: Clock },
  rate_limited: { label: "Backfill queued", tone: "neutral", icon: Clock },
  running: { label: "Checking IBKR", tone: "active", icon: Loader2 },
  resolved: { label: "Resolved", tone: "good", icon: CheckCircle2 },
  still_needs_basis: { label: "Still needs basis", tone: "warn", icon: History },
  failed: { label: "Still needs basis", tone: "warn", icon: History },
  max_days_rejected: { label: "IBKR rejected long history", tone: "warn", icon: DatabaseZap },
};

function formatLastChecked(value: number | null): string | null {
  if (value == null) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date);
}

function needsManualLot(status: InflectBackfillQueueStatus): boolean {
  return status === "still_needs_basis" || status === "failed" || status === "max_days_rejected";
}

export function BackfillStatus({
  item,
  isLoading = false,
  onAddManualLot,
}: {
  item: InflectBackfillStatusItem | null;
  isLoading?: boolean;
  onAddManualLot?: () => void;
}) {
  if (isLoading && !item) {
    return (
      <section className="rounded-md border border-border bg-[var(--bg-1)] p-3">
        <div className="text-[10px] uppercase text-[var(--text-3)]">Basis recovery</div>
        <div className="mt-2 text-[12px] text-[var(--text-2)]">Checking queue status...</div>
      </section>
    );
  }

  if (!item) return null;

  const copy = STATUS_COPY[item.status];
  const Icon = copy.icon;
  const lastChecked = formatLastChecked(item.last_checked_ms);

  return (
    <section className="rounded-md border border-border bg-[var(--bg-1)] p-3">
      <div className="mb-2 text-[10px] uppercase text-[var(--text-3)]">Basis recovery</div>
      <div className="flex items-start gap-2">
        <div
          className={cn(
            "mt-0.5 flex h-6 w-6 items-center justify-center rounded border",
            copy.tone === "good" && "border-[var(--clr-green)]/50 text-[var(--clr-green)]",
            copy.tone === "warn" && "border-[var(--clr-orange)]/50 text-[var(--clr-orange)]",
            copy.tone === "active" && "border-[var(--clr-cyan)]/50 text-[var(--clr-cyan)]",
            copy.tone === "neutral" && "border-border text-[var(--text-3)]",
          )}
        >
          <Icon className={cn("h-3.5 w-3.5", item.status === "running" && "animate-spin")} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-[var(--text-1)]">{copy.label}</div>
          {lastChecked ? (
            <div className="mt-1 text-[11px] text-[var(--text-3)]">Last checked {lastChecked}</div>
          ) : null}
          {needsManualLot(item.status) ? (
            <div className="mt-2">
              <p className="text-[12px] text-[var(--text-2)]">
                Opening lot may predate IBKR history. Add a manual starting lot.
              </p>
              <button
                type="button"
                onClick={onAddManualLot}
                className="mt-2 inline-flex items-center rounded-md border border-[var(--clr-orange)]/50 px-2 py-1 text-[11px] font-medium text-[var(--clr-orange)] hover:border-[var(--clr-orange)] hover:text-[var(--text-1)]"
              >
                Add a manual starting lot
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
