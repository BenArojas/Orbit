import { useBasisAudit } from "@/hooks/useBasisLots";

function actionLabel(action: string): string {
  const labels: Record<string, string> = {
    auto_backfill: "IBKR backfill",
    lot_create: "Manual lot added",
    lot_update: "Manual lot edited",
    lot_delete: "Manual lot deleted",
  };
  return labels[action] ?? action.replace(/_/g, " ");
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function BasisAuditTrail({
  accountId,
  conid,
}: {
  accountId: string | null;
  conid: number;
}) {
  const audit = useBasisAudit(accountId, conid);
  const items = audit.data?.items ?? [];

  if (audit.isLoading) {
    return (
      <div className="h-14 animate-pulse rounded-md border border-border bg-[var(--bg-1)]" />
    );
  }

  if (!items.length) return null;

  return (
    <section className="rounded-md border border-border bg-[var(--bg-2)] p-3">
      <div className="mb-2 text-[10px] uppercase text-[var(--text-3)]">
        Basis audit
      </div>
      <div className="space-y-1.5">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center justify-between gap-2 rounded-md bg-[var(--bg-1)] px-2 py-1.5 text-[11px]"
          >
            <div>
              <div className="font-medium text-[var(--text-1)]">
                {actionLabel(item.action)}
              </div>
              <div className="text-[10px] text-[var(--text-3)]">
                {item.source ?? "Unknown source"}
              </div>
            </div>
            <div className="shrink-0 font-data text-[10px] text-[var(--text-3)]">
              {formatTime(item.created_at)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
