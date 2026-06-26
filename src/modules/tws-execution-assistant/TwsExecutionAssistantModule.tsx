import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { twsApi, TWS_CONNECT_DEFAULTS, type ExecutionPlan, type ExecutionPlanDraftRequest, type ExecutionPlanOrderType, type ExecutionPlanSide, type OrderSnapshot, type TwsAdapterState, type TwsConnectRequest } from "./api";

const STATUS_KEY = ["tws-status"];
const RECON_KEY = ["tws-reconciliation"];

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

function UnmanagedBadge() {
  return (
    <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-400">
      unmanaged
    </span>
  );
}

function OrderRow({ order }: { order: OrderSnapshot }) {
  return (
    <tr className="border-t border-border text-sm">
      <td className="py-2 pr-4 font-medium">{order.symbol}</td>
      <td className={`pr-4 ${order.side === "BUY" ? "text-emerald-400" : "text-red-400"}`}>
        {order.side}
      </td>
      <td className="pr-4 font-mono">{order.quantity}</td>
      <td className="pr-4 font-mono text-[var(--text-2)]">{order.order_type}</td>
      <td className="pr-4 font-mono text-[var(--text-2)]">
        {order.lmt_price != null ? order.lmt_price.toFixed(2) : "—"}
      </td>
      <td className="pr-4 text-[var(--text-2)]">{order.status}</td>
      <td>{order.is_unmanaged && <UnmanagedBadge />}</td>
    </tr>
  );
}

const INACTIVE_STATES: TwsAdapterState[] = ["not_initialized", "disconnected", "error"];

const PLAN_DEFAULTS: ExecutionPlanDraftRequest = {
  conid: 0,
  symbol: "",
  side: "BUY",
  quantity: 1,
  order_type: "LMT",
  limit_price: null,
};

