import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NamesPage from "./NamesPage";
import ScreenerResultsTable from "@/components/screener/ScreenerResultsTable";
import { useScreenerStore } from "@/store/screener";
import { useNavigationStore } from "@/store/navigation";
import type { SearchResult } from "@/modules/parallax/api";

const api = vi.hoisted(() => ({
  getWatchlists: vi.fn(),
  getWatchlistInstruments: vi.fn(),
  rsLeaders: vi.fn(),
  refreshRSLeaders: vi.fn(),
  rsRatings: vi.fn(),
  search: vi.fn(),
  watchlistAddInstrument: vi.fn(),
  watchlistRemoveInstrument: vi.fn(),
}));
const gateway = vi.hoisted(() => ({ ready: true }));

vi.mock("@/modules/parallax/api", () => ({ parallaxApi: api }));
vi.mock("@/hooks/useLiveQuotes", () => ({ useLiveQuotes: () => new Map([
  [101, { last: 101.25, availability: "RB" }],
  [201, { last: 37.5, availability: "R" }],
  [202, { last: 18.75, availability: "R" }],
]) }));
vi.mock("@/hooks/useWebSocket", () => ({ useWebSocket: () => ({ status: "connected", upstreamStatus: { wsReady: true } }) }));
vi.mock("@/context/GatewayContext", () => ({ useIbkrReady: () => gateway.ready }));
vi.mock("./ScreenerPage", async () => {
  const { useNavigationStore } = await import("@/store/navigation");
  return { default: () => <div>Existing custom scanner <button onClick={() => useNavigationStore.getState().navigateToAnalysis(401, "SCAN")}>Open custom result</button></div> };
});
vi.mock("@/hooks/useStockTags", () => ({ useStockTags: () => ({ data: {} }) }));

const leaders = {
  status: "available" as const,
  source_revision: "a".repeat(40),
  source_published_at: "2026-10-02T23:30:00Z",
  fetched_at: "2026-10-03T12:00:00Z",
  evidence_session: null,
  freshness: "unknown" as const,
  eligible_count: 2,
  items: [
    { conid: 101, symbol: "LEAD", sector: "Technology", raw_strength: 22, published_percentile: 0, source_price: 101, avg_volume_50: 600000, source_rank: 1 },
  ],
  issues: [],
};

beforeEach(() => {
  gateway.ready = true;
  api.getWatchlists.mockResolvedValue([]);
  api.rsLeaders.mockResolvedValue(leaders);
  api.refreshRSLeaders.mockResolvedValue(leaders);
  api.rsRatings.mockResolvedValue({ status: "unavailable", source_revision: null, source_published_at: null, evidence_session: null, freshness: "unknown", items: [] });
});

afterEach(() => {
  cleanup();
  Object.values(api).forEach((mock) => mock.mockReset());
  gateway.ready = true;
  useNavigationStore.setState({
    activeScreen: "screener",
    namesContext: { mainTab: "discover", discoverTab: "leaders", selectedWatchlistId: "", watchlistFilter: "", scrollTop: 0, brokerSessionEpoch: 0 },
  });
  useScreenerStore.setState({ results: [], totalScanned: 0, lastBatchSize: 0 });
});

function NamesNavigationHarness() {
  const activeScreen = useNavigationStore((state) => state.activeScreen);
  return activeScreen === "screener"
    ? <NamesPage />
    : <section><h1>Analysis / Compare</h1><button onClick={() => useNavigationStore.getState().navigate("screener")}>Return to Names</button></section>;
}

