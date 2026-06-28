import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LockKeyhole, MoreVertical, Power, Search } from "lucide-react";
import { BackToOrbitButton } from "@/components/ui/BackToOrbitButton";
import { BROKER_SESSION_KEY } from "@/context/BrokerSessionContext";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/sidecarClient";
import { twsApi, TWS_CONNECT_DEFAULTS, type ExecutionPlan, type ExecutionPlanDraftRequest, type ExecutionPlanOrderType, type ExecutionPlanSide, type InstrumentResult, type MarketDataType, type OrderSnapshot, type PaperOrderPreview, type PaperOrderSubmission, type QuoteSnapshot, type TwsAdapterState, type TwsConnectRequest } from "./api";

const STATUS_KEY = ["tws-status"];
const RECON_KEY = ["tws-reconciliation"];

const INACTIVE_STATES: TwsAdapterState[] = ["not_initialized", "disconnected", "error"];

const PLAN_DEFAULTS: ExecutionPlanDraftRequest = {
  conid: 0,
  symbol: "",
  side: "BUY",
  quantity: 1,
  order_type: "LMT",
  limit_price: null,
};

function adapterStateLabel(state: TwsAdapterState): string {
  return state.replace(/_/g, " ");
}

function marketDataStatus(quote: QuoteSnapshot | undefined): {
  value: string;
  tone?: "warning" | "success";
} {
  if (!quote || quote.market_data_type === "unknown") return { value: "-" };
  if (quote.market_data_type === "live") return { value: "Live", tone: "success" };
  if (quote.market_data_type === "delayed_frozen") return { value: "Delayed frozen", tone: "warning" };
  if (quote.market_data_type === "delayed") return { value: "Delayed", tone: "warning" };
  if (quote.market_data_type === "frozen") return { value: "Frozen", tone: "warning" };
  if (quote.market_data_type === "unavailable") {
    return { value: quote.error_code === 10089 ? "Subscription required" : "Unavailable", tone: "warning" };
  }
  return { value: "-" };
}

const MDT_LABEL: Record<MarketDataType, string | null> = {
  live: "Live",
  frozen: "Frozen",
  delayed: "Delayed",
  delayed_frozen: "Delayed frozen",
  unknown: null,
  unavailable: null,
};

// amber for delayed/stale data, green for live
function mdtColor(mdt: MarketDataType): string {
  if (mdt === "live") return "text-[var(--clr-green)]";
  if (mdt === "frozen" || mdt === "delayed" || mdt === "delayed_frozen") return "text-[var(--clr-amber,#d97706)]";
  return "text-[var(--text-3)]";
}

function quoteGuidance(quote: QuoteSnapshot): { headline: string; body: string } | null {
  if (quote.market_data_type === "unavailable") {
    if (quote.error_code === 10089) {
      return {
        headline: "Market data subscription required",
        body: "Your API subscription may not cover this symbol. Even if data is visible in TWS, the API requires a separate \"Market Data API\" acknowledgement in IBKR Account Management. Delayed data may be available as a fallback — you can still enter a limit price manually.",
      };
    }
    return {
      headline: "Market data unavailable",
      body: "No data was returned. If you have a market data subscription, try re-requesting a quote. You can enter a limit price manually.",
    };
  }
  if (quote.market_data_type === "delayed" || quote.market_data_type === "delayed_frozen") {
    return {
      headline: "Delayed data",
      body: "Quotes may lag the market. Confirm the current price before entering a limit. Live data requires an IBKR API market data subscription for this symbol.",
    };
  }
  if (quote.market_data_type === "frozen") {
    return {
      headline: "Frozen data",
      body: "Last available bid/ask from when the market last closed. Live quotes will return when the market opens.",
    };
  }
  return null;
}

/** Extract the typed `error` key from a place-paper ApiError response body. */
function submitErrorCode(err: unknown): string | null {
  if (err instanceof ApiError) {
    const d = err.body.detail;
    if (d && typeof d === "object" && !Array.isArray(d)) {
      const code = (d as Record<string, unknown>).error;
      if (typeof code === "string") return code;
    }
  }
  return null;
}

const SUBMIT_ERROR_MESSAGES: Record<string, string> = {
  kill_switch_active: "Kill switch is active — deactivate it before placing orders.",
  not_connected: "Lost connection to TWS — reconnect and try again.",
  not_paper_port: "Not a paper port — only ports 4002 (IB Gateway) or 7497 (TWS) are allowed.",
  plan_not_valid: "Plan is no longer valid — re-validate before retrying.",
  invalid_plan: "Plan is no longer valid — re-validate before retrying.",
};

