import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, LockKeyhole, Power, Search } from "lucide-react";
import { BackToOrbitButton } from "@/components/ui/BackToOrbitButton";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { BROKER_SESSION_KEY } from "@/context/BrokerSessionContext";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/sidecarClient";
import { twsApi, TWS_CONNECT_DEFAULTS, TWS_TIMEFRAMES, type ExecutionPlan, type ExecutionPlanDraftRequest, type ExecutionPlanOrderType, type ExecutionPlanSide, type InstrumentResult, type OrderSnapshot, type PaperOrderPreview, type PaperOrderSubmission, type QuoteSnapshot, type TwsConnectRequest, type TwsTimeframe } from "./api";
import { TwsCandleChart } from "./TwsCandleChart";

const STATUS_KEY = ["tws-status"];
const RECON_KEY = ["tws-reconciliation"];

const PLAN_DEFAULTS: ExecutionPlanDraftRequest = {
  conid: 0,
  symbol: "",
  side: "BUY",
  quantity: 1,
  order_type: "LMT",
  limit_price: null,
};


/** IBKR returns -1 for fields that have no data (unset sentinel). */
function ibkrVal(v: number | null): number | null {
  return v == null || v < 0 ? null : v;
}

function QuoteStrip({ quote, exchange, loading }: { quote: QuoteSnapshot | null | undefined; exchange: string; loading?: boolean }) {
  const last  = quote ? ibkrVal(quote.last)  : null;
  const close = quote ? ibkrVal(quote.close) : null;
  const bid   = quote ? ibkrVal(quote.bid)   : null;
  const ask   = quote ? ibkrVal(quote.ask)   : null;
  const high  = quote ? ibkrVal(quote.high)  : null;
  const low   = quote ? ibkrVal(quote.low)   : null;

  const change    = last != null && close != null ? last - close : null;
  const changePct = change != null && close != null && close !== 0 ? (change / close) * 100 : null;

  const isDelayed = quote ? (quote.is_delayed || quote.market_data_type === "delayed" || quote.market_data_type === "delayed_frozen") : false;
  const isLive    = quote?.market_data_type === "live";

  // Skeleton: animated when loading, static dash when data simply isn't available
  const skel = loading
    ? <span className="inline-block h-[11px] w-10 animate-pulse rounded bg-[var(--bg-2)]" />
    : <span className="font-data text-[var(--text-3)]">—</span>;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-border/50 bg-[var(--bg-0)] px-3 py-1.5 text-[11px]">
      {/* Last — always visible */}
      <span className="flex items-baseline gap-1.5">
        <span className="text-[var(--text-3)]">Last</span>
        {last != null ? <span className="font-data font-semibold text-[var(--text-1)]">{last.toFixed(2)}</span> : skel}
        {loading
          ? <span className="inline-block h-[11px] w-16 animate-pulse rounded bg-[var(--bg-2)]" />
          : change != null && (
            <span className={cn("font-data text-[10px]", change >= 0 ? "text-[var(--clr-green)]" : "text-[var(--clr-red)]")}>
              {change >= 0 ? "+" : ""}{change.toFixed(2)}
              {changePct != null && ` (${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%)`}
            </span>
          )
        }
      </span>
      {/* Bid / Ask — only once data arrives (often -1 on delayed feeds) */}
      {!loading && bid != null && (
        <span className="flex items-baseline gap-1">
          <span className="text-[var(--text-3)]">Bid</span>
          <span className="font-data text-[var(--text-1)]">{bid.toFixed(2)}</span>
        </span>
      )}
      {!loading && ask != null && (
        <span className="flex items-baseline gap-1">
          <span className="text-[var(--text-3)]">Ask</span>
          <span className="font-data text-[var(--text-1)]">{ask.toFixed(2)}</span>
        </span>
      )}
      {/* Close — always visible */}
      <span className="flex items-baseline gap-1">
        <span className="text-[var(--text-3)]">Close</span>
        {close != null ? <span className="font-data text-[var(--text-2)]">{close.toFixed(2)}</span> : skel}
      </span>
      {/* High — always visible */}
      <span className="flex items-baseline gap-1">
        <span className="text-[var(--text-3)]">High</span>
        {high != null ? <span className="font-data text-[var(--text-2)]">{high.toFixed(2)}</span> : skel}
      </span>
      {/* Low — always visible */}
      <span className="flex items-baseline gap-1">
        <span className="text-[var(--text-3)]">Low</span>
        {low != null ? <span className="font-data text-[var(--text-2)]">{low.toFixed(2)}</span> : skel}
      </span>
      {/* Exchange + status — appear once data is ready */}
      {!loading && (
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {exchange && <span className="text-[var(--text-3)]">{exchange}</span>}
          {isDelayed && (
            <span className="rounded bg-[var(--glow-orange,rgba(251,146,60,0.12))] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--clr-orange,#fb923c)]">
              Delayed
            </span>
          )}
          {!isDelayed && isLive && (
            <span className="flex items-center gap-1 text-[10px] text-[var(--clr-green)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--clr-green)]" />
              Live
            </span>
          )}
        </span>
      )}
    </div>
  );
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
    <section className={cn("flex min-w-0 flex-col rounded-md border border-border bg-[var(--bg-1)] shadow-sm", className)}>
      <div className="shrink-0 border-b border-border px-3 py-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--clr-cyan)]">
          {title}
        </h2>
      </div>
      <div className="flex-1 min-h-0 p-3">{children}</div>
    </section>
  );
}

