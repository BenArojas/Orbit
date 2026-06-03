import { Database, Trash2 } from "lucide-react";
import { useState } from "react";
import { useInflectStorage, useInflectStorageCleanup } from "@/hooks/useInflectStorage";

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function defaultCleanupDate(): string {
  const date = new Date();
  date.setMonth(date.getMonth() - 6);
  return date.toISOString().slice(0, 10);
}

export function StoragePanel() {
  const storage = useInflectStorage();
  const cleanup = useInflectStorageCleanup();
  const [beforeDate, setBeforeDate] = useState(defaultCleanupDate());
  const counts = storage.data?.table_counts ?? {};

  async function clearRawPayloads() {
    if (
      !window.confirm(
        "Export first if you need raw IBKR payloads. Cleanup clears old raw payload blobs only.",
      )
    ) {
      return;
    }
    await cleanup.mutateAsync({ before_date: beforeDate, confirm: true });
  }

  return (
    <section className="rounded-md border border-border bg-[var(--bg-2)] p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-[var(--clr-cyan)]" strokeWidth={1.8} />
          <div>
            <div className="text-[11px] font-semibold uppercase text-[var(--text-2)]">
              Storage
            </div>
            <div className="text-[10px] text-[var(--text-3)]">
              Raw payload cleanup keeps derived trade data intact.
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[10px] uppercase text-[var(--text-3)]">
            Cleanup before date
            <input
              aria-label="Cleanup before date"
              type="date"
              value={beforeDate}
              onChange={(event) => setBeforeDate(event.target.value)}
              className="ml-2 h-8 rounded-md border border-border bg-[var(--bg-1)] px-2 font-data text-[11px] text-[var(--text-1)]"
            />
          </label>
          <button
            type="button"
            disabled={cleanup.isPending || !beforeDate}
            onClick={() => void clearRawPayloads()}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-[var(--bg-1)] px-2 text-[11px] text-[var(--text-2)] hover:text-[var(--text-1)] disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
            Clear raw payloads
          </button>
        </div>
      </div>

      {storage.isLoading ? (
        <div className="h-14 animate-pulse rounded-md bg-[var(--bg-1)]" />
      ) : (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Metric label="DB size" value={formatBytes(storage.data?.file_size_bytes ?? 0)} />
          <Metric label="Raw payloads" value={formatBytes(storage.data?.raw_json_bytes ?? 0)} />
          <Metric label="Fills" value={String(counts.fills ?? 0)} />
          <Metric label="Basis rows" value={String((counts.basis_lots ?? 0) + (counts.basis_audit ?? 0))} />
        </div>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-[var(--bg-1)] px-2.5 py-2">
      <div className="text-[9px] uppercase text-[var(--text-3)]">{label}</div>
      <div className="font-data text-[13px] text-[var(--text-1)]">{value}</div>
    </div>
  );
}

