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
    : `${participation.available} of 11 sector readings; ${participation.possible_above_min}–${participation.possible_above_max} could be above SMA50.`;
  const session = assessment.evidence_session;
  if (currentSession && session && assessment.status === "complete") {
    return `${session} completed · ${indexSummary} ${sectorSummary}`;
  }
  if (currentSession && session) return `Partial ${session} · ${indexSummary} ${sectorSummary}`;
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

function distance(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function EvidenceMap({
  items,
  quotes,
  onOpen,
}: {
  items: MarketInstrumentEvidence[];
  quotes: Map<number, { last: number; availability?: string }>;
  onOpen: (conid: number, symbol: string) => void;
}) {
  const distances = items.flatMap((item) => [item.ema21_distance_pct, item.sma50_distance_pct])
    .filter((value): value is number => value != null && Number.isFinite(value));
  const maxDistance = Math.max(0, ...distances.map(Math.abs));
  const extent = maxDistance === 0 ? 1 : Math.ceil(maxDistance * 1.08 * 2) / 2;
  const position = (value: number) => `${((value + extent) / (2 * extent)) * 100}%`;
  return <section className="border-y py-3" style={{ borderColor: COLORS.line }} aria-label="Index evidence map">
    <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="text-sm font-semibold">Index evidence map</h2>
        <p className="text-[13px]" style={{ color: COLORS.muted }}>Completed daily close relative to EMA21 and SMA50 · {items[0]?.session_date ?? "session date unconfirmed"}</p>
      </div>
      <div className="flex items-center gap-3 text-[11px]" style={{ color: COLORS.muted }} aria-label="Evidence map legend">
        <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full" style={{ background: COLORS.accent }} />EMA21</span>
        <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 border-2" style={{ borderColor: COLORS.accent }} />SMA50</span>
        <span>0% close equals average</span>
      </div>
    </div>
    {distances.length > 0 && <div className="mb-0.5 grid grid-cols-[minmax(82px,112px)_minmax(90px,1fr)_minmax(116px,170px)] items-center gap-3 text-xs tabular-nums sm:grid-cols-[minmax(110px,150px)_minmax(100px,1fr)_minmax(150px,210px)]">
      <span />
      <div className="flex justify-between" style={{ color: COLORS.muted }}><span>{distance(-extent)}</span><span>0%</span><span>{distance(extent)}</span></div>
      <span className="text-right" style={{ color: COLORS.muted }}>EMA21 · SMA50</span>
    </div>}
    {items.map((item) => {
      const ema = item.ema21_distance_pct;
      const sma = item.sma50_distance_pct;
      const quote = item.conid == null ? undefined : quotes.get(item.conid);
      const mapLabel = `${item.symbol}: EMA21 ${distance(ema)}, SMA50 ${distance(sma)}`;
      return <div key={item.symbol} className="grid grid-cols-[minmax(82px,112px)_minmax(90px,1fr)_minmax(116px,170px)] items-center gap-3 border-t py-1 sm:grid-cols-[minmax(110px,150px)_minmax(100px,1fr)_minmax(150px,210px)]" style={{ borderColor: COLORS.line }}>
        <div className="min-w-0">
          {item.conid ? <button type="button" onClick={() => onOpen(item.conid!, item.symbol)} className="font-semibold hover:underline">{item.symbol}<ArrowUpRight className="ml-0.5 inline" size={12} aria-hidden="true" /></button> : <span className="font-semibold">{item.symbol}</span>}
          <span className="block truncate text-xs tabular-nums" style={{ color: COLORS.muted }}>{price(quote?.last)} · {quoteState(quote?.availability)}</span>
        </div>
        {distances.length > 0 ? <div role="img" aria-label={mapLabel} className="relative h-7">
          <span className="absolute inset-x-0 top-1/2 border-t" style={{ borderColor: COLORS.line }} aria-hidden="true" />
          <span className="absolute inset-y-1 left-1/2 border-l" style={{ borderColor: COLORS.line }} aria-hidden="true" />
          {ema != null && Number.isFinite(ema) && <span title={`${item.symbol} EMA21 ${distance(ema)}`} className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: position(ema), background: COLORS.accent }} aria-hidden="true" />}
          {sma != null && Number.isFinite(sma) && <span title={`${item.symbol} SMA50 ${distance(sma)}`} className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 border-2 bg-white" style={{ left: position(sma), borderColor: COLORS.accent }} aria-hidden="true" />}
        </div> : <span className="text-xs" style={{ color: COLORS.muted }}>{item.unavailable_reason ?? "Average distance unavailable"}</span>}
        <span className="text-right font-mono text-xs tabular-nums" style={{ color: COLORS.ink }}>● {distance(ema)} <span aria-hidden="true">·</span> □ {distance(sma)}</span>
      </div>;
    })}
  </section>;
}

