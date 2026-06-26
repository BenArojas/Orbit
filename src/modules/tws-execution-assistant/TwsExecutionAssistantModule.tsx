import { useQuery } from "@tanstack/react-query";
import { twsApi, type TwsAdapterState } from "./api";

function ConnectionBadge({ connected }: { connected: boolean }) {
  return (
    <span className={connected ? "text-emerald-400" : "text-[var(--text-3)]"}>
      {connected ? "Connected" : "Not connected"}
    </span>
  );
}

function adapterStateLabel(state: TwsAdapterState): string {
  return state.replace(/_/g, " ");
}

export function TwsExecutionAssistantModule() {
  const { data, isLoading } = useQuery({
    queryKey: ["tws-status"],
    queryFn: twsApi.getStatus,
    refetchInterval: 5000,
  });

  return (
    <div className="min-h-screen bg-[var(--bg-1)] text-foreground">
      <div className="mx-auto max-w-4xl space-y-8 px-6 py-10">
        <header className="space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-[var(--text-3)]">
            Orbit Module
          </p>
          <h1 className="text-3xl font-semibold">TWS Execution Assistant</h1>
          <p className="text-sm text-[var(--text-2)]">Read-only broker session status</p>
        </header>

        <section className="space-y-4 rounded-xl border border-border bg-[var(--bg-2)] p-5">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
            Connection
          </h2>
          {isLoading ? (
            <p className="text-sm text-[var(--text-3)]">Loading…</p>
          ) : (
            <dl className="grid grid-cols-2 gap-y-3 text-sm">
              <dt className="text-[var(--text-2)]">Status</dt>
              <dd>
                <ConnectionBadge connected={data?.connected ?? false} />
              </dd>
              <dt className="text-[var(--text-2)]">Adapter state</dt>
              <dd className="font-mono text-[var(--text-1)]">
                {data ? adapterStateLabel(data.adapter_state) : "—"}
              </dd>
              <dt className="text-[var(--text-2)]">Kill switch</dt>
              <dd>{data?.kill_switch_active ? "Active" : "Inactive"}</dd>
              <dt className="text-[var(--text-2)]">Broker mode</dt>
              <dd className="font-mono text-[var(--text-1)]">{data?.mode ?? "—"}</dd>
            </dl>
          )}
        </section>

        <section className="space-y-4 rounded-xl border border-border bg-[var(--bg-2)] p-5">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
            Reconciliation
          </h2>
          <dl className="grid grid-cols-2 gap-y-3 text-sm">
            <dt className="text-[var(--text-2)]">Positions</dt>
            <dd>{data?.reconciliation_summary.position_count ?? 0}</dd>
            <dt className="text-[var(--text-2)]">Open orders</dt>
            <dd>{data?.reconciliation_summary.open_order_count ?? 0}</dd>
            <dt className="text-[var(--text-2)]">Unmanaged orders</dt>
            <dd>{data?.reconciliation_summary.unmanaged_order_count ?? 0}</dd>
          </dl>
        </section>
      </div>
    </div>
  );
}