describe("NamesPage", () => {
  it("loads published leaders, preserves watchlist membership, and reuses the existing custom scan", async () => {
    api.getWatchlists.mockResolvedValue([{ id: "primary", name: "Primary" }, { id: "secondary", name: "Secondary" }]);
    api.getWatchlistInstruments.mockImplementation((id: string) => Promise.resolve({
      id, name: id, items: id === "primary" ? [
        { conid: 201, symbol: "WEAK", companyName: "Weak Co" },
        { conid: 202, symbol: "UNRATED", companyName: "No published value" },
      ] : [{ conid: 301, symbol: "SECOND", companyName: "Secondary Co" }],
    }));
    api.rsLeaders.mockResolvedValue(leaders);
    api.refreshRSLeaders.mockResolvedValue(leaders);
    api.rsRatings.mockImplementation((conids: number[]) => Promise.resolve({
      status: "stale",
      source_revision: leaders.source_revision, source_published_at: "2026-08-14T23:30:00Z",
      evidence_session: null, freshness: "stale",
      items: conids.map((conid) => conid === 201
        ? { conid, symbol: "WEAK", status: "rated", sector: "Industrials", raw_strength: -5, published_percentile: 0, source_price: 37, avg_volume_50: 510000 }
        : conid === 202
          ? { conid, symbol: "UNRATED", status: "not_published", sector: null, raw_strength: null, published_percentile: null, source_price: null, avg_volume_50: null }
          : { conid, symbol: "SECOND", status: "rated", sector: "Technology", raw_strength: 4, published_percentile: 70, source_price: 50, avg_volume_50: 600000 }),
    }));
    api.search.mockResolvedValue([{ conid: 203, symbol: "ADDED", companyName: "Added Co", secType: "STK" }]);
    let finishAdd!: (value: { added: boolean; conid: number }) => void;
    api.watchlistAddInstrument.mockImplementation(() => new Promise((resolve) => { finishAdd = resolve; }));
    api.watchlistRemoveInstrument.mockRejectedValue(new Error("broker unavailable"));

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    useNavigationStore.setState({ activeScreen: "screener" });
    render(<QueryClientProvider client={client}><NamesNavigationHarness /></QueryClientProvider>);

    expect(await screen.findByText(/Fred published snapshot.*price-session date unconfirmed/)).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Fred published RS percentile" })).toBeInTheDocument();
    expect(screen.getByLabelText("Fred published RS percentile: 0")).toBeInTheDocument();
    expect(screen.getByLabelText("Real-time IBKR quote")).toHaveTextContent("$101.25");
    expect(api.refreshRSLeaders).toHaveBeenCalledWith(expect.any(AbortSignal));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["parallax", "rs-ratings"] }));
    fireEvent.click(screen.getByRole("button", { name: "LEAD" }));
    expect(screen.getByRole("heading", { name: "Analysis / Compare" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Return to Names" }));
    expect(await screen.findByRole("button", { name: "LEAD" })).toBeInTheDocument();

    useScreenerStore.getState().replaceResults([
      { conid: 401, symbol: "SCAN", company_name: "Scanner result", sec_type: "STK", last_price: 5, change_percent: 2, volume: 1000, scan_data: null, scan_data_label: null },
    ], 1);
    fireEvent.click(screen.getByRole("button", { name: "Custom scan" }));
    expect(screen.getByText("Existing custom scanner")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open custom result" }));
    expect(screen.getByRole("heading", { name: "Analysis / Compare" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Return to Names" }));
    expect(await screen.findByText("Existing custom scanner")).toBeInTheDocument();
    expect(useNavigationStore.getState().namesContext.discoverTab).toBe("custom");
    expect(useScreenerStore.getState().results[0]?.symbol).toBe("SCAN");
    fireEvent.click(screen.getByRole("button", { name: "Watchlist" }));

    expect(await screen.findByRole("button", { name: "WEAK" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "UNRATED" })).toBeInTheDocument();
    expect(screen.getByLabelText("Fred published RS percentile: 0")).toBeInTheDocument();
    expect(screen.getByText(/Fred publication is stale.*published/)).toBeInTheDocument();
    expect(screen.getByText("Unavailable in Fred dataset")).toBeInTheDocument();
    expect(api.watchlistRemoveInstrument).not.toHaveBeenCalled();

    api.rsRatings.mockRejectedValueOnce(new Error("rating endpoint unavailable"));
    await act(async () => { await client.invalidateQueries({ queryKey: ["parallax", "rs-ratings"] }); });
    expect(await screen.findByText(/Fred rating lookup failed/)).toBeInTheDocument();
    expect(screen.getAllByText("Lookup failed")).toHaveLength(2);
    expect(screen.getByText(/Fred publication is stale.*published/)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Add a stock to this watchlist"));
    fireEvent.change(screen.getByRole("textbox", { name: "Search stocks to add" }), { target: { value: "ADDED" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText("ADDED · Added Co")).toBeInTheDocument();
    expect(api.watchlistAddInstrument).not.toHaveBeenCalled();
    const addButton = screen.getByRole("button", { name: "Add" });
    fireEvent.click(addButton);
    await waitFor(() => expect(api.watchlistAddInstrument).toHaveBeenCalledWith("primary", 203, expect.any(AbortSignal)));
    fireEvent.click(addButton);
    expect(api.watchlistAddInstrument).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByRole("combobox", { name: "Watchlist" }), { target: { value: "secondary" } });
    await screen.findByRole("button", { name: "SECOND" });
    await act(async () => { finishAdd({ added: true, conid: 203 }); });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["watchlist-instruments", "primary"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["watchlist-quotes", "primary"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["watchlist-membership", 203] });
    expect(screen.getByRole("combobox", { name: "Watchlist" })).toHaveValue("secondary");
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(await screen.findByText(/Watchlist update failed/)).toHaveTextContent("broker unavailable");
    await waitFor(() => expect(api.watchlistRemoveInstrument).toHaveBeenCalledWith("secondary", 301, expect.any(AbortSignal)));

    fireEvent.change(screen.getByRole("combobox", { name: "Watchlist" }), { target: { value: "primary" } });
    await screen.findByRole("button", { name: "WEAK" });
    fireEvent.change(screen.getByRole("textbox", { name: "Filter watchlist" }), { target: { value: "WEAK" } });
    const namesRoot = screen.getByRole("main");
    namesRoot.scrollTop = 180;
    fireEvent.scroll(namesRoot);
    fireEvent.click(screen.getByRole("button", { name: "WEAK" }));
    fireEvent.click(screen.getByRole("button", { name: "Return to Names" }));
    const restoredRoot = await screen.findByRole("main");
    expect(screen.getByRole("button", { name: "Watchlist" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("combobox", { name: "Watchlist" })).toHaveValue("primary");
    expect(screen.getByRole("textbox", { name: "Filter watchlist" })).toHaveValue("WEAK");
    expect(screen.getByRole("button", { name: "WEAK" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "UNRATED" })).not.toBeInTheDocument();
    expect(restoredRoot.scrollTop).toBe(180);

    client.clear();
  });

  it("enriches custom scanner rows from published ratings without eligibility filtering", async () => {
    api.rsRatings.mockResolvedValue({
      status: "stale",
      source_revision: leaders.source_revision, source_published_at: "2026-08-14T23:30:00Z",
      evidence_session: null, freshness: "stale",
      items: [
        { conid: 401, symbol: "LOW", status: "rated", sector: "Industrials", raw_strength: -12, published_percentile: 0, source_price: 4, avg_volume_50: 1000 },
        { conid: 402, symbol: "MISSING", status: "not_published", sector: null, raw_strength: null, published_percentile: null, source_price: null, avg_volume_50: null },
      ],
    });
    useScreenerStore.getState().replaceResults([
      { conid: 401, symbol: "LOW", company_name: "Low priced", sec_type: "STK", last_price: 4, change_percent: 1, volume: 1000, scan_data: null, scan_data_label: null },
      { conid: 402, symbol: "MISSING", company_name: "No ranking", sec_type: "STK", last_price: 2, change_percent: 0, volume: 10, scan_data: null, scan_data_label: null },
    ], 2);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><div className="names-mineral"><ScreenerResultsTable /></div></QueryClientProvider>);

    expect(await screen.findByLabelText("Fred published RS percentile: 0")).toBeInTheDocument();
    expect(screen.getByText("Unavailable in Fred dataset")).toBeInTheDocument();
    expect(screen.getByText(/Fred publication is stale.*published/)).toBeInTheDocument();
    expect(screen.getByText("LOW")).toBeInTheDocument();
    expect(screen.getByText("MISSING")).toBeInTheDocument();
    expect(api.rsRatings).toHaveBeenCalledWith([401, 402], expect.any(AbortSignal));
    client.clear();
  });

  it("distinguishes watchlist loading, empty, no-match and stock search outcomes without stale search results", async () => {
    useNavigationStore.setState({ namesContext: { ...useNavigationStore.getState().namesContext, mainTab: "watchlist" } });
    api.getWatchlists.mockResolvedValue([{ id: "primary", name: "Primary" }]);
    let finishInitial!: (value: { id: string; name: string; items: { conid: number; symbol: string; companyName: string }[] }) => void;
    api.getWatchlistInstruments.mockImplementationOnce(() => new Promise((resolve) => { finishInitial = resolve; }));
    let finishOldSearch!: (value: SearchResult[]) => void;
    api.search
      .mockImplementationOnce(() => new Promise((resolve) => { finishOldSearch = resolve; }))
      .mockResolvedValueOnce([{ conid: 503, symbol: "NEW", companyName: "New result", secType: "STK" }])
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("search unavailable"))
      .mockResolvedValueOnce([{ conid: 504, symbol: "RETRY", companyName: "Retry result", secType: "STK" }]);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><NamesNavigationHarness /></QueryClientProvider>);
    expect(await screen.findByText("Loading names…")).toBeInTheDocument();
    expect(screen.queryByText("This watchlist has no names.")).not.toBeInTheDocument();
    await act(async () => finishInitial({ id: "primary", name: "Primary", items: [] }));
    expect(await screen.findByText("This watchlist has no names.")).toBeInTheDocument();

    api.getWatchlistInstruments.mockResolvedValueOnce({ id: "primary", name: "Primary", items: [
      { conid: 502, symbol: "HELD", companyName: "Held name" },
    ] });
    await act(async () => { await client.invalidateQueries({ queryKey: ["watchlist-instruments", "primary"] }); });
    expect(await screen.findByRole("button", { name: "HELD" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Filter watchlist" }), { target: { value: "absent" } });
    expect(screen.getByText("No watchlist names match this filter.")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Add a stock to this watchlist"));
    const searchInput = screen.getByRole("textbox", { name: "Search stocks to add" });
    fireEvent.change(searchInput, { target: { value: "OLD" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText("Searching IBKR stocks…")).toBeInTheDocument();
    fireEvent.change(searchInput, { target: { value: "NEW" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText("NEW · New result")).toBeInTheDocument();
    await act(async () => finishOldSearch([{ conid: 501, symbol: "OLD", companyName: "Old result", secType: "STK" }]));
    expect(screen.queryByText("OLD · Old result")).not.toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: "NONE" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText("No matching stocks found.")).toBeInTheDocument();
    fireEvent.change(searchInput, { target: { value: "ERR" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText("Stock search failed.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("RETRY · Retry result")).toBeInTheDocument();
    client.clear();
  });

  it("requires a destination before adding a Leader and cancels refresh when Names unmounts", async () => {
    api.getWatchlists.mockResolvedValue([{ id: "primary", name: "Primary" }, { id: "secondary", name: "Secondary" }]);
    api.rsLeaders.mockResolvedValue(leaders);
    api.refreshRSLeaders.mockResolvedValue(leaders);
    api.watchlistAddInstrument.mockResolvedValue({ added: true, conid: 101 });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    render(<QueryClientProvider client={client}><NamesNavigationHarness /></QueryClientProvider>);
    expect(await screen.findByRole("button", { name: "Add to IBKR watchlist" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add to IBKR watchlist" }));
    const destination = screen.getByRole("combobox", { name: "Destination watchlist" });
    const unselectedAddButtons = screen.getAllByRole("button", { name: "Add to IBKR watchlist" });
    expect(unselectedAddButtons[unselectedAddButtons.length - 1]).toBeDisabled();
    expect(api.watchlistAddInstrument).not.toHaveBeenCalled();
    fireEvent.change(destination, { target: { value: "secondary" } });
    const addButtons = screen.getAllByRole("button", { name: "Add to IBKR watchlist" });
    const confirmedAdd = addButtons[addButtons.length - 1];
    fireEvent.click(confirmedAdd);
    expect(await screen.findByText("Added LEAD to Secondary.")).toBeInTheDocument();
    expect(api.watchlistAddInstrument).toHaveBeenCalledWith("secondary", 101, expect.any(AbortSignal));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["watchlist-instruments", "secondary"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["watchlist-membership", 101] });
    client.clear();
  });

  it("isolates matching watchlist IDs across broker sessions and ignores an old pending response", async () => {
    useNavigationStore.setState({ namesContext: { ...useNavigationStore.getState().namesContext, mainTab: "watchlist" } });
    api.getWatchlists.mockResolvedValue([{ id: "same-id", name: "Primary" }]);
    let finishOldMembership!: (value: { id: string; name: string; items: { conid: number; symbol: string; companyName: string }[] }) => void;
    api.getWatchlistInstruments
      .mockImplementationOnce(() => new Promise((resolve) => { finishOldMembership = resolve; }))
      .mockResolvedValueOnce({ id: "same-id", name: "Primary", items: [{ conid: 602, symbol: "CURRENT", companyName: "Current session" }] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><NamesNavigationHarness /></QueryClientProvider>);
    expect(await screen.findByText("Loading names…")).toBeInTheDocument();

    gateway.ready = false;
    act(() => useNavigationStore.getState().resetNamesBrokerContext());
    view.rerender(<QueryClientProvider client={client}><NamesNavigationHarness /></QueryClientProvider>);
    expect(screen.getByText("Connect to IBKR to view watchlists.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "OLD SESSION" })).not.toBeInTheDocument();

    gateway.ready = true;
    view.rerender(<QueryClientProvider client={client}><NamesNavigationHarness /></QueryClientProvider>);
    expect(await screen.findByRole("button", { name: "CURRENT" })).toBeInTheDocument();
    await act(async () => finishOldMembership({ id: "same-id", name: "Primary", items: [{ conid: 601, symbol: "OLD SESSION", companyName: "Previous account" }] }));
    expect(screen.queryByRole("button", { name: "OLD SESSION" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove" })).not.toBeDisabled());
    let oldMutationSignal: AbortSignal | undefined;
    api.watchlistRemoveInstrument.mockImplementation((_id: string, _conid: number, signal: AbortSignal) => new Promise((_resolve, reject) => {
      oldMutationSignal = signal;
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(api.watchlistRemoveInstrument).toHaveBeenCalledWith("same-id", 602, expect.any(AbortSignal)));
    gateway.ready = false;
    await act(async () => {
      useNavigationStore.getState().resetNamesBrokerContext();
      view.rerender(<QueryClientProvider client={client}><NamesNavigationHarness /></QueryClientProvider>);
    });
    expect(oldMutationSignal?.aborted).toBe(true);
    client.clear();
  });

  it("aborts the automatic refresh when navigating from Leaders to Analysis", async () => {
    api.getWatchlists.mockResolvedValue([]);
    api.rsLeaders.mockResolvedValue(leaders);
    let refreshSignal: AbortSignal | undefined;
    api.refreshRSLeaders.mockImplementation((_signal: AbortSignal) => new Promise((_resolve, reject) => {
      refreshSignal = _signal;
      _signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><NamesNavigationHarness /></QueryClientProvider>);
    await waitFor(() => expect(refreshSignal).toBeInstanceOf(AbortSignal));
    fireEvent.click(await screen.findByRole("button", { name: "LEAD" }));
    expect(refreshSignal?.aborted).toBe(true);
    expect(screen.getByRole("heading", { name: "Analysis / Compare" })).toBeInTheDocument();
    client.clear();
  });
});
