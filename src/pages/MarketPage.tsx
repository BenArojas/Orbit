import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import { parallaxApi, type MarketAssessmentResponse, type MarketInstrumentEvidence } from "@/modules/parallax/api";
import { useIbkrReady } from "@/context/GatewayContext";
import { useLiveQuotes } from "@/hooks/useLiveQuotes";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useNavigationStore } from "@/store";

const COLORS = {
  background: "#F1F4F5",
  surface: "#FCFDFD",
  ink: "#25313A",
  accent: "#436782",
  muted: "#59666E",
  line: "#D9E1E4",
};

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

function price(value: number | null | undefined): string {
  return value == null ? "—" : `$${numberFormat.format(value)}`;
}

function joinNames(names: string[]): string {
  if (names.length < 2) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function evidenceSummary(assessment: MarketAssessmentResponse | undefined, currentSession: boolean): string {
  if (!assessment) return "Completed-session evidence is loading.";
  const indexText = ["constructive", "weak", "mixed"].flatMap((trend) => {
    const names = assessment.indices.filter((item) => item.trend === trend).map((item) => item.symbol);
    return names.length ? [`${joinNames(names)} ${names.length === 1 ? "is" : "are"} ${trend}`] : [];
  });
  const unconfirmedIndices = assessment.indices.filter((item) => item.trend == null).map((item) => item.symbol);
  if (unconfirmedIndices.length) indexText.push(`${joinNames(unconfirmedIndices)} trend evidence is unavailable`);
  const indexSummary = indexText.length ? `${indexText.join("; ")}.` : "Index trend evidence is unavailable.";
  const participation = assessment.participation;
  const sectorSummary = participation.missing === 0
    ? `Only ${participation.confirmed_above} of 11 sector ETFs are above SMA50.`
    : `${participation.available} of 11 sector readings are available; ${participation.possible_above_min}–${participation.possible_above_max} could be above SMA50.`;
  const session = assessment.evidence_session;
  if (currentSession && session && assessment.status === "complete") {
    return `Completed session ${session}: ${indexSummary} ${sectorSummary}`;
  }
  if (currentSession && session) return `Partial evidence for ${session}: ${indexSummary} ${sectorSummary}`;
  if (session) return `Dated evidence from ${session}; current session ${assessment.expected_session ?? "unconfirmed"} is not confirmed. ${indexSummary} ${sectorSummary}`;
  return `Session date unconfirmed. ${indexSummary} ${sectorSummary}`;
}

function postureCopy(assessment: MarketAssessmentResponse | undefined, currentSession: boolean) {
  const detail = evidenceSummary(assessment, currentSession);
  if (!assessment?.posture) {
    return {
      title: "Current assessment incomplete",
      detail,
      priority: "Waiting for complete evidence",
    };
  }
  if (!currentSession) {
    const lastPosture = assessment.posture === "broad" ? "Broad strength" : assessment.posture === "defensive" ? "Defensive conditions" : "Selective strength";
    return {
      title: `Previous assessment · ${lastPosture}`,
      detail,
      priority: "Current market priority is unconfirmed",
    };
  }
  if (assessment.posture === "broad") {
    return { title: "Broad strength", detail, priority: "Breakouts and retests have priority" };
  }
  if (assessment.posture === "defensive") {
    return { title: "Defensive conditions", detail, priority: "Preserve capital; waiting is valid" };
  }
  return { title: "Selective strength", detail, priority: "Favor strong names near support and selected retests" };
}

function transportLabel(status: string, upstream: { ibkrConnected: boolean; wsReady: boolean } | null): string {
  if (status === "connecting") return "IBKR transport connecting";
  if (status !== "connected") return "IBKR transport disconnected";
  if (!upstream) return "IBKR session status unconfirmed";
  if (!upstream.ibkrConnected) return "IBKR session disconnected";
  if (!upstream.wsReady) return "IBKR market transport disconnected";
  return "IBKR transport connected";
}

function quoteState(availability?: string): "Live" | "Delayed" | "Frozen" | "Unavailable" | "Unconfirmed" {
  switch (availability?.[0]) {
    case "R": return "Live";
    case "D":
    case "Y": return "Delayed";
    case "Z": return "Frozen";
    case "N": return "Unavailable";
    default: return "Unconfirmed";
  }
}

function quoteSummary(quotes: Map<number, { availability?: string }>, conids: number[]) {
  const counts = { Live: 0, Delayed: 0, Frozen: 0, Unavailable: 0, Unconfirmed: 0 };
  for (const conid of conids) counts[quoteState(quotes.get(conid)?.availability)] += 1;
  if (conids.length > 0 && counts.Live === conids.length) return { label: "Live quote data confirmed", kind: "live" };
  const labels = Object.entries(counts).filter(([, count]) => count > 0).map(([name, count]) => `${name} ${count}`);
  return { label: labels.length ? `${labels.join(" · ")} · quote availability` : "Quote availability unconfirmed", kind: "uncertain" };
}

function EvidenceRow({
  item,
  livePrice,
  availability,
  onOpen,
}: {
  item: MarketInstrumentEvidence;
  livePrice?: number;
  availability?: string;
  onOpen: (conid: number, symbol: string) => void;
}) {
  const classification = item.trend ?? (item.above_sma50 == null ? "Unavailable" : item.above_sma50 ? "Above SMA50" : "Below SMA50");
  const label = item.name ? `${item.symbol} · ${item.name}` : item.symbol;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b py-2 last:border-b-0" style={{ borderColor: COLORS.line }}>
      {item.conid ? (
        <button type="button" onClick={() => onOpen(item.conid!, item.symbol)} className="flex min-w-0 items-center gap-1 text-left text-sm font-semibold hover:underline" style={{ color: COLORS.ink }}>
          <span className="truncate">{label}</span><ArrowUpRight size={13} aria-hidden="true" />
        </button>
      ) : <span className="truncate text-sm font-semibold" style={{ color: COLORS.ink }}>{label}</span>}
      <span className="text-right">
        <span className="block font-mono text-sm tabular-nums" style={{ color: COLORS.ink }}>{price(livePrice)}</span>
        <span className="block text-[10px]" style={{ color: COLORS.muted }}>{quoteState(availability)} quote</span>
      </span>
      <span className="min-w-[92px] text-right text-xs capitalize" style={{ color: item.unavailable_reason ? COLORS.muted : COLORS.accent }} title={item.unavailable_reason ?? undefined}>{classification}</span>
    </div>
  );
}