function SectorParticipation({
  items,
  participation,
  session,
  onOpen,
}: {
  items: MarketInstrumentEvidence[];
  participation?: MarketAssessmentResponse["participation"];
  session?: string | null;
  onOpen: (conid: number, symbol: string) => void;
}) {
  const possible = participation && participation.missing > 0
    ? `${participation.possible_above_min}–${participation.possible_above_max} of 11 possible above SMA50`
    : participation ? `${participation.confirmed_above} of 11 above SMA50` : "Participation unavailable";
  return <section className="border-b pb-3" style={{ borderColor: COLORS.line }} aria-label="Sector ETF participation">
    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-sm font-semibold">Sector participation <span className="ml-1 text-xs font-normal" style={{ color: COLORS.muted }}>11 ETF proxies · not individual-stock breadth · {session ?? "date unconfirmed"}</span></h2>
      <span className="text-xs tabular-nums" style={{ color: COLORS.accent }}>{possible} · {participation?.missing ?? 11} missing</span>
    </div>
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => {
        const state = item.above_sma50 == null ? "Missing" : item.above_sma50 ? "Above SMA50" : "At/below SMA50";
        const className = `min-h-8 rounded border px-2 text-xs ${item.above_sma50 == null ? "" : item.above_sma50 ? "font-semibold" : ""}`;
        const style = { color: item.above_sma50 ? COLORS.accent : COLORS.muted, borderColor: COLORS.line, background: item.above_sma50 ? "#E8EFF2" : COLORS.surface };
        return item.conid
          ? <button key={item.symbol} type="button" title={`${item.symbol}: ${state}`} aria-label={`${item.symbol}: ${state}`} className={className} style={style} onClick={() => onOpen(item.conid!, item.symbol)}>{item.symbol}</button>
          : <span key={item.symbol} title={`${item.symbol}: ${state}`} className={className} style={style}>{item.symbol}</span>;
      })}
    </div>
  </section>;
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
    <div className="h-full overflow-y-auto p-4 sm:p-5" style={{ background: COLORS.background, color: COLORS.ink }}>
      <div className="mx-auto flex max-w-6xl flex-col gap-3">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
           <p className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: COLORS.accent }}>Market assessment</p>
            <h1 className="mt-1 text-[30px] font-semibold leading-tight tracking-tight">Market</h1>
          </div>
       <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" style={{ color: COLORS.muted }} role="status" aria-live="polite">
            <span>{transport}</span>
            <span aria-hidden="true">·</span>
            <span className={`h-2 w-2 rounded-full ${quoteEvidence.kind === "live" ? "bg-emerald-600" : "bg-amber-500"}`} aria-hidden="true" />
            <span>{quoteEvidence.label}</span>
          </div>
        </header>

        <section className="border-y py-3" style={{ borderColor: COLORS.line }} aria-labelledby="market-posture">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <div className="flex items-center gap-2">
                <h2 id="market-posture" className="text-[30px] font-semibold leading-tight tracking-tight">{posture.title}</h2>
                {query.data?.status === "partial" && <span className="rounded-full px-2 py-1 text-[11px]" style={{ background: COLORS.background, color: COLORS.accent }}>Partial evidence</span>}
              </div>
              <p className="mt-1 text-sm" style={{ color: COLORS.muted }}>{posture.detail}</p>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                <p className="text-sm font-semibold" style={{ color: COLORS.accent }}>{posture.priority}</p>
                <button type="button" onClick={() => navigate("screener")} className="parallax-press inline-flex min-h-8 items-center gap-1 text-xs font-semibold underline decoration-dotted underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" style={{ color: COLORS.accent }}>
                  Explore strong names <ArrowUpRight size={13} aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="min-w-36 px-1 py-1 text-right">
              <p className="text-[11px] uppercase tracking-wide" style={{ color: COLORS.muted }}>Sector ETF proxy</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{range}</p>
              <p className="text-[11px]" style={{ color: COLORS.muted }}>above SMA50 · {rangeDate}</p>
            </div>
          </div>
          {!requestFailed && (query.data?.issues.length ?? 0) > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-x-2 border-y py-2 text-xs" style={{ borderColor: COLORS.line, color: COLORS.muted }} role="status">
              <span>{participation?.missing ? `${participation.missing} sector readings unavailable; the participation range is retained.` : "Some assessment evidence is unavailable."}</span>
              <details>
                <summary className="cursor-pointer underline decoration-dotted underline-offset-2">Data notes</summary>
                <ul className="mt-1 list-inside list-disc">{query.data?.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
              </details>
            </div>
          )}
        </section>

         {query.data?.indices
           ? <EvidenceMap items={query.data.indices} quotes={liveQuotes} onOpen={navigateToAnalysis} />
           : <section className="border-y py-4 text-sm" style={{ borderColor: COLORS.line, color: COLORS.muted }}>{query.isLoading ? "Loading completed-session evidence…" : "Connect to IBKR to load market evidence."}</section>}

        <SectorParticipation items={query.data?.sectors ?? []} participation={participation} session={query.data?.evidence_session} onOpen={navigateToAnalysis} />

        <section className="grid gap-x-6 gap-y-2 border-b py-3 sm:grid-cols-3" style={{ borderColor: COLORS.line }} aria-label="Available tactics">
          {[
            ["Pullbacks", currentPosture === "defensive" ? "Wait for support; waiting is valid" : currentPosture === "broad" ? "Available" : currentPosture === "selective" ? "Priority: strong names near support" : "Available; market priority unknown"],
            ["Breakouts", currentPosture === "broad" ? "Priority in broad strength" : currentPosture === "defensive" ? "Stay selective" : currentPosture === "selective" ? "Available with selection" : "Available; market priority unknown"],
            ["Breakout retests", currentPosture === "broad" ? "Priority in broad strength" : currentPosture === "defensive" ? "Wait for conditions to improve" : currentPosture === "selective" ? "Available with selection" : "Available; market priority unknown"],
          ].map(([name, note]) => (
            <article key={name} className="px-1 py-1">
              <h2 className="text-[13px] font-semibold">{name}</h2>
              <p className="mt-1 text-xs" style={{ color: COLORS.muted }}>{note}</p>
            </article>
          ))}
        </section>

        <details className="border-y py-3">
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
                <p key={item.symbol} className="mt-2 text-xs tabular-nums" style={{ color: COLORS.muted }}>
                  <span className="font-semibold" style={{ color: COLORS.ink }}>{item.symbol}</span> · Close {price(item.close)} · EMA21 {price(item.ema21)} ({distance(item.ema21_distance_pct)}) · SMA50 {price(item.sma50)} ({distance(item.sma50_distance_pct)}) · SMA200 context {price(item.sma200)}
                </p>
              ))}
            </div>
            <div>
              <h3 className="text-xs font-semibold" style={{ color: COLORS.ink }}>Sector ETF SMA50 evidence</h3>
              <div className="mt-1 grid gap-x-4 sm:grid-cols-2">
                {query.data?.sectors.map((item) => (
                  <p key={item.symbol} className="mt-1 text-xs tabular-nums" style={{ color: COLORS.muted }}>
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
