import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { twsApi, TWS_CONNECT_DEFAULTS, type TwsAdapterState, type TwsConnectRequest } from "./api";

const STATUS_KEY = ["tws-status"];

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

const INACTIVE_STATES: TwsAdapterState[] = ["not_initialized", "disconnected", "error"];

export function TwsExecutionAssistantModule() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<TwsConnectRequest>(TWS_CONNECT_DEFAULTS);

  const { data, isLoading } = useQuery({
    queryKey: STATUS_KEY,
    queryFn: twsApi.getStatus,
    refetchInterval: 5000,
  });

  const connectMutation = useMutation({
    mutationFn: twsApi.connect,
    onSuccess: (result) => queryClient.setQueryData(STATUS_KEY, result),
  });

  const disconnectMutation = useMutation({
    mutationFn: twsApi.disconnect,
    onSuccess: (result) => queryClient.setQueryData(STATUS_KEY, result),
  });

  const adapterState = data?.adapter_state ?? "not_initialized";
  const showForm = INACTIVE_STATES.includes(adapterState);
  const isPending =
    adapterState === "connecting" ||
    connectMutation.isPending ||
    disconnectMutation.isPending;

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
          ) : showForm ? (
            <div className="space-y-4">
              {adapterState === "error" && (
                <p className="text-sm text-red-400">
                  Connection failed — check that TWS or IB Gateway is running on the host/port below.
                </p>
              )}
              <div className="grid grid-cols-3 gap-3">
                <label className="space-y-1">
                  <span className="text-xs text-[var(--text-3)]">Host</span>
                  <input
                    className="w-full rounded border border-border bg-[var(--bg-1)] px-2 py-1.5 font-mono text-sm"
                    value={form.host}
                    onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-[var(--text-3)]">Port</span>
                  <input
                    type="number"
                    className="w-full rounded border border-border bg-[var(--bg-1)] px-2 py-1.5 font-mono text-sm"
                    value={form.port}
                    onChange={(e) => setForm((f) => ({ ...f, port: Number(e.target.value) }))}
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-[var(--text-3)]">Client ID</span>
                  <input
                    type="number"
                    className="w-full rounded border border-border bg-[var(--bg-1)] px-2 py-1.5 font-mono text-sm"
                    value={form.client_id}
                    onChange={(e) => setForm((f) => ({ ...f, client_id: Number(e.target.value) }))}
                  />
                </label>
              </div>
              <button
                className="rounded bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                disabled={isPending}
                onClick={() => connectMutation.mutate(form)}
              >
                {isPending ? "Connecting…" : "Connect TWS / IB Gateway"}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <dl className="grid grid-cols-2 gap-y-3 text-sm">
                <dt className="text-[var(--text-2)]">Status</dt>
                <dd>
                  <ConnectionBadge connected={data?.connected ?? false} />
                </dd>
                <dt className="text-[var(--text-2)]">Adapter state</dt>
                <dd className="font-mono text-[var(--text-1)]">
                  {adapterStateLabel(adapterState)}
                </dd>
                <dt className="text-[var(--text-2)]">Kill switch</dt>
                <dd>{data?.kill_switch_active ? "Active" : "Inactive"}</dd>
                <dt className="text-[var(--text-2)]">Broker mode</dt>
                <dd className="font-mono text-[var(--text-1)]">{data?.mode ?? "—"}</dd>
              </dl>
              <button
                className="rounded border border-border px-4 py-1.5 text-sm text-[var(--text-2)] disabled:opacity-50"
                disabled={isPending}
                onClick={() => disconnectMutation.mutate()}
              >
                {isPending ? "Disconnecting…" : "Disconnect"}
              </button>
            </div>
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