function QuoteStrip({ quote }: { quote: QuoteSnapshot }) {
  const hasData =
    quote.bid != null || quote.ask != null || quote.last != null ||
    quote.open != null || quote.high != null || quote.low != null || quote.close != null;

  const mdtLabel = MDT_LABEL[quote.market_data_type];
  const guidance = quoteGuidance(quote);

  return (
    <div className="flex flex-col gap-1.5">
      <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 rounded border bg-[var(--bg-1)] px-2.5 py-1.5 text-[11px] ${hasData ? "border-border/60" : "border-border/40"}`}>
        {hasData ? (
          <>
            {quote.bid != null && (
              <span><span className="text-[var(--text-3)]">Bid </span><span className="font-data text-[var(--text-1)]">{quote.bid.toFixed(2)}</span></span>
            )}
            {quote.ask != null && (
              <span><span className="text-[var(--text-3)]">Ask </span><span className="font-data text-[var(--text-1)]">{quote.ask.toFixed(2)}</span></span>
            )}
            {quote.last != null && (
              <span><span className="text-[var(--text-3)]">Last </span><span className="font-data text-[var(--text-1)]">{quote.last.toFixed(2)}</span></span>
            )}
            {quote.close != null && (
              <span><span className="text-[var(--text-3)]">Close </span><span className="font-data text-[var(--text-2)]">{quote.close.toFixed(2)}</span></span>
            )}
            {quote.open != null && (
              <span><span className="text-[var(--text-3)]">Open </span><span className="font-data text-[var(--text-2)]">{quote.open.toFixed(2)}</span></span>
            )}
            {quote.high != null && (
              <span><span className="text-[var(--text-3)]">High </span><span className="font-data text-[var(--text-2)]">{quote.high.toFixed(2)}</span></span>
            )}
            {quote.low != null && (
              <span><span className="text-[var(--text-3)]">Low </span><span className="font-data text-[var(--text-2)]">{quote.low.toFixed(2)}</span></span>
            )}
            {mdtLabel != null && (
              <span className={`ml-auto shrink-0 ${mdtColor(quote.market_data_type)}`}>{mdtLabel}</span>
            )}
          </>
        ) : (
          <span className="text-[var(--text-3)]">{quote.unavailable_reason ?? "Market data unavailable."}</span>
        )}
      </div>
      {guidance != null && (
        <div className="rounded border border-border/40 bg-[var(--bg-1)] px-2.5 py-2 text-[11px] leading-[1.5]">
          <span className="font-medium text-[var(--text-2)]">{guidance.headline} — </span>
          <span className="text-[var(--text-3)]">{guidance.body}</span>
        </div>
      )}
    </div>
  );
}

function ConnectionBadge({ connected }: { connected: boolean }) {
  return (
    <span className={connected ? "text-[var(--clr-green)]" : "text-[var(--clr-orange)]"}>
      {connected ? "Connected" : "Not connected"}
    </span>
  );
}

function Panel({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("min-w-0 rounded-md border border-border bg-[var(--bg-2)] shadow-[0_18px_44px_rgba(0,0,0,0.18)]", className)}>
      <div className="border-b border-border px-3 py-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--clr-cyan)]">
          {title}
        </h2>
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

function StatRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: ReactNode;
  tone?: "warning" | "danger" | "success";
}) {
  return (
    <div className="flex items-center justify-between gap-4 text-[12px]">
      <span className="text-[var(--text-2)]">{label}</span>
      <span
        className={cn(
          "font-data text-[var(--text-1)]",
          tone === "warning" && "text-[var(--clr-orange)]",
          tone === "danger" && "text-[var(--clr-red)]",
          tone === "success" && "text-[var(--clr-green)]",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function GateStrip({ connected, reconciled }: { connected: boolean; reconciled: boolean }) {
  const steps = [
    {
      number: "1",
      label: "Connect",
      status: connected ? "Connected" : "Not connected",
      active: !connected,
      done: connected,
      locked: false,
    },
    {
      number: "2",
      label: "Reconcile",
      status: connected ? (reconciled ? "Ready" : "Loading") : "Locked",
      active: connected && !reconciled,
      done: reconciled,
      locked: !connected,
    },
    {
      number: "3",
      label: "Draft plan",
      status: reconciled ? "Ready" : "Locked",
      active: false,
      done: false,
      locked: !reconciled,
    },
  ];

  return (
    <div className="grid overflow-hidden rounded-md border border-border bg-[var(--bg-2)] md:grid-cols-3">
      {steps.map((step, index) => (
        <div
          key={step.number}
          className={cn(
            "relative flex min-h-11 items-center gap-2 border-border px-3 py-2",
            index > 0 && "border-t md:border-l md:border-t-0",
            step.active && "after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-full after:bg-[var(--clr-cyan)]",
          )}
        >
          <span
            className={cn(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-data text-[11px]",
              step.done
                ? "border-[var(--clr-green)] text-[var(--clr-green)]"
                : step.locked
                  ? "border-border text-[var(--text-3)]"
                  : "border-[var(--clr-cyan)] text-[var(--clr-cyan)]",
            )}
          >
            {step.locked ? <LockKeyhole className="h-3 w-3" strokeWidth={1.7} /> : step.number}
          </span>
          <div>
            <div className="text-[12px] font-semibold text-[var(--text-1)]">{step.label}</div>
            <div
              className={cn(
                "text-[10px] font-medium",
                step.done ? "text-[var(--clr-green)]" : step.locked ? "text-[var(--text-3)]" : "text-[var(--clr-orange)]",
              )}
            >
              {step.status}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function PlanStatusBadge({ status }: { status: ExecutionPlan["status"] }) {
  const styles = {
    draft: "bg-[var(--bg-1)] text-[var(--text-3)]",
    valid: "bg-[var(--glow-green)] text-[var(--clr-green)]",
    invalid: "bg-[var(--glow-red)] text-[var(--clr-red)]",
  };
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-semibold uppercase ${styles[status]}`}>
      {status}
    </span>
  );
}

