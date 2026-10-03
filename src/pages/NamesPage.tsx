import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { parallaxApi, type RSLeader, type RSRating, type SearchResult, type WatchlistInfo } from "@/modules/parallax/api";
import { useIbkrReady } from "@/context/GatewayContext";
import { useLiveQuotes } from "@/hooks/useLiveQuotes";
import { useRSRatings } from "@/hooks/useRSRatings";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useNavigationStore } from "@/store/navigation";
import { PublishedRating, PublishedSourceNotice } from "@/components/parallax/PublishedRating";
import ScreenerPage from "./ScreenerPage";
import "./NamesPage.css";

const leadersQueryKey = ["parallax", "rs-leaders"] as const;
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

function NamesTable({
  rows,
  ratings,
  ratingsLoading = false,
  ratingsError = false,
  quotes,
  onOpen,
  action,
}: {
  rows: { conid: number; symbol: string; companyName?: string; sector?: string | null }[];
  ratings: (RSRating | RSLeader)[];
  ratingsLoading?: boolean;
  ratingsError?: boolean;
  quotes: Map<number, { last: number; availability?: string }>;
  onOpen: (conid: number, symbol: string) => void;
  action?: (row: { conid: number; symbol: string; companyName?: string; sector?: string | null }) => React.ReactNode;
}) {
  const ratingMap = new Map(ratings.map((rating) => [rating.conid, rating]));
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border-1)]">
      <table className="w-full text-left text-xs">
        <thead className="bg-[var(--surface-2)] text-[var(--text-3)]">
          <tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Sector</th><th className="px-3 py-2">IBKR price</th><th className="px-3 py-2">Fred published RS percentile</th><th className="px-3 py-2" /></tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const rating = ratingMap.get(row.conid);
            const quote = quotes.get(row.conid);
            return <tr key={row.conid} className="border-t border-[var(--border-1)] hover:bg-[var(--surface-2)]">
              <td className="px-3 py-2">
                <button className="font-semibold text-[var(--text-1)] hover:text-[var(--clr-cyan)]" onClick={() => onOpen(row.conid, row.symbol)}>{row.symbol}</button>
                {row.companyName && <div className="mt-0.5 text-[var(--text-3)]">{row.companyName}</div>}
              </td>
              <td className="px-3 py-2 text-[var(--text-2)]">{row.sector || rating?.sector || "—"}</td>
              <td className="px-3 py-2 font-data tabular-nums">
                {quote && Number.isFinite(quote.last) && ["R", "D", "Y", "Z"].includes(quote.availability?.[0] ?? "")
                  ? <span aria-label={`${quote.availability?.[0] === "R" ? "Real-time" : quote.availability?.[0] === "Z" ? "Frozen" : "Delayed"} IBKR quote`}>
                      {money(quote.last)} <span className="font-sans text-[10px] text-[var(--text-3)]">{quote.availability?.[0] === "R" ? "Real-time" : quote.availability?.[0] === "Z" ? "Frozen" : "Delayed"}</span>
                    </span>
                  : quote?.availability?.[0] === "N" ? "Unavailable" : "Feed unconfirmed"}
              </td>
              <td className="px-3 py-2"><PublishedRating rating={rating} loading={ratingsLoading} lookupFailed={ratingsError} /></td>
              <td className="px-3 py-2 text-right">{action?.(row)}</td>
            </tr>;
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
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: leadersQueryKey,
    queryFn: ({ signal }) => parallaxApi.rsLeaders(signal),
    enabled: isAuthenticated,
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
  });
  const refresh = useMutation({
    mutationFn: ({ signal }: { signal: AbortSignal }) => parallaxApi.refreshRSLeaders(signal),
    onSuccess: async (result) => {
      queryClient.setQueryData(leadersQueryKey, result);
      await queryClient.invalidateQueries({ queryKey: ["parallax", "rs-ratings"] });
    },
  });
  const activeRefresh = useRef<AbortController | null>(null);
  const runRefresh = useMemo(() => () => {
    const controller = new AbortController();
    activeRefresh.current?.abort();
    activeRefresh.current = controller;
    refresh.mutate({ signal: controller.signal }, {
      onSettled: () => {
        if (activeRefresh.current === controller) activeRefresh.current = null;
      },
    });
  }, [refresh.mutate]);
  useEffect(() => {
    if (!isAuthenticated) return;
    runRefresh();
    return () => {
      activeRefresh.current?.abort();
      activeRefresh.current = null;
    };
  }, [isAuthenticated, sessionEpoch, runRefresh]);

  const membership = useWatchlistMembership(isAuthenticated, sessionEpoch);
  const [candidate, setCandidate] = useState<(RSLeader & { conid: number }) | null>(null);
  const [destinationId, setDestinationId] = useState("");
  useEffect(() => {
    setCandidate(null);
    setDestinationId("");
  }, [sessionEpoch]);

  const rows = (data?.items ?? []).filter((item): item is RSLeader & { conid: number } => item.conid != null);
  const quotes = useLiveQuotes(rows.map((row) => row.conid));
  const navigateToAnalysis = useNavigationStore((state) => state.navigateToAnalysis);
  const destination = lists.find((list) => list.id === destinationId);
  const mutationForCandidate = membership.variables?.conid === candidate?.conid;
  const refreshError = refresh.isError && refresh.error?.name !== "AbortError";

  return <section className="space-y-3">
    {data && <PublishedSourceNotice freshness={data.freshness} publishedAt={data.source_published_at} sourceStatus={data.status} />}
    {(error && error.name !== "AbortError" || refreshError) && <p role="alert" className="text-xs text-[var(--clr-orange)]">Fred’s source could not be checked. The saved snapshot remains available when present.</p>}
    {data?.issues.map((issue) => <p key={issue} className="text-xs text-[var(--text-3)]">{issue}</p>)}
    <div className="flex items-center justify-between text-xs text-[var(--text-3)]">
      <span>{isLoading ? "Loading saved snapshot…" : `${rows.length} resolved leaders · ${data?.eligible_count ?? 0} eligible`}</span>
      <button className="rounded border border-[var(--border-1)] px-2.5 py-1.5 text-[var(--text-1)] disabled:opacity-50" onClick={runRefresh} disabled={!isAuthenticated || refresh.isPending}>{refresh.isPending ? "Checking source…" : "Scan again"}</button>
    </div>
    {isLoading && !data && <p role="status" className="text-xs text-[var(--text-3)]">Loading published leaders…</p>}
    {error && !data && error.name !== "AbortError" && <p role="alert" className="text-xs text-[var(--clr-orange)]">Published leaders could not be loaded.</p>}
    {data && rows.length === 0 && <p role="status" className="text-xs text-[var(--text-3)]">{data.eligible_count ? "No leaders currently have a verified US listing." : "No eligible leaders in this published snapshot."}</p>}
    {rows.length > 0 && <NamesTable
      rows={rows.map((row) => ({ conid: row.conid, symbol: row.symbol, sector: row.sector }))}
      ratings={rows}
      quotes={quotes}
      onOpen={(conid, symbol) => navigateToAnalysis(conid, symbol)}
      action={(row) => <button className="text-[var(--clr-cyan)]" onClick={() => { setCandidate(rows.find((item) => item.conid === row.conid) ?? null); setDestinationId(""); membership.reset(); }}>Add to IBKR watchlist</button>}
    />}
    {candidate && <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border-1)] bg-[var(--surface-1)] px-3 py-2 text-xs" aria-label="Add leader to watchlist">
      <span>Add {candidate.symbol} to an IBKR watchlist</span>
      {!listsReady && !listsError && <span role="status">Loading watchlists…</span>}
      {listsError && <span role="alert">Watchlists could not be loaded.</span>}
      {listsReady && lists.length === 0 && <span role="status">No saved IBKR watchlists are available.</span>}
      {listsReady && lists.length > 0 && <>
        <label className="sr-only" htmlFor="leader-destination">Destination watchlist</label>
        <select id="leader-destination" aria-label="Destination watchlist" className="rounded border border-[var(--border-1)] bg-[var(--surface-1)] px-2 py-1.5" value={destinationId} onChange={(event) => { setDestinationId(event.target.value); membership.reset(); }}>
          <option value="">Choose a watchlist</option>
          {lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}
        </select>
        <button className="rounded border border-[var(--border-1)] px-2.5 py-1.5 disabled:opacity-50" disabled={!isAuthenticated || !destination || membership.isPending} onClick={() => destination && membership.change("add", destination.id, candidate.conid)}>
          {membership.isPending && mutationForCandidate ? "Adding…" : "Add to IBKR watchlist"}
        </button>
      </>}
      {membership.isPending && mutationForCandidate && <span role="status">Adding {candidate.symbol}…</span>}
      {membership.isSuccess && mutationForCandidate && membership.data && <span role="status">{"added" in membership.data && membership.data.added ? `Added ${candidate.symbol} to ${destination?.name ?? "watchlist"}.` : `${candidate.symbol} is already in that watchlist.`}</span>}
      {membership.isError && mutationForCandidate && membership.error.name !== "AbortError" && <span role="alert">Watchlist update failed: {membership.error.message}</span>}
    </div>}
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
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-xs text-[var(--text-3)]" htmlFor="rs-watchlist">Watchlist</label>
      <select id="rs-watchlist" className="rounded border border-[var(--border-1)] bg-[var(--surface-1)] px-2 py-1.5 text-xs" value={selected?.id ?? ""} disabled={!listsReady} onChange={(event) => setNamesContext({ selectedWatchlistId: event.target.value })}>
        {lists.map((list) => <option value={list.id} key={list.id}>{list.name}</option>)}
      </select>
      <input aria-label="Filter watchlist" className="min-w-36 flex-1 rounded border border-[var(--border-1)] bg-[var(--surface-1)] px-2 py-1.5 text-xs" value={filter} onChange={(event) => setNamesContext({ watchlistFilter: event.target.value })} placeholder="Filter names" />
    </div>
    <PublishedSourceNotice freshness={ratings.freshness} publishedAt={ratings.sourcePublishedAt} sourceStatus={ratings.sourceStatus} isLoading={ratings.isLoading} isError={ratings.isError} />
    {instruments.isPending && !instruments.data && <p role="status" className="text-xs text-[var(--text-3)]">Loading names…</p>}
    {instruments.isError && <p role="alert" className="text-xs text-[var(--clr-orange)]">Could not load this watchlist. {instruments.data ? "Showing the last loaded membership." : "Membership is unavailable."}</p>}
    {instruments.isSuccess && rows.length === 0 && <p role="status" className="text-xs text-[var(--text-3)]">This watchlist has no names.</p>}
    {rows.length > 0 && filtered.length === 0 && <p role="status" className="text-xs text-[var(--text-3)]">No watchlist names match this filter.</p>}
    {filtered.length > 0 && <NamesTable rows={filtered} ratings={ratings.items} ratingsLoading={ratings.isLoading} ratingsError={ratings.isError} quotes={quotes} onOpen={(conid, symbol) => navigateToAnalysis(conid, symbol)} action={(row) => <button className="text-[var(--text-2)] hover:text-[var(--clr-red)] disabled:opacity-50" disabled={!isAuthenticated || !listsReady || !instruments.data || membershipChange.isPending} onClick={() => selected && membershipChange.change("remove", selected.id, row.conid)}>Remove</button>} />}
    {membershipChange.isError && membershipChange.error.name !== "AbortError" && <p role="alert" className="text-xs text-[var(--clr-red)]">Watchlist update failed: {membershipChange.error.message}</p>}
    <details className="rounded-lg border border-[var(--border-1)] p-3">
      <summary className="cursor-pointer text-xs font-medium">Add a stock to this watchlist</summary>
      <div className="mt-3 flex gap-2">
        <input aria-label="Search stocks to add" className="min-w-0 flex-1 rounded border border-[var(--border-1)] bg-[var(--surface-1)] px-2 py-1.5 text-xs" value={search} onChange={(event) => { searchRequest.current += 1; searchController.current?.abort(); setSearch(event.target.value); setSearchResults([]); setSearchState("idle"); }} onKeyDown={(event) => { if (event.key === "Enter") void doSearch(); }} placeholder="Search a stock" />
        <button className="rounded border border-[var(--border-1)] px-3 text-xs disabled:opacity-50" disabled={!isAuthenticated || searchState === "loading"} onClick={() => void doSearch()}>{searchState === "loading" ? "Searching…" : "Search"}</button>
      </div>
      {searchState === "loading" && <p role="status" className="mt-2 text-xs text-[var(--text-3)]">Searching IBKR stocks…</p>}
      {searchState === "empty" && <p role="status" className="mt-2 text-xs text-[var(--text-3)]">No matching stocks found.</p>}
      {searchState === "error" && <p role="alert" className="mt-2 flex items-center gap-2 text-xs text-[var(--clr-red)]">Stock search failed.<button className="underline" onClick={() => void doSearch()}>Retry</button></p>}
      {searchResults.map((item) => <div key={item.conid} className="flex items-center justify-between border-t border-[var(--border-1)] py-2 text-xs">
        <span>{item.symbol} · {item.companyName}</span>
        <button className="text-[var(--clr-cyan)] disabled:opacity-50" disabled={!isAuthenticated || !listsReady || !instruments.data || membershipChange.isPending} onClick={() => selected && membershipChange.change("add", selected.id, item.conid)}>Add</button>
      </div>)}
    </details>
  </section>;
}