function PlanStatusBadge({ status }: { status: ExecutionPlan["status"] }) {
  const styles = {
    draft: "bg-[var(--bg-1)] text-[var(--text-3)]",
    valid: "bg-emerald-500/15 text-emerald-400",
    invalid: "bg-red-500/15 text-red-400",
  };
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-semibold uppercase ${styles[status]}`}>
      {status}
    </span>
  );
}

export function TwsExecutionAssistantModule() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<TwsConnectRequest>(TWS_CONNECT_DEFAULTS);
  const [planForm, setPlanForm] = useState<ExecutionPlanDraftRequest>(PLAN_DEFAULTS);
  const [currentPlan, setCurrentPlan] = useState<ExecutionPlan | null>(null);

  const { data: status, isLoading } = useQuery({
    queryKey: STATUS_KEY,
    queryFn: twsApi.getStatus,
    refetchInterval: 5000,
  });

  const { data: recon } = useQuery({
    queryKey: RECON_KEY,
    queryFn: twsApi.getReconciliation,
    refetchInterval: 10000,
    enabled: status?.connected === true,
  });

  const connectMutation = useMutation({
    mutationFn: twsApi.connect,
    onSuccess: (result) => {
      queryClient.setQueryData(STATUS_KEY, result);
      queryClient.invalidateQueries({ queryKey: RECON_KEY });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: twsApi.disconnect,
    onSuccess: (result) => {
      queryClient.setQueryData(STATUS_KEY, result);
      queryClient.setQueryData(RECON_KEY, undefined);
    },
  });

  const createPlanMutation = useMutation({
    mutationFn: twsApi.createPlanDraft,
    onSuccess: (plan) => {
      setCurrentPlan(plan);
      setPlanForm(PLAN_DEFAULTS);
    },
  });

  const validatePlanMutation = useMutation({
    mutationFn: (plan_id: string) => twsApi.validatePlan(plan_id),
    onSuccess: setCurrentPlan,
  });

  const adapterState = status?.adapter_state ?? "not_initialized";
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

        {/* Connection */}
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
                <dd><ConnectionBadge connected={status?.connected ?? false} /></dd>
                <dt className="text-[var(--text-2)]">Adapter state</dt>
                <dd className="font-mono text-[var(--text-1)]">{adapterStateLabel(adapterState)}</dd>
                <dt className="text-[var(--text-2)]">Kill switch</dt>
                <dd>{status?.kill_switch_active ? "Active" : "Inactive"}</dd>
                <dt className="text-[var(--text-2)]">Broker mode</dt>
                <dd className="font-mono text-[var(--text-1)]">{status?.mode ?? "—"}</dd>
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

        {/* Positions */}
        {recon && recon.positions.length > 0 && (
          <section className="space-y-3 rounded-xl border border-border bg-[var(--bg-2)] p-5">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
              Positions ({recon.position_count})
            </h2>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs text-[var(--text-3)]">
                  <th className="pb-2 pr-4 font-medium">Symbol</th>
                  <th className="pb-2 pr-4 font-medium">Qty</th>
                  <th className="pb-2 font-medium">Avg Cost</th>
                </tr>
              </thead>
              <tbody>
                {recon.positions.map((p) => (
                  <tr key={p.conid} className="border-t border-border">
                    <td className="py-2 pr-4 font-medium">{p.symbol}</td>
                    <td className={`pr-4 font-mono ${p.position < 0 ? "text-red-400" : ""}`}>
                      {p.position}
                    </td>
                    <td className="font-mono text-[var(--text-2)]">{p.avg_cost.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {/* Open Orders */}
        {recon && recon.open_orders.length > 0 && (
          <section className="space-y-3 rounded-xl border border-border bg-[var(--bg-2)] p-5">
            <div className="flex items-center gap-2">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
                Open Orders ({recon.open_order_count})
              </h2>
              {recon.unmanaged_order_count > 0 && (
                <span className="text-xs text-amber-400">
                  {recon.unmanaged_order_count} unmanaged
                </span>
              )}
            </div>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs text-[var(--text-3)]">
                  <th className="pb-2 pr-4 font-medium">Symbol</th>
                  <th className="pb-2 pr-4 font-medium">Side</th>
                  <th className="pb-2 pr-4 font-medium">Qty</th>
                  <th className="pb-2 pr-4 font-medium">Type</th>
                  <th className="pb-2 pr-4 font-medium">Price</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {recon.open_orders.map((o) => <OrderRow key={o.order_id} order={o} />)}
              </tbody>
            </table>
          </section>
        )}

        {/* Execution Plan Draft */}
        <section className="space-y-4 rounded-xl border border-border bg-[var(--bg-2)] p-5">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
            Execution Plan
          </h2>

          {currentPlan ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium">{currentPlan.symbol}</span>
                <span className={`text-sm font-medium ${currentPlan.side === "BUY" ? "text-emerald-400" : "text-red-400"}`}>
                  {currentPlan.side}
                </span>
                <span className="font-mono text-sm">{currentPlan.quantity}</span>
                <span className="font-mono text-sm text-[var(--text-2)]">{currentPlan.order_type}</span>
                {currentPlan.limit_price != null && (
                  <span className="font-mono text-sm text-[var(--text-2)]">@ {currentPlan.limit_price}</span>
                )}
                <PlanStatusBadge status={currentPlan.status} />
              </div>

              {currentPlan.validation_errors.length > 0 && (
                <ul className="space-y-1">
                  {currentPlan.validation_errors.map((e, i) => (
                    <li key={i} className="text-sm text-red-400">• {e}</li>
                  ))}
                </ul>
              )}

              <div className="flex gap-2">
                <button
                  className="rounded bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  disabled={validatePlanMutation.isPending}
                  onClick={() => validatePlanMutation.mutate(currentPlan.plan_id)}
                >
                  {validatePlanMutation.isPending ? "Validating…" : "Validate"}
                </button>
                <button
                  className="rounded border border-border px-4 py-1.5 text-sm text-[var(--text-2)]"
                  onClick={() => setCurrentPlan(null)}
                >
                  New plan
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <label className="space-y-1">
                  <span className="text-xs text-[var(--text-3)]">Symbol</span>
                  <input
                    className="w-full rounded border border-border bg-[var(--bg-1)] px-2 py-1.5 text-sm"
                    placeholder="AAPL"
                    value={planForm.symbol}
                    onChange={(e) => setPlanForm((f) => ({ ...f, symbol: e.target.value.toUpperCase() }))}
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-[var(--text-3)]">ConID</span>
                  <input
                    type="number"
                    className="w-full rounded border border-border bg-[var(--bg-1)] px-2 py-1.5 font-mono text-sm"
                    value={planForm.conid || ""}
                    onChange={(e) => setPlanForm((f) => ({ ...f, conid: Number(e.target.value) }))}
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-[var(--text-3)]">Side</span>
                  <select
                    className="w-full rounded border border-border bg-[var(--bg-1)] px-2 py-1.5 text-sm"
                    value={planForm.side}
                    onChange={(e) => setPlanForm((f) => ({ ...f, side: e.target.value as ExecutionPlanSide }))}
                  >
                    <option value="BUY">BUY</option>
                    <option value="SELL">SELL</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-[var(--text-3)]">Quantity</span>
                  <input
                    type="number"
                    className="w-full rounded border border-border bg-[var(--bg-1)] px-2 py-1.5 font-mono text-sm"
                    value={planForm.quantity}
                    onChange={(e) => setPlanForm((f) => ({ ...f, quantity: Number(e.target.value) }))}
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-[var(--text-3)]">Order type</span>
                  <select
                    className="w-full rounded border border-border bg-[var(--bg-1)] px-2 py-1.5 text-sm"
                    value={planForm.order_type}
                    onChange={(e) => setPlanForm((f) => ({ ...f, order_type: e.target.value as ExecutionPlanOrderType, limit_price: null }))}
                  >
                    <option value="LMT">LMT</option>
                    <option value="MKT">MKT</option>
                  </select>
                </label>
                {planForm.order_type === "LMT" && (
                  <label className="space-y-1">
                    <span className="text-xs text-[var(--text-3)]">Limit price</span>
                    <input
                      type="number"
                      step="0.01"
                      className="w-full rounded border border-border bg-[var(--bg-1)] px-2 py-1.5 font-mono text-sm"
                      value={planForm.limit_price ?? ""}
                      onChange={(e) => setPlanForm((f) => ({ ...f, limit_price: Number(e.target.value) || null }))}
                    />
                  </label>
                )}
              </div>
              <button
                className="rounded bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                disabled={createPlanMutation.isPending || !planForm.conid || !planForm.symbol}
                onClick={() => createPlanMutation.mutate(planForm)}
              >
                {createPlanMutation.isPending ? "Saving…" : "Save Draft (session only)"}
              </button>
            </div>
          )}
        </section>

        {/* Reconciliation summary (always visible) */}
        <section className="space-y-4 rounded-xl border border-border bg-[var(--bg-2)] p-5">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
            Reconciliation
          </h2>
          <dl className="grid grid-cols-2 gap-y-3 text-sm">
            <dt className="text-[var(--text-2)]">Positions</dt>
            <dd>{status?.reconciliation_summary.position_count ?? 0}</dd>
            <dt className="text-[var(--text-2)]">Open orders</dt>
            <dd>{status?.reconciliation_summary.open_order_count ?? 0}</dd>
            <dt className="text-[var(--text-2)]">Unmanaged orders</dt>
            <dd className={status?.reconciliation_summary.unmanaged_order_count ? "text-amber-400" : ""}>
              {status?.reconciliation_summary.unmanaged_order_count ?? 0}
            </dd>
          </dl>
        </section>
      </div>
    </div>
  );
}