function EmptyTableState({ label }: { label: string }) {
  return (
    <div className="flex min-h-16 items-center justify-center rounded border border-dashed border-border/80 bg-[var(--bg-1)]/40 text-center">
      <div>
        <div className="text-[12px] font-semibold text-[var(--text-1)]">{label}</div>
        <p className="mt-1 text-[11px] text-[var(--text-3)]">
          Connect and reconcile to view {label.toLowerCase()}.
        </p>
      </div>
    </div>
  );
}

function UnmanagedBadge() {
  return (
    <span className="rounded bg-[var(--glow-orange)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--clr-orange)]">
      unmanaged
    </span>
  );
}

function OrderRow({ order }: { order: OrderSnapshot }) {
  return (
    <tr className="border-t border-border text-xs">
      <td className="py-1.5 pr-4 font-medium">{order.symbol}</td>
      <td className={`pr-4 ${order.side === "BUY" ? "text-[var(--clr-green)]" : "text-[var(--clr-red)]"}`}>
        {order.side}
      </td>
      <td className="pr-4 font-data">{order.quantity}</td>
      <td className="pr-4 font-data text-[var(--text-2)]">{order.order_type}</td>
      <td className="pr-4 font-data text-[var(--text-2)]">
        {order.lmt_price != null ? order.lmt_price.toFixed(2) : "-"}
      </td>
      <td className="pr-4 text-[var(--text-2)]">{order.status}</td>
      <td>{order.is_unmanaged && <UnmanagedBadge />}</td>
    </tr>
  );
}

