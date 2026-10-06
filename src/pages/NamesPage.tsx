import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { parallaxApi, type RSLeader, type RSRating, type SearchResult, type WatchlistInfo } from "@/modules/parallax/api";
import { useIbkrReady } from "@/context/GatewayContext";
import { useLiveQuotes } from "@/hooks/useLiveQuotes";
import { useRSRatings } from "@/hooks/useRSRatings";
import { useRSLeaders } from "@/hooks/useRSLeaders";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useNavigationStore } from "@/store/navigation";
import { PublishedRating, PublishedSourceNotice } from "@/components/parallax/PublishedRating";
import ScreenerPage from "./ScreenerPage";
import "./NamesPage.css";

const watchlistsQueryKey = ["watchlists", "parallax"] as const;

type MembershipAction = "add" | "remove";
type MembershipResult = { added: boolean; conid: number } | { removed: boolean; conid: number };
type MembershipVariables = { action: MembershipAction; watchlistId: string; conid: number; sessionEpoch: number };

function useWatchlistMembership(isAuthenticated: boolean, sessionEpoch: number) {
  const queryClient = useQueryClient();
  const controllers = useRef(new Set<AbortController>());
  const ready = useRef(isAuthenticated);
  const previousEpoch = useRef(sessionEpoch);
  ready.current = isAuthenticated;

  useEffect(() => {
    if (!isAuthenticated || previousEpoch.current !== sessionEpoch) {
      controllers.current.forEach((controller) => controller.abort());
    }
    previousEpoch.current = sessionEpoch;
  }, [isAuthenticated, sessionEpoch]);
  useEffect(() => () => controllers.current.forEach((controller) => controller.abort()), []);

  const mutation = useMutation<MembershipResult, Error, MembershipVariables>({
    mutationFn: async ({ action, watchlistId, conid, sessionEpoch: requestedEpoch }) => {
      if (!ready.current || useNavigationStore.getState().namesContext.brokerSessionEpoch !== requestedEpoch) {
        throw new Error("IBKR session changed. Reopen this view before changing membership.");
      }
      const controller = new AbortController();
      controllers.current.add(controller);
      try {
        return action === "add"
          ? await parallaxApi.watchlistAddInstrument(watchlistId, conid, controller.signal)
          : await parallaxApi.watchlistRemoveInstrument(watchlistId, conid, controller.signal);
      } finally {
        controllers.current.delete(controller);
      }
    },
    onSuccess: (_result, { watchlistId, conid, sessionEpoch: requestedEpoch }) => {
      if (!ready.current || useNavigationStore.getState().namesContext.brokerSessionEpoch !== requestedEpoch) return;
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["watchlist-instruments", watchlistId] }),
        queryClient.invalidateQueries({ queryKey: ["watchlist-quotes", watchlistId] }),
        queryClient.invalidateQueries({ queryKey: ["watchlist-membership", conid] }),
        queryClient.invalidateQueries({ queryKey: ["watchlists"] }),
      ]);
    },
  });

  return {
    ...mutation,
    change: (action: MembershipAction, watchlistId: string, conid: number) =>
      mutation.mutate({ action, watchlistId, conid, sessionEpoch: useNavigationStore.getState().namesContext.brokerSessionEpoch }),
  };
}

function money(value: number | undefined): string {
  return value == null || !Number.isFinite(value) ? "—" : `$${value.toFixed(2)}`;
}

function transportLabel(status: string, upstreamStatus: { ibkrConnected?: boolean; wsReady: boolean } | null): string {
  if (status === "connecting") return "IBKR transport connecting";
  if (status !== "connected") return "IBKR transport disconnected";
  if (upstreamStatus?.ibkrConnected === false) return "IBKR session disconnected";
  if (upstreamStatus?.wsReady === false) return "IBKR transport disconnected";
  return "IBKR transport connected";
}