export default function MarketPage() {
  const authenticated = useIbkrReady();
  const { status: feedStatus, upstreamStatus } = useWebSocket();
  const navigateToAnalysis = useNavigationStore((state) => state.navigateToAnalysis);
  const navigate = useNavigationStore((state) => state.navigate);
  const query = useQuery({
    queryKey: ["parallax", "market-assessment"],
    queryFn: ({ signal }) => parallaxApi.marketAssessment(signal),
    enabled: authenticated,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  const requestFailed = query.isError || query.isRefetchError;
  const shouldRevalidate = requestFailed || query.data != null;
  const instruments = useMemo(
    () => [...(query.data?.indices ?? []), ...(query.data?.sectors ?? [])],
    [query.data],
  );
  const conids = useMemo(
    () => instruments.flatMap((item) => item.conid == null ? [] : [item.conid]),
    [instruments],
  );
  const liveQuotes = useLiveQuotes(conids);
  const previousFeedStatus = useRef(feedStatus);
  const previousUpstreamReady = useRef(upstreamStatus?.wsReady);

  useEffect(() => {
    if (authenticated && feedStatus === "connected" && previousFeedStatus.current !== "connected") {
      void query.refetch();
    }
    previousFeedStatus.current = feedStatus;
  }, [authenticated, feedStatus, query.refetch]);

  useEffect(() => {
    if (authenticated && upstreamStatus?.wsReady && previousUpstreamReady.current !== true) {
      void query.refetch();
    }
    previousUpstreamReady.current = upstreamStatus?.wsReady;
  }, [authenticated, upstreamStatus, query.refetch]);

  useEffect(() => {
    if (!authenticated || !shouldRevalidate) return;
    const timer = window.setInterval(() => {
      void query.refetch({ cancelRefetch: false });
    }, 5 * 60_000);
    return () => window.clearInterval(timer);
  }, [authenticated, shouldRevalidate, query.refetch]);

  useEffect(() => {
    const assessment = query.data;
    if (!authenticated || !assessment?.next_reconcile_at) return;
    const nextClose = Date.parse(assessment.next_reconcile_at);
    if (!Number.isFinite(nextClose)) return;
    const delay = Math.max(0, nextClose - Date.now());
    const timer = window.setTimeout(() => void query.refetch({ cancelRefetch: false }), delay);
    return () => window.clearTimeout(timer);
  }, [authenticated, query.data?.next_reconcile_at, query.refetch]);

  const currentSession = !!query.data?.evidence_session
    && query.data.evidence_session === query.data.expected_session;
  const currentPosture = requestFailed || !currentSession ? null : query.data?.posture ?? null;
  const posture = requestFailed ? {
      title: "Current assessment unavailable",
      detail: "The latest assessment request failed. Any dated evidence below is the last successful result.",
      priority: "Market priority is unconfirmed",
    }
    : postureCopy(query.data, currentSession);
  const transport = transportLabel(feedStatus, upstreamStatus);
  const quoteEvidence = quoteSummary(liveQuotes, conids);
  const participation = query.data?.participation;
  const range = participation
    ? participation.missing === 0
      ? `${participation.confirmed_above} of 11`
      : `${participation.possible_above_min}–${participation.possible_above_max} possible of 11`
    : "—";
  const rangeDate = query.data?.evidence_session ?? "session date unconfirmed";

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6" style={{ background: COLORS.background, color: COLORS.ink }}>
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: COLORS.accent }}>Parallax · Market first</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Market</h1>
            <p className="mt-1 text-sm" style={{ color: COLORS.muted }}>Completed-session evidence, with current prices streamed separately.</p>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" style={{ color: COLORS.muted }} role="status" aria-live="polite">
            <span>{transport}</span>
            <span aria-hidden="true">·</span>
            <span className={`h-2 w-2 rounded-full ${quoteEvidence.kind === "live" ? "bg-emerald-600" : "bg-amber-500"}`} aria-hidden="true" />
            <span>{quoteEvidence.label}</span>
          </div>
        </header>

        <section className="rounded-xl border p-5 sm:p-6" style={{ background: COLORS.surface, borderColor: COLORS.line }} aria-labelledby="market-posture">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <div className="flex items-center gap-2">
                <h2 id="market-posture" className="text-xl font-semibold">{posture.title}</h2>
                {query.data?.status === "partial" && <span className="rounded-full px-2 py-1 text-[11px]" style={{ background: COLORS.background, color: COLORS.accent }}>Partial evidence</span>}
              </div>
              <p className="mt-2 text-sm" style={{ color: COLORS.muted }}>{posture.detail}</p>
              <p className="mt-3 text-sm font-semibold" style={{ color: COLORS.accent }}>{posture.priority}</p>
              <button type="button" onClick={() => navigate("screener")} className="mt-3 inline-flex min-h-10 items-center gap-1 rounded-md border px-3 py-2 text-xs font-semibold hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" style={{ color: COLORS.accent, borderColor: COLORS.line, background: COLORS.surface }}>
                Explore strong names <ArrowUpRight size={13} aria-hidden="true" />
              </button>
            </div>
            <div className="min-w-36 rounded-lg px-4 py-3" style={{ background: COLORS.background }}>
              <p className="text-[11px] uppercase tracking-wide" style={{ color: COLORS.muted }}>Sector ETF proxy</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">{range} above SMA50</p>
              <p className="mt-1 text-[11px]" style={{ color: COLORS.muted }}>{rangeDate}</p>
              <p className="mt-1 text-[11px]" style={{ color: COLORS.muted }}>Not individual-stock breadth</p>
            </div>
          </div>
          {(requestFailed || (query.data?.issues.length ?? 0) > 0) && (
            <div className="mt-4 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: COLORS.line, color: COLORS.muted }}>
              {requestFailed ? "Market evidence could not be loaded. The feed remains available independently." : query.data?.issues.join(" · ")}
            </div>
          )}
        </section>

        <section className="grid gap-3 sm:grid-cols-3" aria-label="Major indices">
          {query.data?.indices.map((item) => (
            <article key={item.symbol} className="rounded-xl border px-4 py-3" style={{ background: COLORS.surface, borderColor: COLORS.line }}>
              <div className="flex items-baseline justify-between gap-2">
                {item.conid ? <button type="button" onClick={() => navigateToAnalysis(item.conid!, item.symbol)} className="text-sm font-semibold hover:underline">{item.symbol}</button> : <span className="text-sm font-semibold">{item.symbol}</span>}
                <span className="text-right">
                  <span className="block font-mono text-lg font-semibold tabular-nums">{price(item.conid ? liveQuotes.get(item.conid)?.last : null)}</span>
                  <span className="block text-[10px]" style={{ color: COLORS.muted }}>{quoteState(item.conid ? liveQuotes.get(item.conid)?.availability : undefined)} quote</span>
                </span>
              </div>
              <p className="mt-1 text-xs capitalize" style={{ color: COLORS.muted }}>{item.trend ?? item.unavailable_reason ?? "Waiting for evidence"}</p>
              <p className="mt-1 text-[11px]" style={{ color: COLORS.muted }}>SMA200 context {price(item.sma200)}</p>
            </article>
          )) ?? <article className="rounded-xl border p-4 text-sm sm:col-span-3" style={{ background: COLORS.surface, borderColor: COLORS.line, color: COLORS.muted }}>{query.isLoading ? "Loading completed-session evidence…" : "Connect to IBKR to load market evidence."}</article>}
        </section>

        <section className="grid gap-2 sm:grid-cols-3" aria-label="Available tactics">
          {[
            ["Pullbacks", currentPosture === "defensive" ? "Wait for support; waiting is valid" : currentPosture === "broad" ? "Available" : currentPosture === "selective" ? "Priority: strong names near support" : "Available; market priority unknown"],
            ["Breakouts", currentPosture === "broad" ? "Priority in broad strength" : currentPosture === "defensive" ? "Stay selective" : currentPosture === "selective" ? "Available with selection" : "Available; market priority unknown"],
            ["Breakout retests", currentPosture === "broad" ? "Priority in broad strength" : currentPosture === "defensive" ? "Wait for conditions to improve" : currentPosture === "selective" ? "Available with selection" : "Available; market priority unknown"],
          ].map(([name, note]) => (
            <article key={name} className="rounded-lg border px-3 py-2" style={{ background: COLORS.surface, borderColor: COLORS.line }}>
              <h2 className="text-xs font-semibold">{name}</h2>
              <p className="mt-1 text-[11px]" style={{ color: COLORS.muted }}>{note}</p>
            </article>
          ))}
        </section>

        <section className="rounded-xl border px-4 py-3" style={{ background: COLORS.surface, borderColor: COLORS.line }}>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">Sector participation</h2>
              <p className="mt-0.5 text-xs" style={{ color: COLORS.muted }}>Eleven sector ETFs · above their 50-day simple average · {rangeDate}</p>
            </div>
            <span className="text-xs tabular-nums" style={{ color: COLORS.muted }}>{participation ? `${participation.available} available · ${participation.missing} missing` : "Loading"}</span>
          </div>
          <div className="grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
              {query.data?.sectors.map((item) => (
              <EvidenceRow key={item.symbol} item={item} livePrice={item.conid ? liveQuotes.get(item.conid)?.last : undefined} availability={item.conid ? liveQuotes.get(item.conid)?.availability : undefined} onOpen={navigateToAnalysis} />
            ))}
          </div>
        </section>

        <details className="rounded-xl border px-4 py-3" style={{ background: COLORS.surface, borderColor: COLORS.line }}>
          <summary className="cursor-pointer text-sm font-semibold">Assessment evidence and update times</summary>
          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2" style={{ color: COLORS.muted }}>
            <p>Expected completed session: {query.data?.expected_session ?? "Unavailable"}</p>
            <p>Evidence session: {query.data?.evidence_session ?? "Incomplete"}</p>
            <p>Calculated: {query.data?.calculated_at ? new Date(query.data.calculated_at).toLocaleString() : "Not yet calculated"}</p>
            <p>Assessment: {query.data?.status ?? (query.isLoading ? "Loading" : "Unavailable")}</p>
          </div>
          <div className="mt-4 grid gap-4 border-t pt-3 lg:grid-cols-[3fr_4fr]" style={{ borderColor: COLORS.line }}>
            <div>
              <h3 className="text-xs font-semibold" style={{ color: COLORS.ink }}>Index averages</h3>
              {query.data?.indices.map((item) => (
                <p key={item.symbol} className="mt-2 text-[11px] tabular-nums" style={{ color: COLORS.muted }}>
                  <span className="font-semibold" style={{ color: COLORS.ink }}>{item.symbol}</span> · Close {price(item.close)} · EMA21 {price(item.ema21)} · SMA50 {price(item.sma50)} · SMA200 {price(item.sma200)}
                </p>
              ))}
            </div>
            <div>
              <h3 className="text-xs font-semibold" style={{ color: COLORS.ink }}>Sector ETF SMA50 evidence</h3>
              <div className="mt-1 grid gap-x-4 sm:grid-cols-2">
                {query.data?.sectors.map((item) => (
                  <p key={item.symbol} className="mt-1 text-[11px] tabular-nums" style={{ color: COLORS.muted }}>
                    <span className="font-semibold" style={{ color: COLORS.ink }}>{item.symbol}</span> · Close {price(item.close)} · SMA50 {price(item.sma50)}{item.unavailable_reason ? ` · ${item.unavailable_reason}` : ""}
                  </p>
                ))}
              </div>
            </div>
          </div>
          {query.data?.previous_assessment && query.data.posture == null && (
            <p className="mt-3 border-t pt-3 text-xs" style={{ borderColor: COLORS.line, color: COLORS.muted }}>
              Previous assessment · {query.data.previous_assessment.posture} · {query.data.previous_assessment.evidence_session}
            </p>
          )}
          <div className="mt-3 flex items-center gap-2 text-[11px]" style={{ color: COLORS.muted }}><RefreshCw size={12} aria-hidden="true" /> Updates automatically after the regular-session close and when the feed reconnects.</div>
        </details>
      </div>
    </div>
  );
}