export function TwsExecutionAssistantModule() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<TwsConnectRequest>(TWS_CONNECT_DEFAULTS);
  const [planForm, setPlanForm] = useState<ExecutionPlanDraftRequest>(PLAN_DEFAULTS);
  const [currentPlan, setCurrentPlan] = useState<ExecutionPlan | null>(null);
  const [paperPreview, setPaperPreview] = useState<PaperOrderPreview | null>(null);
  const [paperSubmission, setPaperSubmission] = useState<PaperOrderSubmission | null>(null);
  const [searchResults, setSearchResults] = useState<InstrumentResult[]>([]);

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
      queryClient.invalidateQueries({ queryKey: BROKER_SESSION_KEY });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: twsApi.disconnect,
    onSuccess: (result) => {
      queryClient.setQueryData(STATUS_KEY, result);
      queryClient.setQueryData(RECON_KEY, undefined);
      queryClient.invalidateQueries({ queryKey: BROKER_SESSION_KEY });
    },
  });

  const createPlanMutation = useMutation({
    mutationFn: twsApi.createPlanDraft,
    onSuccess: (plan) => {
      setCurrentPlan(plan);
      setPaperPreview(null);
      setPaperSubmission(null);
      setPlanForm(PLAN_DEFAULTS);
    },
  });

  const validatePlanMutation = useMutation({
    mutationFn: (plan_id: string) => twsApi.validatePlan(plan_id),
    onSuccess: (plan) => {
      setCurrentPlan(plan);
      setPaperPreview(null);
    },
  });

  const previewPaperMutation = useMutation({
    mutationFn: (plan_id: string) => twsApi.previewPaperOrder(plan_id),
    onSuccess: (preview) => {
      setPaperPreview(preview);
      setPaperSubmission(null);
    },
  });

  const placePaperMutation = useMutation({
    mutationFn: (plan_id: string) => twsApi.placePaperOrder(plan_id),
    onSuccess: (submission) => {
      setPaperSubmission(submission);
      queryClient.invalidateQueries({ queryKey: RECON_KEY });
      queryClient.invalidateQueries({ queryKey: STATUS_KEY });
    },
    onError: (err) => {
      // unknown_outcome means the order may have reached TWS — refresh immediately
      // so Open Orders reflects any change before the user decides to retry.
      if (submitErrorCode(err) === "unknown_outcome") {
        queryClient.invalidateQueries({ queryKey: RECON_KEY });
        queryClient.invalidateQueries({ queryKey: STATUS_KEY });
      }
    },
  });

  const searchMutation = useMutation({
    mutationFn: (symbol: string) => twsApi.searchInstruments(symbol),
    onSuccess: (results) => {
      setSearchResults(results);
      const stk = results.filter(
        (r) => r.sec_type === "STK" && r.exchange === "SMART" && r.currency === "USD",
      );
      if (stk.length === 1) {
        setPlanForm((f) => ({ ...f, conid: stk[0].conid }));
        setSearchResults([]);
      }
    },
  });

  const { data: quote, isLoading: quoteLoading } = useQuery({
    queryKey: ["tws-quote", planForm.conid],
    queryFn: () => twsApi.getQuote(planForm.conid),
    enabled: status?.connected === true && planForm.conid > 0,
    staleTime: 15000,
    refetchInterval: 30000,
  });

  function handleSymbolChange(value: string) {
    setPlanForm((f) => ({ ...f, symbol: value.toUpperCase(), conid: 0 }));
    setSearchResults([]);
  }

  function runSearch() {
    if (planForm.symbol && status?.connected) searchMutation.mutate(planForm.symbol);
  }

  function saveDraftDisabledReason(): string | null {
    if (!planForm.symbol) return "Enter a symbol.";
    if (!planForm.conid) return "Resolve symbol to get ConID.";
    if (planForm.quantity <= 0) return "Quantity must be positive.";
    if (planForm.order_type === "LMT" && !(planForm.limit_price && planForm.limit_price > 0))
      return "Enter a limit price.";
    return null;
  }

  const adapterState = status?.adapter_state ?? "not_initialized";
  const showForm = INACTIVE_STATES.includes(adapterState);
  const connected = status?.connected === true;
  const reconciled = connected && recon != null;
  const canDraft = reconciled;
  const isPending =
    adapterState === "connecting" ||
    connectMutation.isPending ||
    disconnectMutation.isPending;
  const summary = recon ?? status?.reconciliation_summary;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[var(--bg-1)] text-foreground">
      <header className="m-2 mb-1.5 flex min-h-10 items-center gap-3 rounded-md border border-border bg-[var(--bg-2)] px-3">
        <BackToOrbitButton />
        <div className="h-5 w-px bg-border" />
        <p className="hidden text-[9px] font-medium uppercase tracking-[0.26em] text-[var(--text-3)] sm:block">
          Orbit Module
        </p>
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-[15px] font-semibold">TWS Execution Assistant</h1>
          <span className="rounded bg-[var(--glow-cyan)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--clr-cyan)]">
            Broker cockpit
          </span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden items-center gap-1.5 text-[11px] font-semibold sm:flex">
            <span className="h-1.5 w-1.5 rounded-full border border-[var(--clr-orange)]" />
            <ConnectionBadge connected={connected} />
          </span>
          {!connected && (
            <button
              type="button"
              className="h-7 rounded-md border border-[var(--clr-cyan)] px-3 text-[11px] font-semibold text-[var(--clr-cyan)] transition-colors hover:bg-[var(--clr-cyan)]/10 active:scale-[0.96] disabled:opacity-50"
              disabled={isPending}
              onClick={() => connectMutation.mutate(form)}
            >
              {isPending ? "Connecting..." : "Connect TWS / IB Gateway"}
            </button>
          )}
          <MoreVertical className="h-4 w-4 text-[var(--text-3)]" strokeWidth={1.7} />
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        <GateStrip connected={connected} reconciled={reconciled} />

        <div className="grid items-start gap-2 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="grid min-w-0 auto-rows-max content-start gap-2">
            <Panel title="Connection">
              {isLoading ? (
                <p className="text-sm text-[var(--text-3)]">Loading...</p>
              ) : showForm ? (
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
                  <div className="space-y-3">
                    {adapterState === "error" && (
                      <p className="text-xs text-[var(--clr-red)]">
                        Connection failed. Check that TWS or IB Gateway is running on the host and port below.
                      </p>
                    )}
                    <div className="grid gap-2 md:grid-cols-3">
                      <label className="space-y-1">
                        <span className="text-[11px] text-[var(--text-2)]">Host</span>
                        <input
                          className="h-8 w-full rounded border border-border bg-[var(--bg-1)] px-2.5 font-data text-[12px] outline-none transition-colors focus:border-[var(--clr-cyan)]"
                          value={form.host}
                          onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[11px] text-[var(--text-2)]">Port</span>
                        <input
                          type="number"
                          className="h-8 w-full rounded border border-border bg-[var(--bg-1)] px-2.5 font-data text-[12px] outline-none transition-colors focus:border-[var(--clr-cyan)]"
                          value={form.port}
                          onChange={(e) => setForm((f) => ({ ...f, port: Number(e.target.value) }))}
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[11px] text-[var(--text-2)]">Client ID</span>
                        <input
                          type="number"
                          className="h-8 w-full rounded border border-border bg-[var(--bg-1)] px-2.5 font-data text-[12px] outline-none transition-colors focus:border-[var(--clr-cyan)]"
                          value={form.client_id}
                          onChange={(e) => setForm((f) => ({ ...f, client_id: Number(e.target.value) }))}
                        />
                      </label>
                    </div>
                    <button
                      className="h-8 rounded-md border border-[var(--clr-cyan)] px-3 text-[12px] font-semibold text-[var(--clr-cyan)] transition-colors hover:bg-[var(--clr-cyan)]/10 active:scale-[0.96] disabled:opacity-50"
                      disabled={isPending}
                      onClick={() => connectMutation.mutate(form)}
                    >
                      {isPending ? "Connecting..." : "Connect TWS / IB Gateway"}
                    </button>
                  </div>
                  <div className="space-y-2 border-border lg:border-l lg:pl-4">
                    <div className="flex items-center gap-2 text-[12px] font-semibold text-[var(--clr-orange)]">
                      <span className="h-2.5 w-2.5 rounded-full border border-current" />
                      <ConnectionBadge connected={false} />
                    </div>
                    <StatRow label="TWS / IB Gateway" value="-" />
                    <StatRow label="API" value={status?.api_server_available ? "Reachable" : "-"} tone={status?.api_server_available ? "success" : undefined} />
                  </div>
                </div>
              ) : (
                <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_160px]">
                  <dl className="grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
                    <StatRow label="Status" value={<ConnectionBadge connected={connected} />} tone={connected ? "success" : "warning"} />
                    <StatRow label="Adapter state" value={adapterStateLabel(adapterState)} />
                    <StatRow label="Kill switch" value={status?.kill_switch_active ? "Active" : "Inactive"} tone={status?.kill_switch_active ? "danger" : undefined} />
                    <StatRow label="Broker mode" value={status?.mode ?? "-"} />
                  </dl>
                  <button
                    className="h-8 rounded-md border border-border px-3 text-[12px] text-[var(--text-2)] transition-colors hover:bg-[var(--bg-3)] hover:text-[var(--text-1)] active:scale-[0.96] disabled:opacity-50"
                    disabled={isPending}
                    onClick={() => disconnectMutation.mutate()}
                  >
                    {isPending ? "Disconnecting..." : "Disconnect"}
                  </button>
                </div>
              )}
            </Panel>

            <Panel title="Execution Plan">
              {currentPlan ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="text-xs font-medium">{currentPlan.symbol}</span>
                    <span className={`text-xs font-medium ${currentPlan.side === "BUY" ? "text-[var(--clr-green)]" : "text-[var(--clr-red)]"}`}>
                      {currentPlan.side}
                    </span>
                    <span className="font-data text-xs">{currentPlan.quantity}</span>
                    <span className="font-data text-xs text-[var(--text-2)]">{currentPlan.order_type}</span>
                    {currentPlan.limit_price != null && (
                      <span className="font-data text-xs text-[var(--text-2)]">@ {currentPlan.limit_price}</span>
                    )}
                    <PlanStatusBadge status={currentPlan.status} />
                  </div>

                  {currentPlan.validation_errors.length > 0 && (
                    <ul className="space-y-1">
                      {currentPlan.validation_errors.map((e, i) => (
                        <li key={i} className="text-xs text-[var(--clr-red)]">- {e}</li>
                      ))}
                    </ul>
                  )}

                  <div className="flex gap-2">
                    <button
                      className="h-8 rounded-md bg-[var(--clr-cyan)] px-3 text-xs font-semibold text-[var(--bg-0)] disabled:opacity-50"
                      disabled={validatePlanMutation.isPending}
                      onClick={() => validatePlanMutation.mutate(currentPlan.plan_id)}
                    >
                      {validatePlanMutation.isPending ? "Validating..." : "Validate"}
                    </button>
                    {currentPlan.status === "valid" && (
                      <button
                        className="h-8 rounded-md border border-[var(--clr-cyan)] px-3 text-xs font-semibold text-[var(--clr-cyan)] transition-colors hover:bg-[var(--clr-cyan)]/10 active:scale-[0.96] disabled:opacity-50"
                        disabled={previewPaperMutation.isPending}
                        onClick={() => previewPaperMutation.mutate(currentPlan.plan_id)}
                      >
                        {previewPaperMutation.isPending ? "Building preview..." : "Preview paper order"}
                      </button>
                    )}
                    <button
                      className="h-8 rounded-md border border-border px-3 text-xs text-[var(--text-2)]"
                      onClick={() => { setCurrentPlan(null); setPaperPreview(null); setPaperSubmission(null); }}
                    >
                      New plan
                    </button>
                  </div>

                  {previewPaperMutation.isError && (
                    <p className="text-xs text-[var(--clr-red)]">
                      Preview rejected — connected port may not be a paper port (4002 or 7497).
                    </p>
                  )}

                  {paperPreview != null && paperSubmission == null && (
                    <div className="rounded border border-[var(--clr-cyan)]/30 bg-[var(--bg-1)] p-3 space-y-3">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-[var(--glow-cyan)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--clr-cyan)]">
                          Paper preview
                        </span>
                        <span className="text-[10px] text-[var(--text-3)]">Review before submitting</span>
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] sm:grid-cols-3">
                        <StatRow label="Symbol" value={paperPreview.symbol} />
                        <StatRow label="ConID" value={paperPreview.conid} />
                        <StatRow label="Side" value={paperPreview.side} tone={paperPreview.side === "BUY" ? "success" : "danger"} />
                        <StatRow label="Quantity" value={paperPreview.quantity} />
                        <StatRow label="Order type" value={paperPreview.order_type} />
                        <StatRow label="Limit price" value={paperPreview.limit_price != null ? paperPreview.limit_price.toFixed(2) : "—"} />
                        <StatRow label="TIF" value={paperPreview.tif} />
                        <StatRow label="Paper only" value="Yes" tone="success" />
                      </div>
                      <div className="flex items-center gap-3 border-t border-border/40 pt-3">
                        <button
                          className="h-8 rounded-md bg-[var(--clr-green)] px-4 text-xs font-semibold text-[var(--bg-0)] transition-colors hover:opacity-90 active:scale-[0.96] disabled:opacity-50"
                          disabled={placePaperMutation.isPending}
                          onClick={() => placePaperMutation.mutate(paperPreview.plan_id)}
                        >
                          {placePaperMutation.isPending ? "Placing order..." : "Place paper order"}
                        </button>
                        <span className="text-[10px] text-[var(--text-3)]">
                          This will send the order to TWS paper account.
                        </span>
                      </div>
                      {placePaperMutation.isError && (() => {
                        const code = submitErrorCode(placePaperMutation.error);
                        if (code === "unknown_outcome") {
                          return (
                            <div className="rounded border border-[var(--clr-amber,#d97706)]/40 bg-[var(--bg-1)] p-2.5 space-y-1.5">
                              <p className="text-[11px] font-semibold text-[var(--clr-amber,#d97706)]">
                                Outcome unknown — do not retry yet.
                              </p>
                              <p className="text-[11px] text-[var(--text-2)]">
                                The order may have reached TWS. Check Open Orders below before retrying to avoid a duplicate position.
                              </p>
                              <button
                                className="h-7 rounded border border-border px-2.5 text-[11px] text-[var(--text-2)] hover:bg-[var(--bg-2)]"
                                onClick={() => queryClient.invalidateQueries({ queryKey: RECON_KEY })}
                              >
                                Refresh Open Orders
                              </button>
                            </div>
                          );
                        }
                        const msg = SUBMIT_ERROR_MESSAGES[code ?? ""] ??
                          "Order rejected — check that TWS is connected and on a paper port.";
                        return <p className="text-[11px] text-[var(--clr-red)]">{msg}</p>;
                      })()}
                    </div>
                  )}

                  {paperSubmission != null && (
                    <div className="rounded border border-[var(--clr-green)]/40 bg-[var(--bg-1)] p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-[var(--glow-green)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--clr-green)]">
                            Order submitted
                          </span>
                          <span className="text-[10px] text-[var(--text-3)]">
                            Broker order ID {paperSubmission.order_id} · status {paperSubmission.status}
                          </span>
                        </div>
                        <button
                          className="h-7 rounded border border-border px-2.5 text-[11px] text-[var(--text-2)] hover:bg-[var(--bg-2)]"
                          onClick={() => queryClient.invalidateQueries({ queryKey: RECON_KEY })}
                        >
                          Refresh Open Orders
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] sm:grid-cols-3">
                        <StatRow label="Symbol" value={paperSubmission.symbol} />
                        <StatRow label="Side" value={paperSubmission.side} tone={paperSubmission.side === "BUY" ? "success" : "danger"} />
                        <StatRow label="Quantity" value={paperSubmission.quantity} />
                        <StatRow label="Order type" value={paperSubmission.order_type} />
                        {paperSubmission.limit_price != null && (
                          <StatRow label="Limit price" value={paperSubmission.limit_price.toFixed(2)} />
                        )}
                        <StatRow label="TWS status" value={paperSubmission.status} tone="success" />
                      </div>
                      <p className="text-[10px] text-[var(--text-3)]">
                        Open Orders refreshes automatically. Use "Refresh Open Orders" to poll for fill status.
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="relative min-h-40">
                  <div className={cn("space-y-3", !canDraft && "opacity-45")}>
                    <div className="grid gap-2 md:grid-cols-3">
                      <label className="space-y-1">
                        <span className="text-[11px] text-[var(--text-2)]">Symbol</span>
                        <div className="relative">
                          <input
                            className="h-8 w-full rounded border border-border bg-[var(--bg-1)] px-2.5 pr-8 text-[12px] outline-none transition-colors focus:border-[var(--clr-cyan)] disabled:cursor-not-allowed"
                            placeholder="e.g. NVDA"
                            value={planForm.symbol}
                            disabled={!canDraft}
                            onChange={(e) => handleSymbolChange(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && runSearch()}
                          />
                          <button
                            type="button"
                            className="absolute right-2 top-2 text-[var(--text-3)] hover:text-[var(--clr-cyan)] disabled:cursor-not-allowed"
                            disabled={!canDraft || !planForm.symbol || searchMutation.isPending}
                            onClick={runSearch}
                            tabIndex={-1}
                          >
                            <Search className="h-4 w-4" strokeWidth={1.7} />
                          </button>
                        </div>
                        {searchResults.length > 1 && (
                          <ul className="mt-0.5 rounded border border-border bg-[var(--bg-1)] shadow-md">
                            {searchResults.map((r) => (
                              <li key={r.conid}>
                                <button
                                  type="button"
                                  className="flex w-full items-center justify-between px-2.5 py-1.5 text-left text-[11px] hover:bg-[var(--bg-2)]"
                                  onClick={() => {
                                    setPlanForm((f) => ({ ...f, conid: r.conid }));
                                    setSearchResults([]);
                                  }}
                                >
                                  <span className="font-medium">{r.symbol}</span>
                                  <span className="text-[var(--text-3)]">
                                    {r.sec_type} · {r.primary_exchange || r.exchange} · {r.currency}
                                  </span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </label>
                      <label className="space-y-1">
                        <span className="text-[11px] text-[var(--text-2)]">ConID</span>
                        <input
                          type="number"
                          className="h-8 w-full rounded border border-border bg-[var(--bg-1)] px-2.5 font-data text-[12px] outline-none transition-colors focus:border-[var(--clr-cyan)] disabled:cursor-not-allowed"
                          placeholder="Search symbol to resolve"
                          value={planForm.conid || ""}
                          disabled={!canDraft}
                          onChange={(e) => setPlanForm((f) => ({ ...f, conid: Number(e.target.value) }))}
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[11px] text-[var(--text-2)]">Side</span>
                        <select
                          className="h-8 w-full rounded border border-border bg-[var(--bg-1)] px-2.5 text-[12px] outline-none transition-colors focus:border-[var(--clr-cyan)] disabled:cursor-not-allowed"
                          value={planForm.side}
                          disabled={!canDraft}
                          onChange={(e) => setPlanForm((f) => ({ ...f, side: e.target.value as ExecutionPlanSide }))}
                        >
                          <option value="BUY">BUY</option>
                          <option value="SELL">SELL</option>
                        </select>
                      </label>
                      <label className="space-y-1">
                        <span className="text-[11px] text-[var(--text-2)]">Quantity</span>
                        <input
                          type="number"
                          className="h-8 w-full rounded border border-border bg-[var(--bg-1)] px-2.5 font-data text-[12px] outline-none transition-colors focus:border-[var(--clr-cyan)] disabled:cursor-not-allowed"
                          value={planForm.quantity}
                          disabled={!canDraft}
                          onChange={(e) => setPlanForm((f) => ({ ...f, quantity: Number(e.target.value) }))}
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[11px] text-[var(--text-2)]">Order type</span>
                        <select
                          className="h-8 w-full rounded border border-border bg-[var(--bg-1)] px-2.5 text-[12px] outline-none transition-colors focus:border-[var(--clr-cyan)] disabled:cursor-not-allowed"
                          value={planForm.order_type}
                          disabled={!canDraft}
                          onChange={(e) => setPlanForm((f) => ({ ...f, order_type: e.target.value as ExecutionPlanOrderType, limit_price: null }))}
                        >
                          <option value="LMT">LMT</option>
                          <option value="MKT">MKT</option>
                        </select>
                      </label>
                      {planForm.order_type === "LMT" && (
                        <label className="space-y-1">
                          <span className="text-[11px] text-[var(--text-2)]">Limit price</span>
                          <input
                            type="number"
                            step="0.01"
                            className="h-8 w-full rounded border border-border bg-[var(--bg-1)] px-2.5 font-data text-[12px] outline-none transition-colors focus:border-[var(--clr-cyan)] disabled:cursor-not-allowed"
                            placeholder="0.00"
                            value={planForm.limit_price ?? ""}
                            disabled={!canDraft}
                            onChange={(e) => setPlanForm((f) => ({ ...f, limit_price: Number(e.target.value) || null }))}
                          />
                        </label>
                      )}
                    </div>
                    {planForm.conid > 0 && (
                      quoteLoading
                        ? <div className="rounded border border-border/60 bg-[var(--bg-1)] px-2.5 py-1.5 text-[11px] text-[var(--text-3)] animate-pulse">Fetching market data…</div>
                        : quote !== undefined
                          ? <QuoteStrip quote={quote} />
                          : null
                    )}
                    {(() => {
                      const reason = saveDraftDisabledReason();
                      return (
                        <div className="flex items-center gap-3">
                          <button
                            className="h-8 rounded-md border border-[var(--clr-cyan)] px-3 text-[12px] font-semibold text-[var(--clr-cyan)] transition-colors hover:bg-[var(--clr-cyan)]/10 active:scale-[0.96] disabled:opacity-50"
                            disabled={!canDraft || createPlanMutation.isPending || reason != null}
                            onClick={() => createPlanMutation.mutate(planForm)}
                          >
                            {createPlanMutation.isPending ? "Saving..." : "Save draft"}
                          </button>
                          {canDraft && reason != null && (
                            <span className="text-[11px] text-[var(--text-3)]">{reason}</span>
                          )}
                        </div>
                      );
                    })()}
                  </div>

                  {!canDraft && (
                    <div className="absolute inset-x-0 bottom-2 flex items-center justify-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--clr-orange)]/40 bg-[var(--glow-orange)] text-[var(--clr-orange)]">
                        <LockKeyhole className="h-5 w-5" strokeWidth={1.6} />
                      </div>
                      <div>
                        <div className="text-[14px] font-semibold text-[var(--clr-orange)]">
                          Connect and reconcile before drafting
                        </div>
                        <p className="mt-0.5 max-w-md text-[11px] leading-4 text-[var(--text-2)]">
                          You must connect to TWS / IB Gateway and load reconciliation before creating or reviewing a plan.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </Panel>
            <div className="grid gap-2 md:grid-cols-2">
              <Panel title="Positions">
                {recon && recon.positions.length > 0 ? (
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="text-xs text-[var(--text-3)]">
                        <th className="pb-1.5 pr-4 font-medium">Symbol</th>
                        <th className="pb-1.5 pr-4 font-medium">ConID</th>
                        <th className="pb-1.5 pr-4 font-medium">Position</th>
                        <th className="pb-1.5 font-medium">Avg Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recon.positions.map((p) => (
                        <tr key={p.conid} className="border-t border-border">
                          <td className="py-1.5 pr-4 font-medium">{p.symbol}</td>
                          <td className="pr-4 font-data text-[var(--text-2)]">{p.conid}</td>
                          <td className={`pr-4 font-data ${p.position < 0 ? "text-[var(--clr-red)]" : ""}`}>
                            {p.position}
                          </td>
                          <td className="font-data text-[var(--text-2)]">{p.avg_cost.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <EmptyTableState label="No positions" />
                )}
              </Panel>

              <Panel title="Open Orders">
                {recon && recon.open_orders.length > 0 ? (
                  <>
                    {recon.unmanaged_order_count > 0 && (
                      <p className="mb-2 text-xs text-[var(--clr-orange)]">
                        {recon.unmanaged_order_count} unmanaged
                      </p>
                    )}
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="text-xs text-[var(--text-3)]">
                          <th className="pb-1.5 pr-4 font-medium">Symbol</th>
                          <th className="pb-1.5 pr-4 font-medium">Side</th>
                          <th className="pb-1.5 pr-4 font-medium">Qty</th>
                          <th className="pb-1.5 pr-4 font-medium">Type</th>
                          <th className="pb-1.5 pr-4 font-medium">Price</th>
                          <th className="pb-1.5 pr-4 font-medium">Status</th>
                          <th className="pb-1.5 font-medium" />
                        </tr>
                      </thead>
                      <tbody>
                        {recon.open_orders.map((o) => <OrderRow key={o.order_id} order={o} />)}
                      </tbody>
                    </table>
                  </>
                ) : (
                  <EmptyTableState label="No open orders" />
                )}
              </Panel>
            </div>
          </div>

          <aside className="grid content-start gap-2">
            <Panel title="Reconciliation">
              <div className="space-y-2">
                <StatRow label="Positions" value={summary?.position_count ?? 0} />
                <StatRow label="Open orders" value={summary?.open_order_count ?? 0} />
                <StatRow
                  label="Unmanaged"
                  value={summary?.unmanaged_order_count ?? 0}
                  tone={summary?.unmanaged_order_count ? "warning" : undefined}
                />
              </div>
            </Panel>

            <Panel title="Session Health">
              <div className="space-y-2">
                <StatRow label="Adapter" value={adapterStateLabel(adapterState)} tone={connected ? "success" : "warning"} />
                <StatRow label="Heartbeat" value="-" />
                <StatRow label="Last heartbeat" value="-" />
                <StatRow label="Account updates" value="-" />
                <StatRow label="Market data" value={marketDataStatus(quote).value} tone={marketDataStatus(quote).tone} />
              </div>
            </Panel>

            <Panel title="Kill Switch" className={status?.kill_switch_active ? "border-[var(--clr-red)]/40" : ""}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--clr-red)] text-[var(--clr-red)]">
                    <Power className="h-[18px] w-[18px]" strokeWidth={1.7} />
                  </span>
                  <div>
                    <div className="text-xs font-semibold">Kill switch</div>
                    <div className={status?.kill_switch_active ? "text-[11px] text-[var(--clr-red)]" : "text-[11px] text-[var(--text-2)]"}>
                      {status?.kill_switch_active ? "Active" : "Inactive"}
                    </div>
                  </div>
                </div>
                <span className="h-5 w-9 rounded-full border border-border bg-[var(--bg-1)] p-0.5">
                  <span className={cn("block h-4 w-4 rounded-full bg-[var(--text-3)] transition-transform", status?.kill_switch_active && "translate-x-4 bg-[var(--clr-red)]")} />
                </span>
              </div>
            </Panel>

            <Panel title="Mode Lock">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] text-[var(--text-2)]">No autonomous trading</span>
                <span className="rounded-full border border-[var(--clr-cyan)]/40 bg-[var(--glow-cyan)] px-2.5 py-0.5 text-[10px] font-semibold text-[var(--clr-cyan)]">
                  TWS only
                </span>
              </div>
            </Panel>
          </aside>
        </div>

      </main>
    </div>
  );
}