function NamesTable({
  rows,
  ratings,
  ratingsLoading = false,
  ratingsError = false,
  quotes,
  onOpen,
  action,
  detailsFor,
  details,
  detailsAnimated = false,
  detailsClosing = false,
}: {
  rows: { conid: number; symbol: string; companyName?: string; sector?: string | null }[];
  ratings: (RSRating | RSLeader)[];
  ratingsLoading?: boolean;
  ratingsError?: boolean;
  quotes: Map<number, { last: number; availability?: string }>;
  onOpen: (conid: number, symbol: string) => void;
  action?: (row: { conid: number; symbol: string; companyName?: string; sector?: string | null }) => React.ReactNode;
  detailsFor?: number | null;
  details?: (row: { conid: number; symbol: string; companyName?: string; sector?: string | null }) => React.ReactNode;
  detailsAnimated?: boolean;
  detailsClosing?: boolean;
}) {
  const [inspectedConid, setInspectedConid] = useState<number | null>(null);
  const ratingMap = new Map(ratings.map((rating) => [rating.conid, rating]));
  const showSector = rows.some((row) => row.sector || ratingMap.get(row.conid)?.sector);
  const columnCount = 4 + Number(showSector);
  const explanationFor = (rating: RSRating | RSLeader | undefined, lookupFailed: boolean) => {
    if (lookupFailed) return "The Fred rating lookup failed. Prices and existing charts may still be available.";
    if (!rating) return "No published RS percentile is available for this name. Prices and existing charts may still be available.";
    if ("status" in rating) {
      if (rating.status === "unverified") return "The listing could not be verified as the corresponding US security. Prices and existing charts may still be available.";
      if (rating.status === "not_published") return "This verified listing is absent from Fred’s published dataset. Prices and existing charts may still be available.";
      if (rating.status === "source_unavailable") return "Fred’s published dataset is unavailable. Prices and existing charts may still be available.";
    }
    return "Fred did not publish an RS percentile for this name. Prices and existing charts may still be available.";
  };
  return (
     <div className="overflow-x-auto rounded-lg border border-[var(--border-1)]">
      <table className="w-full text-left text-[13px]">
        <thead className="bg-[var(--surface-2)] text-xs text-[var(--text-3)]">
          <tr><th className="px-3 py-2">Name</th>{showSector && <th className="px-3 py-2">Sector</th>}<th className="px-3 py-2 text-right">IBKR price</th><th className="px-3 py-2"><span className="relative inline-flex items-center gap-1">RS percentile<details className="relative inline-block"><summary aria-label="Fred RS percentile definition" className="cursor-pointer list-none rounded px-1 text-[var(--text-2)] underline decoration-dotted">?</summary><span className="absolute left-0 top-full z-20 mt-1 w-56 rounded border border-[var(--border-1)] bg-[var(--surface-1)] p-2 font-normal normal-case shadow-md">Fred’s published 0–99 percentile. Orbit displays the published value without calculating a batch percentile.</span></details></span></th><th className="px-3 py-2" /></tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const rating = ratingMap.get(row.conid);
            const quote = quotes.get(row.conid);
            return <Fragment key={row.conid}><tr className="border-t border-[var(--border-1)] hover:bg-[var(--surface-2)]">
              <td className="px-3 py-2">
                <button className="font-semibold text-[var(--text-1)] hover:text-[var(--clr-cyan)]" onClick={() => onOpen(row.conid, row.symbol)}>{row.symbol}</button>
                {row.companyName && <div className="mt-0.5 text-[var(--text-3)]">{row.companyName}</div>}
              </td>
              {showSector && <td className="px-3 py-2 text-[var(--text-2)]">{row.sector || rating?.sector || "—"}</td>}
              <td className="px-3 py-2 text-right font-data tabular-nums">
                {quote && Number.isFinite(quote.last) && ["R", "D", "Y", "Z"].includes(quote.availability?.[0] ?? "")
                  ? <span aria-label={`${quote.availability?.[0] === "R" ? "Real-time" : quote.availability?.[0] === "Z" ? "Frozen" : "Delayed"} IBKR quote`}>
                      {money(quote.last)} <span className="font-sans text-xs text-[var(--text-3)]">{quote.availability?.[0] === "R" ? "Real-time" : quote.availability?.[0] === "Z" ? "Frozen" : "Delayed"}</span>
                    </span>
                  : quote?.availability?.[0] === "N" ? "Unavailable" : "Feed unconfirmed"}
              </td>
              <td className="px-3 py-2"><PublishedRating rating={rating} loading={ratingsLoading} lookupFailed={ratingsError} onInspect={() => setInspectedConid(inspectedConid === row.conid ? null : row.conid)} /></td>
              <td className="px-3 py-2 text-right">{action?.(row)}</td>
            </tr>{inspectedConid === row.conid && <tr className="border-b border-[var(--border-1)] bg-[var(--surface-2)]"><td colSpan={columnCount} className="px-3 py-2 text-xs text-[var(--text-2)]">{explanationFor(rating, ratingsError)} <button type="button" className="ml-2 underline" onClick={() => setInspectedConid(null)}>Close</button></td></tr>}{detailsFor === row.conid && details && <tr className="border-b border-[var(--border-1)]"><td colSpan={columnCount} className="px-3 pb-2"><div className="ml-auto w-fit max-w-full"><div className="names-picker-panel rounded-md border border-[var(--border-1)] bg-[var(--surface-1)] p-3 text-xs shadow-sm" data-pointer-open={detailsAnimated ? "true" : undefined} data-closing={detailsClosing ? "true" : undefined}>{details(row)}</div></div></td></tr>}</Fragment>;
          })}
        </tbody>
      </table>
    </div>
  );
}