export default function NamesPage() {
  const mainTab = useNavigationStore((state) => state.namesContext.mainTab);
  const discoverTab = useNavigationStore((state) => state.namesContext.discoverTab);
  const sessionEpoch = useNavigationStore((state) => state.namesContext.brokerSessionEpoch);
  const setNamesContext = useNavigationStore((state) => state.setNamesContext);
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
    className="names-mineral h-full overflow-y-auto px-4 py-4 md:px-6"
  >
    <div className="mx-auto flex h-full max-w-6xl flex-col space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="font-data text-[10px] uppercase tracking-[0.16em] text-[var(--clr-cyan)]">Parallax · relative strength</p><h1 className="mt-1 text-xl font-semibold">Names</h1></div>
        <span className="text-[11px] text-[var(--text-3)]">Live IBKR quotes: {status === "connected" && upstreamStatus?.wsReady ? "connected" : "waiting"}</span>
      </header>
      <nav aria-label="Names views" className="flex gap-1 border-b border-[var(--border-1)]">
        {(["watchlist", "discover"] as const).map((tab) => <button key={tab} aria-pressed={mainTab === tab} className={`px-3 py-2 text-xs ${mainTab === tab ? "border-b-2 border-[var(--clr-cyan)] text-[var(--text-1)]" : "text-[var(--text-3)]"}`} onClick={() => setNamesContext({ mainTab: tab })}>{tab === "watchlist" ? "Watchlist" : "Discover"}</button>)}
      </nav>
      {mainTab === "watchlist" && (!isAuthenticated
        ? <p role="status" className="text-sm text-[var(--text-3)]">Connect to IBKR to view watchlists.</p>
        : listsQuery.isPending && !listsQuery.data
          ? <p role="status" className="text-sm text-[var(--text-3)]">Loading watchlists…</p>
          : listsQuery.isError && !listsQuery.data
            ? <p role="alert" className="text-sm text-[var(--clr-orange)]">Watchlists could not be loaded.</p>
            : <Watchlists lists={lists} isAuthenticated={isAuthenticated} sessionEpoch={sessionEpoch} listsReady={listsReady} />)}
      {mainTab === "discover" && <>
        <nav aria-label="Discover views" className="flex gap-4">
          <button aria-pressed={discoverTab === "leaders"} className={`rounded-md px-3 py-2 text-xs ${discoverTab === "leaders" ? "bg-[var(--surface-2)] font-semibold text-[var(--text-1)]" : "text-[var(--text-3)] hover:text-[var(--text-1)]"}`} onClick={() => setNamesContext({ discoverTab: "leaders" })}>Leaders</button>
          <button aria-pressed={discoverTab === "custom"} className={`rounded-md px-3 py-2 text-xs ${discoverTab === "custom" ? "bg-[var(--surface-2)] font-semibold text-[var(--text-1)]" : "text-[var(--text-3)] hover:text-[var(--text-1)]"}`} onClick={() => setNamesContext({ discoverTab: "custom" })}>Custom scan</button>
        </nav>
        {discoverTab === "leaders"
          ? <Leaders lists={lists} listsReady={listsReady} listsError={listsQuery.isError} isAuthenticated={isAuthenticated} sessionEpoch={sessionEpoch} />
          : <div className="names-custom-scan flex min-h-0 flex-1 flex-col overflow-hidden"><ScreenerPage /></div>}
      </>}
    </div>
  </main>;
}