function EmptyTableState({ label }: { label: string }) {
  return (
    <div className="flex min-h-16 items-center justify-center rounded border border-dashed border-border/80 bg-[var(--bg-0)]/40 text-center">
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
  const [activeTimeframe, setActiveTimeframe] = useState<TwsTimeframe>("5m");
  const [selectedExchange, setSelectedExchange] = useState("");

  const { data: status } = useQuery({
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

  const reviewMutation = useMutation({
    mutationFn: async (req: ExecutionPlanDraftRequest) => {
      const plan = await twsApi.createPlanDraft(req);
      const validated = await twsApi.validatePlan(plan.plan_id);
      if (validated.status !== "valid") return { plan: validated, preview: null };
      const preview = await twsApi.previewPaperOrder(plan.plan_id);
      return { plan: validated, preview };
    },
    onSuccess: ({ plan, preview }) => {
      setCurrentPlan(plan);
      setPaperPreview(preview);
      setPaperSubmission(null);
      setSearchResults([]);
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
        setSelectedExchange(stk[0].primary_exchange);
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

  const { data: barsData, isLoading: barsLoading } = useQuery({
    queryKey: ["tws-bars", planForm.conid, activeTimeframe],
    queryFn: () => twsApi.getBars(planForm.conid, activeTimeframe),
    enabled: status?.connected === true && planForm.conid > 0,
    staleTime: 60_000,
  });

  function handleSymbolChange(value: string) {
    setPlanForm((f) => ({ ...f, symbol: value.toUpperCase(), conid: 0 }));
    setSearchResults([]);
    setSelectedExchange("");
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
  const connected = status?.connected === true;
  const reconciled = connected && recon != null;
  const canDraft = reconciled;
  const isPending =
    adapterState === "connecting" ||
    connectMutation.isPending ||
    disconnectMutation.isPending;
  const summary = recon ?? status?.reconciliation_summary;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[var(--bg-0)] text-foreground">
      <header className="m-2 mb-1.5 flex min-h-10 items-center gap-3 rounded-md border border-border bg-[var(--bg-1)] px-3">
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
          <ThemeToggle />
          {connected ? (
            <>
              <span className="hidden items-center gap-1.5 text-[11px] font-semibold text-[var(--clr-green)] sm:flex">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--clr-green)]" />
                Paper TWS connected
              </span>
              <button
                className="flex h-7 items-center gap-1.5 rounded-md border border-[var(--clr-orange)]/50 px-3 text-[11px] font-medium text-[var(--clr-orange)] transition-colors hover:bg-[var(--glow-orange)] hover:border-[var(--clr-orange)] active:scale-[0.96] disabled:opacity-50"
                disabled={isPending}
                onClick={() => disconnectMutation.mutate()}
              >
                <Power className="h-3.5 w-3.5" strokeWidth={1.7} />
                {isPending ? "Disconnecting..." : "Disconnect"}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="h-7 rounded-md border border-[var(--clr-cyan)] px-3 text-[11px] font-semibold text-[var(--clr-cyan)] transition-colors hover:bg-[var(--clr-cyan)]/10 active:scale-[0.96] disabled:opacity-50"
              disabled={isPending}
              onClick={() => connectMutation.mutate(form)}
            >
              {isPending ? "Connecting..." : "Connect TWS / IB Gateway"}
            </button>
          )}
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-1 pb-1">
        {connected ? (
          <div className="flex divide-x divide-border overflow-hidden rounded-md border border-border bg-[var(--bg-1)] text-[11px]">
            <div className="flex items-center gap-1.5 px-4 py-2.5">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[var(--clr-green)]" strokeWidth={1.7} />
              <span className="font-semibold text-[var(--clr-green)]">Reconciled</span>
            </div>
            <div className="flex items-center gap-1.5 px-4 py-2.5">
              <span className="font-data font-medium text-[var(--text-1)]">{summary?.position_count ?? 0}</span>
              <span className="text-[var(--text-2)]">{(summary?.position_count ?? 0) === 1 ? "position" : "positions"}</span>
            </div>
            <div className="flex items-center gap-1.5 px-4 py-2.5">
              <span className="font-data font-medium text-[var(--text-1)]">{summary?.open_order_count ?? 0}</span>
              <span className="text-[var(--text-2)]">{(summary?.open_order_count ?? 0) === 1 ? "open order" : "open orders"}</span>
            </div>
            <div className="flex items-center gap-1.5 px-4 py-2.5">
              <Power className={cn("h-3.5 w-3.5 shrink-0", status?.kill_switch_active ? "text-[var(--clr-red)]" : "text-[var(--text-3)]")} strokeWidth={1.7} />
              <span className={status?.kill_switch_active ? "font-semibold text-[var(--clr-red)]" : "text-[var(--text-2)]"}>
                Kill switch {status?.kill_switch_active ? "active" : "inactive"}
              </span>
            </div>
            <div className="ml-auto flex items-center px-4 py-2.5">
              <span className="rounded-full border border-[var(--clr-cyan)]/40 bg-[var(--glow-cyan)] px-2 py-0.5 text-[10px] font-semibold text-[var(--clr-cyan)]">
                TWS only
              </span>
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-border bg-[var(--bg-1)] px-3 py-2">
            {adapterState === "error" && (
              <p className="mb-2 text-xs text-[var(--clr-red)]">
                Connection failed. Check that TWS or IB Gateway is running on the host and port below.
              </p>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <label className="space-y-0.5">
                <span className="text-[10px] text-[var(--text-3)]">Host</span>
                <input
                  className="h-8 w-28 rounded border border-border bg-[var(--bg-0)] px-2.5 font-data text-[12px] outline-none transition-colors focus:border-[var(--clr-cyan)]"
                  value={form.host}
                  onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
                />
              </label>
              <label className="space-y-0.5">
                <span className="text-[10px] text-[var(--text-3)]">Port</span>
                <input
                  type="number"
                  className="h-8 w-20 rounded border border-border bg-[var(--bg-0)] px-2.5 font-data text-[12px] outline-none transition-colors focus:border-[var(--clr-cyan)]"
                  value={form.port}
                  onChange={(e) => setForm((f) => ({ ...f, port: Number(e.target.value) }))}
                />
              </label>
              <label className="space-y-0.5">
                <span className="text-[10px] text-[var(--text-3)]">Client ID</span>
                <input
                  type="number"
                  className="h-8 w-20 rounded border border-border bg-[var(--bg-0)] px-2.5 font-data text-[12px] outline-none transition-colors focus:border-[var(--clr-cyan)]"
                  value={form.client_id}
                  onChange={(e) => setForm((f) => ({ ...f, client_id: Number(e.target.value) }))}
                />
              </label>
              <button
                className="h-8 rounded-md border border-[var(--clr-cyan)] px-3 text-[12px] font-semibold text-[var(--clr-cyan)] transition-colors hover:bg-[var(--clr-cyan)]/10 active:scale-[0.96] disabled:opacity-50"
                disabled={isPending}
                onClick={() => connectMutation.mutate(form)}
              >
                {isPending ? "Connecting..." : "Connect"}
              </button>
              {status?.api_server_available != null && (
                <span className="text-[11px] text-[var(--text-3)]">
                  API {status.api_server_available ? "reachable" : "not reachable"}
                </span>
              )}
            </div>
          </div>
        )}

        <div className="grid min-h-[405px] gap-1.5 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <Panel title="Execution Plan" className="h-full">
              {paperSubmission != null ? (
                <div className="flex h-full flex-col">
                  {/* Top content — scrolls when taller than the panel */}
                  <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-5 pb-2">
                    {/* Hero band */}
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded border border-[var(--clr-green)]/30 bg-[var(--bg-0)] px-4 py-4">
                      <span className="font-data text-2xl font-bold text-[var(--text-1)]">{paperSubmission.symbol}</span>
                      <span className={`font-data text-xl font-bold ${paperSubmission.side === "BUY" ? "text-[var(--clr-green)]" : "text-[var(--clr-red)]"}`}>
                        {paperSubmission.side}
                      </span>
                      <span className="font-data text-xl font-semibold text-[var(--text-1)]">{paperSubmission.quantity}</span>
                      <span className="font-data text-xl font-semibold text-[var(--text-2)]">{paperSubmission.order_type}</span>
                      {paperSubmission.limit_price != null && (
                        <>
                          <span className="text-lg text-[var(--text-3)]">@</span>
                          <span className="font-data text-2xl font-bold text-[var(--text-1)]">
                            {paperSubmission.limit_price.toFixed(2)}
                          </span>
                        </>
                      )}
                    </div>

                    {/* Detail grid */}
                    <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
                      <div className="space-y-0.5">
                        <div className="text-xs font-medium text-[var(--text-3)]">Broker order ID</div>
                        <div className="font-data text-sm text-[var(--text-1)]">{paperSubmission.order_id}</div>
                      </div>
                      <div className="space-y-0.5">
                        <div className="text-xs font-medium text-[var(--text-3)]">TWS status</div>
                        <div className="font-data text-sm font-semibold text-[var(--clr-green)]">{paperSubmission.status}</div>
                      </div>
                      <div className="space-y-0.5">
                        <div className="text-xs font-medium text-[var(--text-3)]">Side</div>
                        <div className={`font-data text-sm font-semibold ${paperSubmission.side === "BUY" ? "text-[var(--clr-green)]" : "text-[var(--clr-red)]"}`}>{paperSubmission.side}</div>
                      </div>
                      <div className="space-y-0.5">
                        <div className="text-xs font-medium text-[var(--text-3)]">Quantity</div>
                        <div className="font-data text-sm text-[var(--text-1)]">{paperSubmission.quantity}</div>
                      </div>
                      <div className="space-y-0.5">
                        <div className="text-xs font-medium text-[var(--text-3)]">Order type</div>
                        <div className="font-data text-sm text-[var(--text-1)]">{paperSubmission.order_type}</div>
                      </div>
                      {paperSubmission.limit_price != null && (
                        <div className="space-y-0.5">
                          <div className="text-xs font-medium text-[var(--text-3)]">Limit price</div>
                          <div className="font-data text-sm text-[var(--text-1)]">{paperSubmission.limit_price.toFixed(2)}</div>
                        </div>
                      )}
                    </div>

                    {/* Confirmation notice */}
                    <div className="flex items-start gap-3 rounded border border-[var(--clr-green)]/25 bg-[var(--glow-green)] px-4 py-3">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--clr-green)]" strokeWidth={1.7} />
                      <div>
                        <p className="text-xs font-semibold text-[var(--clr-green)]">Order sent to TWS paper account.</p>
                        <p className="mt-0.5 text-xs text-[var(--text-2)]">
                          Open Orders refreshes automatically. Use "Refresh Open Orders" to poll for fill status.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Bottom: actions — always visible */}
                  <div className="shrink-0 flex flex-wrap items-center gap-3 pt-2">
                    <button
                      className="h-9 rounded-md border border-[var(--clr-cyan)] px-5 text-sm font-semibold text-[var(--clr-cyan)] transition-colors hover:bg-[var(--clr-cyan)]/10 active:scale-[0.96]"
                      onClick={() => { placePaperMutation.reset(); setCurrentPlan(null); setPaperPreview(null); setPaperSubmission(null); }}
                    >
                      New order
                    </button>
                    <button
                      className="h-9 rounded-md border border-border px-4 text-sm text-[var(--text-2)] transition-colors hover:bg-[var(--bg-1)] hover:text-[var(--text-1)]"
                      onClick={() => queryClient.invalidateQueries({ queryKey: RECON_KEY })}
                    >
                      Refresh Open Orders
                    </button>
                  </div>
                </div>
              ) : paperPreview != null ? (
                <div className="flex h-full flex-col">
                  {/* Top content — scrolls when taller than the panel */}
                  <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-5 pb-2">
                    {/* Hero order summary */}
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded border border-[var(--clr-cyan)]/20 bg-[var(--bg-0)] px-4 py-4">
                      <span className="font-data text-2xl font-bold text-[var(--text-1)]">{paperPreview.symbol}</span>
                      <span className={`font-data text-xl font-bold ${paperPreview.side === "BUY" ? "text-[var(--clr-green)]" : "text-[var(--clr-red)]"}`}>
                        {paperPreview.side}
                      </span>
                      <span className="font-data text-xl font-semibold text-[var(--text-1)]">{paperPreview.quantity}</span>
                      <span className="font-data text-xl font-semibold text-[var(--text-2)]">{paperPreview.order_type}</span>
                      {paperPreview.limit_price != null && (
                        <>
                          <span className="text-lg text-[var(--text-3)]">@</span>
                          <span className="font-data text-2xl font-bold text-[var(--text-1)]">
                            {paperPreview.limit_price.toFixed(2)}
                          </span>
                        </>
                      )}
                    </div>

                    {/* Detail grid */}
                    <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
                      {[
                        { label: "ConID", value: paperPreview.conid },
                        { label: "Side", value: paperPreview.side, tone: paperPreview.side === "BUY" ? "success" : "danger" },
                        { label: "Quantity", value: paperPreview.quantity },
                        { label: "Order type", value: paperPreview.order_type },
                        { label: "Limit price", value: paperPreview.limit_price != null ? paperPreview.limit_price.toFixed(2) : "—" },
                        { label: "TIF", value: paperPreview.tif },
                      ].map(({ label, value, tone }) => (
                        <div key={label} className="space-y-0.5">
                          <div className="text-xs font-medium text-[var(--text-3)]">{label}</div>
                          <div className={cn(
                            "font-data text-sm",
                            tone === "success" && "font-semibold text-[var(--clr-green)]",
                            tone === "danger" && "font-semibold text-[var(--clr-red)]",
                            !tone && "text-[var(--text-1)]",
                          )}>{value}</div>
                        </div>
                      ))}
                    </div>

                    {/* Notional */}
                    {paperPreview.order_type === "LMT" && paperPreview.limit_price != null && (
                      <div className="flex items-center justify-between rounded border border-border/50 bg-[var(--bg-0)] px-4 py-3">
                        <span className="text-xs text-[var(--text-3)]">
                          {paperPreview.quantity} × {paperPreview.limit_price.toFixed(2)}
                        </span>
                        <div className="text-right">
                          <div className="text-[10px] uppercase tracking-wider text-[var(--text-3)]">Notional</div>
                          <div className="font-data text-base font-semibold text-[var(--text-1)]">
                            ${(paperPreview.quantity * paperPreview.limit_price).toFixed(2)}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Safety notice */}
                    <div className="flex items-start gap-3 rounded border border-[var(--clr-green)]/25 bg-[var(--glow-green)] px-4 py-3">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--clr-green)]" strokeWidth={1.7} />
                      <div>
                        <p className="text-xs font-semibold text-[var(--clr-green)]">This is a PAPER order only.</p>
                        <p className="mt-0.5 text-xs text-[var(--text-2)]">
                          It will be routed to your TWS paper account and will not impact live trading.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Bottom: errors + actions — always visible */}
                  <div className="shrink-0 flex flex-col gap-3 pt-2">
                    {placePaperMutation.isError && (() => {
                      const code = submitErrorCode(placePaperMutation.error);
                      if (code === "unknown_outcome") {
                        return (
                          <div className="rounded border border-[var(--clr-amber,#d97706)]/40 bg-[var(--bg-0)] p-3 space-y-1.5">
                            <p className="text-xs font-semibold text-[var(--clr-amber,#d97706)]">
                              Outcome unknown — do not retry yet.
                            </p>
                            <p className="text-xs text-[var(--text-2)]">
                              The order may have reached TWS. Check Open Orders below before retrying to avoid a duplicate position.
                            </p>
                            <button
                              className="h-7 rounded border border-border px-2.5 text-[11px] text-[var(--text-2)] hover:bg-[var(--bg-1)]"
                              onClick={() => queryClient.invalidateQueries({ queryKey: RECON_KEY })}
                            >
                              Refresh Open Orders
                            </button>
                          </div>
                        );
                      }
                      const msg = SUBMIT_ERROR_MESSAGES[code ?? ""] ??
                        "Order rejected — check that TWS is connected and on a paper port.";
                      return <p className="text-xs text-[var(--clr-red)]">{msg}</p>;
                    })()}
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        className="h-9 rounded-md bg-[var(--clr-green)] px-5 text-sm font-semibold text-[var(--bg-0)] transition-colors hover:opacity-90 active:scale-[0.96] disabled:opacity-50"
                        disabled={placePaperMutation.isPending}
                        onClick={() => placePaperMutation.mutate(paperPreview.plan_id)}
                      >
                        {placePaperMutation.isPending ? "Placing order..." : "Place paper order"}
                      </button>
                      <button
                        className="h-9 rounded-md border border-border px-4 text-sm text-[var(--text-2)] transition-colors hover:bg-[var(--bg-1)] hover:text-[var(--text-1)] disabled:opacity-50"
                        disabled={placePaperMutation.isPending}
                        onClick={() => { placePaperMutation.reset(); setCurrentPlan(null); setPaperPreview(null); setPaperSubmission(null); }}
                      >
                        Edit ticket
                      </button>
                    </div>
                  </div>

                </div>
              ) : (
                <div className="relative flex h-full flex-col">
                  <div className={cn("flex-1 min-h-0 overflow-y-auto flex flex-col gap-5 pb-2", !canDraft && "opacity-45")}>
                    {/* Row 1: Symbol (hero) · ConID · Side */}
                    <div className="grid gap-3 md:grid-cols-3">
                      <label className="space-y-1.5">
                        <span className="text-xs font-medium text-[var(--text-2)]">Symbol</span>
                        <div className="relative">
                          <input
                            className="h-11 w-full rounded border border-border bg-[var(--bg-0)] px-3 pr-9 text-sm font-semibold uppercase outline-none transition-colors focus:border-[var(--clr-cyan)] disabled:cursor-not-allowed"
                            placeholder="e.g. NVDA"
                            value={planForm.symbol}
                            disabled={!canDraft}
                            onChange={(e) => handleSymbolChange(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && runSearch()}
                          />
                          <button
                            type="button"
                            className="absolute right-2.5 top-3 text-[var(--text-3)] hover:text-[var(--clr-cyan)] disabled:cursor-not-allowed"
                            disabled={!canDraft || !planForm.symbol || searchMutation.isPending}
                            onClick={runSearch}
                            tabIndex={-1}
                          >
                            <Search className="h-4 w-4" strokeWidth={1.7} />
                          </button>
                        </div>
                        {searchResults.length > 1 && (
                          <ul className="mt-0.5 rounded border border-border bg-[var(--bg-0)] shadow-md">
                            {searchResults.map((r) => (
                              <li key={r.conid}>
                                <button
                                  type="button"
                                  className="flex w-full items-center justify-between px-2.5 py-1.5 text-left text-[11px] hover:bg-[var(--bg-1)]"
                                  onClick={() => {
                                    setPlanForm((f) => ({ ...f, conid: r.conid }));
                                    setSelectedExchange(r.primary_exchange || r.exchange);
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
                      <label className="space-y-1.5">
                        <span className="text-xs font-medium text-[var(--text-2)]">ConID</span>
                        <input
                          type="number"
                          className="h-9 w-full rounded border border-border bg-[var(--bg-0)] px-3 font-data text-sm outline-none transition-colors focus:border-[var(--clr-cyan)] disabled:cursor-not-allowed"
                          placeholder="Search symbol to resolve"
                          value={planForm.conid || ""}
                          disabled={!canDraft}
                          onChange={(e) => setPlanForm((f) => ({ ...f, conid: Number(e.target.value) }))}
                        />
                      </label>
                      <label className="space-y-1.5">
                        <span className="text-xs font-medium text-[var(--text-2)]">Side</span>
                        <select
                          className="h-9 w-full rounded border border-border bg-[var(--bg-0)] px-3 text-sm outline-none transition-colors focus:border-[var(--clr-cyan)] disabled:cursor-not-allowed"
                          value={planForm.side}
                          disabled={!canDraft}
                          onChange={(e) => setPlanForm((f) => ({ ...f, side: e.target.value as ExecutionPlanSide }))}
                        >
                          <option value="BUY">BUY</option>
                          <option value="SELL">SELL</option>
                        </select>
                      </label>
                    </div>

                    {/* Row 2: Quantity · Order type · Limit price (hero) */}
                    <div className="grid gap-3 md:grid-cols-3">
                      <label className="space-y-1.5">
                        <span className="text-xs font-medium text-[var(--text-2)]">Quantity</span>
                        <input
                          type="number"
                          className="h-9 w-full rounded border border-border bg-[var(--bg-0)] px-3 font-data text-sm outline-none transition-colors focus:border-[var(--clr-cyan)] disabled:cursor-not-allowed"
                          value={planForm.quantity}
                          disabled={!canDraft}
                          onChange={(e) => setPlanForm((f) => ({ ...f, quantity: Number(e.target.value) }))}
                        />
                      </label>
                      <label className="space-y-1.5">
                        <span className="text-xs font-medium text-[var(--text-2)]">Order type</span>
                        <select
                          className="h-9 w-full rounded border border-border bg-[var(--bg-0)] px-3 text-sm outline-none transition-colors focus:border-[var(--clr-cyan)] disabled:cursor-not-allowed"
                          value={planForm.order_type}
                          disabled={!canDraft}
                          onChange={(e) => setPlanForm((f) => ({ ...f, order_type: e.target.value as ExecutionPlanOrderType, limit_price: null }))}
                        >
                          <option value="LMT">LMT</option>
                          <option value="MKT">MKT</option>
                        </select>
                      </label>
                      {planForm.order_type === "LMT" && (
                        <label className="space-y-1.5">
                          <span className="text-xs font-medium text-[var(--text-2)]">Limit price</span>
                          <input
                            type="number"
                            step="0.01"
                            className="h-11 w-full rounded border border-border bg-[var(--bg-0)] px-3 font-data text-sm font-semibold outline-none transition-colors focus:border-[var(--clr-cyan)] disabled:cursor-not-allowed"
                            placeholder="0.00"
                            value={planForm.limit_price ?? ""}
                            disabled={!canDraft}
                            onChange={(e) => setPlanForm((f) => ({ ...f, limit_price: Number(e.target.value) || null }))}
                          />
                        </label>
                      )}
                    </div>

                    {/* Notional value */}
                    {planForm.order_type === "LMT" && planForm.limit_price != null && planForm.limit_price > 0 && planForm.quantity > 0 && (
                      <div className="flex items-center justify-between rounded border border-border/50 bg-[var(--bg-0)] px-4 py-3">
                        <span className="text-xs text-[var(--text-3)]">
                          {planForm.quantity} × {planForm.limit_price.toFixed(2)}
                        </span>
                        <div className="text-right">
                          <div className="text-[10px] uppercase tracking-wider text-[var(--text-3)]">Notional</div>
                          <div className="font-data text-base font-semibold text-[var(--text-1)]">
                            ${(planForm.quantity * planForm.limit_price).toFixed(2)}
                          </div>
                        </div>
                      </div>
                    )}

                  </div>

                  {/* Bottom: errors + action — always visible */}
                  <div className="shrink-0 flex flex-col gap-3 pt-2">
                    {currentPlan?.status === "invalid" && currentPlan.validation_errors.length > 0 && (
                      <ul className="space-y-1">
                        {currentPlan.validation_errors.map((e, i) => (
                          <li key={i} className="text-xs text-[var(--clr-red)]">- {e}</li>
                        ))}
                      </ul>
                    )}
                    {reviewMutation.isError && currentPlan?.status !== "invalid" && (
                      <p className="text-xs text-[var(--clr-red)]">
                        {SUBMIT_ERROR_MESSAGES[submitErrorCode(reviewMutation.error) ?? ""] ??
                          "Review failed — check that TWS is connected and on a paper port."}
                      </p>
                    )}
                    {(() => {
                      const reason = saveDraftDisabledReason();
                      return (
                        <div className="flex items-center gap-3">
                          <button
                            className="h-9 rounded-md border border-[var(--clr-cyan)] px-4 text-sm font-semibold text-[var(--clr-cyan)] transition-colors hover:bg-[var(--clr-cyan)]/10 active:scale-[0.96] disabled:opacity-50"
                            disabled={!canDraft || reviewMutation.isPending || reason != null}
                            onClick={() => { placePaperMutation.reset(); reviewMutation.mutate(planForm); }}
                          >
                            {reviewMutation.isPending ? "Reviewing..." : "Review paper order"}
                          </button>
                          {canDraft && reason != null && (
                            <span className="text-xs text-[var(--text-3)]">{reason}</span>
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
          <aside className="h-full">
            <section className="flex h-full min-w-0 flex-col rounded-md border border-border bg-[var(--bg-1)] shadow-sm">
              <div className="shrink-0 border-b border-border px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--clr-cyan)]">
                    {planForm.symbol ? `${planForm.symbol} Chart` : "Chart"}
                  </h2>
                  <div className="flex gap-0.5">
                    {TWS_TIMEFRAMES.map((tf) => (
                      <button
                        key={tf}
                        onClick={() => setActiveTimeframe(tf)}
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[9px] transition-colors",
                          activeTimeframe === tf
                            ? "bg-[var(--glow-cyan)] font-semibold text-[var(--clr-cyan)]"
                            : "text-[var(--text-3)] hover:text-[var(--text-2)]",
                        )}
                      >
                        {tf}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {planForm.conid > 0 && connected && (
                <QuoteStrip quote={quote} exchange={selectedExchange} loading={quoteLoading} />
              )}
              <div className="flex flex-1 p-3">
                <div className="flex flex-1 overflow-hidden rounded border border-border/60 bg-[var(--bg-0)]">
                  {barsLoading ? (
                    <div className="flex h-full w-full items-center justify-center text-[11px] text-[var(--text-3)] animate-pulse">
                      Loading bars…
                    </div>
                  ) : barsData && barsData.bars.length > 0 ? (
                    <TwsCandleChart bars={barsData.bars} />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-center">
                      <div>
                        <div className="text-[12px] font-medium text-[var(--text-2)]">Chart unavailable</div>
                        <p className="mt-1 text-[11px] text-[var(--text-3)]">
                          {planForm.conid > 0 ? "No bars returned for this symbol." : "Select a symbol to load chart."}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </section>
          </aside>
        </div>

        <div className="mt-4 grid gap-1.5 md:grid-cols-2">
          <Panel title="Positions">
            {recon && recon.positions.length > 0 ? (
              <div className="max-h-[160px] overflow-y-auto">
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
              </div>
            ) : (
              <EmptyTableState label="No positions" />
            )}
          </Panel>

          <Panel title="Open Orders">
            {recon && recon.open_orders.length > 0 ? (
              <div className="max-h-[160px] overflow-y-auto">
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
              </div>
            ) : (
              <EmptyTableState label="No open orders" />
            )}
          </Panel>
        </div>
      </main>
    </div>
  );
}