function Leaders({
  lists,
  listsReady,
  listsError,
  isAuthenticated,
  sessionEpoch,
}: {
  lists: WatchlistInfo[];
  listsReady: boolean;
  listsError: boolean;
  isAuthenticated: boolean;
  sessionEpoch: number;
}) {
  const { data, isLoading, error, progress, refresh } = useRSLeaders(isAuthenticated);
  const refreshPhase = progress?.phase ?? null;
  const refreshError = progress?.error ?? null;

  const membership = useWatchlistMembership(isAuthenticated, sessionEpoch);
  const [candidate, setCandidate] = useState<(RSLeader & { conid: number }) | null>(null);
  const [destinationId, setDestinationId] = useState("");
  const pickerOpenedByPointer = useRef(false);
  const [animatePicker, setAnimatePicker] = useState(false);
  const [pickerClosing, setPickerClosing] = useState(false);
  const pickerCloseTimer = useRef<number | null>(null);
  const candidateTrigger = useRef<HTMLButtonElement | null>(null);
  const setNamesContext = useNavigationStore((state) => state.setNamesContext);
  useEffect(() => {
    setCandidate(null);
    setDestinationId("");
    setAnimatePicker(false);
    setPickerClosing(false);
    if (pickerCloseTimer.current != null) window.clearTimeout(pickerCloseTimer.current);
  }, [sessionEpoch]);
  useEffect(() => () => {
    if (pickerCloseTimer.current != null) window.clearTimeout(pickerCloseTimer.current);
  }, []);

  const closePicker = (animate = false) => {
    if (pickerCloseTimer.current != null) window.clearTimeout(pickerCloseTimer.current);
    if (!animate) {
      setCandidate(null);
      setAnimatePicker(false);
      setPickerClosing(false);
      candidateTrigger.current?.focus();
      return;
    }
    setPickerClosing(true);
    pickerCloseTimer.current = window.setTimeout(() => {
      setCandidate(null);
      setAnimatePicker(false);
      setPickerClosing(false);
      candidateTrigger.current?.focus();
      pickerCloseTimer.current = null;
    }, 100);
  };

  const snapshotUsable = !!data && (data.status === "available" || data.status === "stale") && !!data.source_revision;
  const sourceStatus = data?.status === "available" || data?.status === "stale" || data?.status === "unavailable" ? data.status : undefined;
  const rows = (snapshotUsable ? data.items : []).filter((item): item is RSLeader & { conid: number } => item.conid != null);
  const quotes = useLiveQuotes(rows.map((row) => row.conid));
  const navigateToAnalysis = useNavigationStore((state) => state.navigateToAnalysis);
  const destination = lists.find((list) => list.id === destinationId);
  const mutationForCandidate = membership.variables?.conid === candidate?.conid;
  const queryError = !!error && error.name !== "AbortError";
  const sourceCheckIssue = data?.issues.find((issue) => issue.startsWith("Fred source check failed"));
  const resolutionIssues = data?.issues.filter((issue) =>
    issue.startsWith("IBKR could not uniquely verify US listings for:")
    || issue.startsWith("Stopped after ")
    || / eligible leaders currently have verified US listings\./.test(issue),
  ) ?? [];
  const otherIssues = data?.issues.filter((issue) => issue !== sourceCheckIssue && !resolutionIssues.includes(issue)) ?? [];
  const updateFailure = !!refreshError || queryError || !!sourceCheckIssue;
  const loadingSnapshot = !snapshotUsable && isAuthenticated && (isLoading || !!refreshPhase || data?.status === "verifying");
  const sourceFailure = !isAuthenticated && !snapshotUsable || !loadingSnapshot && (updateFailure || data?.status === "unavailable");
  const showRecoveryActions = sourceFailure && (!snapshotUsable || updateFailure);

  return <section className="space-y-3">
    {snapshotUsable && <PublishedSourceNotice freshness={data.freshness} publishedAt={data.source_published_at} sourceStatus={sourceStatus} />}
    {snapshotUsable && updateFailure && <div role="alert" className="text-xs text-[var(--clr-orange)]">Leader update could not complete. Showing the saved results.{(refreshError || sourceCheckIssue) && <details className="ml-1 inline"><summary className="inline cursor-pointer underline">Details</summary><span className="ml-1">{refreshError || sourceCheckIssue}</span></details>}</div>}
    {snapshotUsable && resolutionIssues.length > 0 && <div role="status" className="flex flex-wrap items-center gap-x-2 text-xs text-[var(--text-3)]">
      <span>IBKR US listing verification incomplete: {rows.length} of {Math.min(30, data.eligible_count)} eligible leaders verified.</span>
      <details>
        <summary className="cursor-pointer underline decoration-dotted underline-offset-2">Resolution details</summary>
        <ul className="mt-1 list-inside list-disc">{resolutionIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
      </details>
    </div>}
    {snapshotUsable && otherIssues.map((issue) => <p key={issue} className="text-xs text-[var(--text-3)]">{issue}</p>)}
    <div className="flex items-center justify-between text-xs text-[var(--text-3)]">
      <span>{snapshotUsable ? `${rows.length} verified leaders · ${data.eligible_count} eligible` : ""}</span>
      <button className="parallax-press rounded border border-[var(--border-1)] px-2.5 py-1.5 text-[var(--text-1)] disabled:opacity-50" onClick={() => void refresh().catch(() => undefined)} disabled={!isAuthenticated || !!refreshPhase}>{refreshPhase ? "Checking…" : "Scan again"}</button>
    </div>
    {loadingSnapshot && <p role="status" className="text-xs text-[var(--text-3)]">{refreshPhase === "downloading" ? "Downloading and validating published rankings…" : refreshPhase === "verifying" || data?.status === "verifying" ? "Verifying stock listings with IBKR…" : isLoading ? "Loading saved Leader results…" : "Checking published rankings…"}</p>}
    {!isAuthenticated && !snapshotUsable && <p role="status" className="text-xs text-[var(--text-3)]">Connect to IBKR to resolve published Leader candidates.</p>}
    {!snapshotUsable && !loadingSnapshot && (queryError || refreshError || data?.status === "unavailable") && <p role="alert" className="text-xs text-[var(--clr-orange)]">Published Leader results are unavailable. {refreshError || "Retry, or open Watchlist or Custom scan."}</p>}
    {refreshPhase && snapshotUsable && <p role="status" className="text-[10px] text-[var(--text-3)]">{refreshPhase === "downloading" ? "Checking the published ranking source; saved results remain visible." : "Verifying US listings; saved results remain visible."}</p>}
    {snapshotUsable && rows.length === 0 && <p role="status" className="text-xs text-[var(--text-3)]">{data.eligible_count ? "No candidates in this snapshot have a verified US listing." : "This published snapshot has no names meeting the Leader criteria."}</p>}
    {showRecoveryActions && <div className="flex flex-wrap items-center gap-2 text-xs">
      <button className="rounded border border-[var(--border-1)] px-2.5 py-1.5 text-[var(--text-1)]" onClick={() => setNamesContext({ mainTab: "watchlist" })}>Open Watchlist</button>
      <button className="rounded border border-[var(--border-1)] px-2.5 py-1.5 text-[var(--text-1)]" onClick={() => setNamesContext({ mainTab: "discover", discoverTab: "custom" })}>Use Custom scan</button>
    </div>}
    {rows.length > 0 && <NamesTable
      rows={rows.map((row) => ({ conid: row.conid, symbol: row.symbol, sector: row.sector }))}
      ratings={rows}
      quotes={quotes}
      onOpen={(conid, symbol) => navigateToAnalysis(conid, symbol)}
      detailsFor={candidate?.conid}
      detailsAnimated={animatePicker}
      detailsClosing={pickerClosing}
      action={(row) => <button className="parallax-press text-[var(--clr-cyan)]" aria-expanded={candidate?.conid === row.conid} aria-controls={`leader-picker-${row.conid}`} onPointerDown={() => { pickerOpenedByPointer.current = true; }} onKeyDown={() => { pickerOpenedByPointer.current = false; }} onClick={(event) => {
        if (candidate?.conid === row.conid) {
          closePicker(pickerOpenedByPointer.current);
          pickerOpenedByPointer.current = false;
          return;
        }
        if (pickerCloseTimer.current != null) window.clearTimeout(pickerCloseTimer.current);
        setPickerClosing(false);
        candidateTrigger.current = event.currentTarget;
        setCandidate(rows.find((item) => item.conid === row.conid) ?? null);
        setDestinationId("");
        setAnimatePicker(pickerOpenedByPointer.current);
        pickerOpenedByPointer.current = false;
        membership.reset();
       }}>Add to IBKR watchlist</button>}
      details={(row) => <div id={`leader-picker-${row.conid}`} onKeyDown={(event) => { if (event.key === "Escape") closePicker(); }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold">Add {row.symbol} to an IBKR watchlist</span>
          <button type="button" className="text-[var(--text-2)] underline" onPointerDown={() => { pickerOpenedByPointer.current = true; }} onKeyDown={() => { pickerOpenedByPointer.current = false; }} onClick={() => { closePicker(pickerOpenedByPointer.current); pickerOpenedByPointer.current = false; }}>Close</button>
        </div>
        {!listsReady && !listsError && <p role="status" className="mt-2">Loading watchlists…</p>}
        {listsError && <p role="alert" className="mt-2 text-[var(--clr-red)]">Watchlists could not be loaded.</p>}
        {listsReady && lists.length === 0 && <p role="status" className="mt-2">No saved IBKR watchlists are available.</p>}
        {listsReady && lists.length > 0 && <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`leader-destination-${row.conid}`}>Destination watchlist</label>
          <select id={`leader-destination-${row.conid}`} aria-label="Destination watchlist" className="rounded border border-[var(--border-1)] bg-[var(--surface-1)] px-2 py-1.5" value={destinationId} disabled={membership.isPending} onChange={(event) => { setDestinationId(event.target.value); membership.reset(); }}>
            <option value="">Choose a watchlist</option>
            {lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}
          </select>
          <button className="parallax-press rounded border border-[var(--border-1)] px-2.5 py-1.5 disabled:opacity-50" disabled={!isAuthenticated || !listsReady || !destination || membership.isPending} onClick={() => destination && membership.change("add", destination.id, row.conid)}>
            {membership.isPending && mutationForCandidate ? "Adding…" : "Confirm add"}
          </button>
        </div>}
        {membership.isPending && mutationForCandidate && <p role="status" className="mt-2">Adding {row.symbol}…</p>}
        {membership.isSuccess && mutationForCandidate && membership.data && <p role="status" className="names-membership-success mt-2">{"added" in membership.data && membership.data.added ? `Added ${row.symbol} to ${destination?.name ?? "watchlist"}.` : `${row.symbol} is already in that watchlist.`}</p>}
        {membership.isError && mutationForCandidate && membership.error.name !== "AbortError" && <p role="alert" className="mt-2 text-[var(--clr-red)]">Watchlist update failed: {membership.error.message}</p>}
      </div>}
    />}
  </section>;
}

function Watchlists({ lists, isAuthenticated, sessionEpoch, listsReady }: { lists: WatchlistInfo[]; isAuthenticated: boolean; sessionEpoch: number; listsReady: boolean }) {
  const selectedId = useNavigationStore((state) => state.namesContext.selectedWatchlistId);
  const filter = useNavigationStore((state) => state.namesContext.watchlistFilter);
  const setNamesContext = useNavigationStore((state) => state.setNamesContext);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchState, setSearchState] = useState<"idle" | "loading" | "results" | "empty" | "error">("idle");
  const searchController = useRef<AbortController | null>(null);
  const searchRequest = useRef(0);
  const selected = lists.find((list) => list.id === selectedId);
  useEffect(() => {
    if (listsReady && !lists.some((list) => list.id === selectedId)) {
      setNamesContext({ selectedWatchlistId: lists[0]?.id ?? "" });
    }
  }, [lists, listsReady, selectedId, setNamesContext]);
  useEffect(() => {
    if (!isAuthenticated) searchController.current?.abort();
    return () => searchController.current?.abort();
  }, [isAuthenticated, sessionEpoch]);

  const instruments = useQuery({
    queryKey: ["watchlist-instruments", selected?.id ?? "", "parallax", sessionEpoch],
    queryFn: ({ signal }) => parallaxApi.getWatchlistInstruments(selected!.id, signal),
    enabled: isAuthenticated && listsReady && !!selected,
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
  });
  const rows = instruments.data?.items ?? [];
  const ratings = useRSRatings(rows.map((row) => row.conid));
  const quotes = useLiveQuotes(rows.map((row) => row.conid));
  const navigateToAnalysis = useNavigationStore((state) => state.navigateToAnalysis);
  const membershipChange = useWatchlistMembership(isAuthenticated, sessionEpoch);
  const ratingMap = new Map(ratings.items.map((rating) => [rating.conid, rating]));
  const filtered = rows
    .filter((row) => `${row.symbol} ${row.companyName}`.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => {
      const left = ratingMap.get(a.conid)?.raw_strength;
      const right = ratingMap.get(b.conid)?.raw_strength;
      if (left == null && right == null) return a.symbol.localeCompare(b.symbol);
      if (left == null) return 1;
      if (right == null) return -1;
      return right - left;
    });
  const doSearch = async () => {
    const term = search.trim();
    if (!term || !isAuthenticated) return;
    searchController.current?.abort();
    const controller = new AbortController();
    searchController.current = controller;
    const requestId = ++searchRequest.current;
    setSearchResults([]);
    setSearchState("loading");
    try {
      const found = (await parallaxApi.search(term, controller.signal)).filter((item) => item.secType === "STK");
      if (requestId !== searchRequest.current) return;
      setSearchResults(found);
      setSearchState(found.length ? "results" : "empty");
    } catch (error) {
      if (controller.signal.aborted || requestId !== searchRequest.current || (error instanceof Error && error.name === "AbortError")) return;
      setSearchState("error");
    } finally {
      if (requestId === searchRequest.current) searchController.current = null;
    }
  };

  if (!isAuthenticated) return <p role="status" className="text-sm text-[var(--text-3)]">Connect to IBKR to view watchlists.</p>;
  if (listsReady && lists.length === 0) return <p role="status" className="text-sm text-[var(--text-3)]">No saved watchlists are available.</p>;
  return <section className="space-y-3">
    <div className="relative flex flex-wrap items-center gap-2">
      <label className="text-xs text-[var(--text-3)]" htmlFor="rs-watchlist">Watchlist</label>
      <select id="rs-watchlist" className="rounded border border-[var(--border-1)] bg-[var(--surface-1)] px-2 py-1.5 text-xs" value={selected?.id ?? ""} disabled={!listsReady} onChange={(event) => setNamesContext({ selectedWatchlistId: event.target.value })}>
        {lists.map((list) => <option value={list.id} key={list.id}>{list.name}</option>)}
      </select>
      <input aria-label="Filter watchlist" className="min-w-36 flex-1 rounded border border-[var(--border-1)] bg-[var(--surface-1)] px-2 py-1.5 text-xs" value={filter} onChange={(event) => setNamesContext({ watchlistFilter: event.target.value })} placeholder="Filter names" />
      <details className="relative">
        <summary className="parallax-press cursor-pointer list-none rounded border border-[var(--border-1)] px-2.5 py-1.5 text-xs font-medium">Add stock</summary>
        <div className="absolute left-0 top-full z-30 mt-1 w-[min(26rem,calc(100vw-2rem))] rounded-md border border-[var(--border-1)] bg-[var(--surface-1)] p-3 shadow-md">
          <div className="flex gap-2">
            <input aria-label="Search stocks to add" className="min-w-0 flex-1 rounded border border-[var(--border-1)] bg-[var(--surface-1)] px-2 py-1.5 text-xs" value={search} onChange={(event) => { searchRequest.current += 1; searchController.current?.abort(); setSearch(event.target.value); setSearchResults([]); setSearchState("idle"); }} onKeyDown={(event) => { if (event.key === "Enter") void doSearch(); }} placeholder="Search a stock" />
            <button className="parallax-press rounded border border-[var(--border-1)] px-3 text-xs disabled:opacity-50" disabled={!isAuthenticated || searchState === "loading"} onClick={() => void doSearch()}>{searchState === "loading" ? "Searching…" : "Search"}</button>
          </div>
          {searchState === "loading" && <p role="status" className="mt-2 text-xs text-[var(--text-3)]">Searching IBKR stocks…</p>}
          {searchState === "empty" && <p role="status" className="mt-2 text-xs text-[var(--text-3)]">No matching stocks found.</p>}
          {searchState === "error" && <p role="alert" className="mt-2 flex items-center gap-2 text-xs text-[var(--clr-red)]">Stock search failed.<button className="underline" onClick={() => void doSearch()}>Retry</button></p>}
          <div className="max-h-48 overflow-y-auto">
            {searchResults.map((item) => <div key={item.conid} className="flex items-center justify-between border-t border-[var(--border-1)] py-2 text-xs">
              <span>{item.symbol} · {item.companyName}</span>
              <button className="text-[var(--clr-cyan)] disabled:opacity-50" disabled={!isAuthenticated || !listsReady || !instruments.data || membershipChange.isPending} onClick={() => selected && membershipChange.change("add", selected.id, item.conid)}>Add</button>
            </div>)}
          </div>
        </div>
      </details>
    </div>
    <PublishedSourceNotice freshness={ratings.freshness} publishedAt={ratings.sourcePublishedAt} sourceStatus={ratings.sourceStatus} isLoading={ratings.isLoading} isError={ratings.isError} />
    {instruments.isPending && !instruments.data && <p role="status" className="text-xs text-[var(--text-3)]">Loading names…</p>}
    {instruments.isError && <p role="alert" className="text-xs text-[var(--clr-orange)]">Could not load this watchlist. {instruments.data ? "Showing the last loaded membership." : "Membership is unavailable."}</p>}
    {instruments.isSuccess && rows.length === 0 && <p role="status" className="text-xs text-[var(--text-3)]">This watchlist has no names.</p>}
    {rows.length > 0 && filtered.length === 0 && <p role="status" className="text-xs text-[var(--text-3)]">No watchlist names match this filter.</p>}
    {filtered.length > 0 && <NamesTable rows={filtered} ratings={ratings.items} ratingsLoading={ratings.isLoading} ratingsError={ratings.isError} quotes={quotes} onOpen={(conid, symbol) => navigateToAnalysis(conid, symbol)} action={(row) => <button className="text-[var(--text-2)] hover:text-[var(--clr-red)] disabled:opacity-50" disabled={!isAuthenticated || !listsReady || !instruments.data || membershipChange.isPending} onClick={() => selected && membershipChange.change("remove", selected.id, row.conid)}>Remove</button>} />}
    {membershipChange.isError && membershipChange.error.name !== "AbortError" && <p role="alert" className="text-xs text-[var(--clr-red)]">Watchlist update failed: {membershipChange.error.message}</p>}
  </section>;
}

export default function NamesPage() {
  const mainTab = useNavigationStore((state) => state.namesContext.mainTab);
  const discoverTab = useNavigationStore((state) => state.namesContext.discoverTab);
  const sessionEpoch = useNavigationStore((state) => state.namesContext.brokerSessionEpoch);
  const setNamesContext = useNavigationStore((state) => state.setNamesContext);
  const customScan = mainTab === "discover" && discoverTab === "custom";
  const isAuthenticated = useIbkrReady();
  const scrollContainer = useRef<HTMLElement>(null);
  const listsQuery = useQuery({
    queryKey: [...watchlistsQueryKey, sessionEpoch],
    queryFn: ({ signal }) => parallaxApi.getWatchlists(signal),
    enabled: isAuthenticated,
    staleTime: 0,
    retry: false,
  });
  const lists = useMemo(() => isAuthenticated ? listsQuery.data ?? [] : [], [isAuthenticated, listsQuery.data]);
  const listsReady = isAuthenticated && listsQuery.isSuccess;
  const { status, upstreamStatus } = useWebSocket();

  useLayoutEffect(() => {
    if (scrollContainer.current) scrollContainer.current.scrollTop = useNavigationStore.getState().namesContext.scrollTop;
  }, []);

  return <main
    ref={scrollContainer}
    onScroll={(event) => useNavigationStore.getState().setNamesContext({ scrollTop: event.currentTarget.scrollTop })}
    className={`names-mineral h-full ${customScan ? "overflow-hidden px-2 py-2 md:px-3" : "overflow-y-auto px-4 py-4 md:px-6"}`}
  >
    <div className={`mx-auto flex flex-col ${customScan ? "h-full min-h-0 w-full max-w-none gap-1" : "min-h-full max-w-6xl space-y-4"}`}>
      <header className={`flex flex-wrap justify-between ${customScan ? "items-center gap-2" : "items-end gap-3"}`}>
       <h1 className={`${customScan ? "text-xl" : "text-2xl"} font-semibold`}>Names</h1>
        <span className="text-[11px] text-[var(--text-3)]">{transportLabel(status, upstreamStatus)}</span>
      </header>
       <nav aria-label="Names views" className={`flex gap-1 border-b border-[var(--border-1)] ${customScan ? "-mb-1" : ""}`}>
         {(["watchlist", "discover"] as const).map((tab) => <button key={tab} aria-pressed={mainTab === tab} className={`px-3 py-2 text-[13px] ${mainTab === tab ? "border-b-2 border-[var(--clr-cyan)] text-[var(--text-1)]" : "text-[var(--text-3)]"}`} onClick={() => setNamesContext({ mainTab: tab })}>{tab === "watchlist" ? "Watchlist" : "Discover"}</button>)}
      </nav>
      {mainTab === "watchlist" && (!isAuthenticated
        ? <p role="status" className="text-sm text-[var(--text-3)]">Connect to IBKR to view watchlists.</p>
        : listsQuery.isPending && !listsQuery.data
          ? <p role="status" className="text-sm text-[var(--text-3)]">Loading watchlists…</p>
          : listsQuery.isError && !listsQuery.data
            ? <p role="alert" className="text-sm text-[var(--clr-orange)]">Watchlists could not be loaded.</p>
            : <Watchlists lists={lists} isAuthenticated={isAuthenticated} sessionEpoch={sessionEpoch} listsReady={listsReady} />)}
      {mainTab === "discover" && <>
        <nav aria-label="Discover views" className={`flex gap-2 ${customScan ? "pb-0" : "gap-4"}`}>
           <button aria-pressed={discoverTab === "leaders"} className={`rounded-md px-3 ${customScan ? "py-1" : "py-2"} text-[13px] ${discoverTab === "leaders" ? "bg-[var(--surface-2)] font-semibold text-[var(--text-1)]" : "text-[var(--text-3)] hover:text-[var(--text-1)]"}`} onClick={() => setNamesContext({ discoverTab: "leaders" })}>Leaders</button>
           <button aria-pressed={discoverTab === "custom"} className={`rounded-md px-3 ${customScan ? "py-1" : "py-2"} text-[13px] ${discoverTab === "custom" ? "bg-[var(--surface-2)] font-semibold text-[var(--text-1)]" : "text-[var(--text-3)] hover:text-[var(--text-1)]"}`} onClick={() => setNamesContext({ discoverTab: "custom" })}>Custom scan</button>
        </nav>
        {discoverTab === "leaders"
          ? <Leaders lists={lists} listsReady={listsReady} listsError={listsQuery.isError} isAuthenticated={isAuthenticated} sessionEpoch={sessionEpoch} />
          : <div className="names-custom-scan flex min-h-0 flex-1 flex-col overflow-hidden"><ScreenerPage /></div>}
      </>}
    </div>
  </main>;
}
