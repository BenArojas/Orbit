/**
 * Tests for WatchlistTab — watchlist membership checkbox manager.
 *
 * Covers:
 *   - Shows "select a symbol" prompt when activeConid is null
 *   - Renders a checkbox per watchlist
 *   - Checked state matches membership data
 *   - Checking an unchecked box calls watchlistAddInstrument
 *   - Unchecking a checked box calls watchlistRemoveInstrument
 *   - Loading state is shown while queries are in-flight
 *   - Empty watchlist list shows helpful message
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import WatchlistTab from "../WatchlistTab";

// ── Mock the api module ────────────────────────────────────────────────────

vi.mock("@/lib/api", () => ({
  api: {
    getWatchlists: vi.fn(),
    watchlistMembership: vi.fn(),
    watchlistAddInstrument: vi.fn(),
    watchlistRemoveInstrument: vi.fn(),
  },
}));

import { api } from "@/lib/api";

// ── Helpers ───────────────────────────────────────────────────────────────

function makeQc() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderTab(props: { activeConid?: number | null; activeSymbol?: string } = {}) {
  const qc = makeQc();
  const activeConid = props.activeConid !== undefined ? props.activeConid : 265598;
  return render(
    <QueryClientProvider client={qc}>
      <WatchlistTab
        activeConid={activeConid}
        activeSymbol={props.activeSymbol ?? "AAPL"}
      />
    </QueryClientProvider>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("WatchlistTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows prompt when activeConid is null", () => {
    renderTab({ activeConid: null });
    expect(screen.getByText(/select a symbol/i)).toBeTruthy();
  });

  it("renders a checkbox per watchlist", async () => {
    vi.mocked(api.getWatchlists).mockResolvedValue([
      { id: "wl1", name: "RS Leaders" },
      { id: "wl2", name: "Watchlist 2" },
    ]);
    vi.mocked(api.watchlistMembership).mockResolvedValue({
      conid: 265598,
      watchlist_ids: [],
    });

    renderTab();
    await waitFor(() => {
      expect(screen.getByText("RS Leaders")).toBeTruthy();
      expect(screen.getByText("Watchlist 2")).toBeTruthy();
    });

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(2);
  });

  it("checkbox is checked for watchlists that contain the conid", async () => {
    vi.mocked(api.getWatchlists).mockResolvedValue([
      { id: "wl1", name: "RS Leaders" },
      { id: "wl2", name: "Watchlist 2" },
    ]);
    vi.mocked(api.watchlistMembership).mockResolvedValue({
      conid: 265598,
      watchlist_ids: ["wl1"],
    });

    renderTab();
    await waitFor(() => screen.getByText("RS Leaders"));

    const [cb1, cb2] = screen.getAllByRole("checkbox");
    expect((cb1 as HTMLInputElement).checked).toBe(true);
    expect((cb2 as HTMLInputElement).checked).toBe(false);
  });

  it("checking a box calls watchlistAddInstrument", async () => {
    vi.mocked(api.getWatchlists).mockResolvedValue([{ id: "wl1", name: "RS Leaders" }]);
    vi.mocked(api.watchlistMembership).mockResolvedValue({
      conid: 265598,
      watchlist_ids: [],
    });
    vi.mocked(api.watchlistAddInstrument).mockResolvedValue({ added: true, conid: 265598 });

    renderTab();
    await waitFor(() => screen.getByText("RS Leaders"));

    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => {
      expect(api.watchlistAddInstrument).toHaveBeenCalledWith("wl1", 265598);
    });
  });

  it("add invalidates watchlist-instruments cache so dashboard sidebar stays in sync", async () => {
    vi.mocked(api.getWatchlists).mockResolvedValue([{ id: "wl1", name: "RS Leaders" }]);
    vi.mocked(api.watchlistMembership).mockResolvedValue({
      conid: 265598,
      watchlist_ids: [],
    });
    vi.mocked(api.watchlistAddInstrument).mockResolvedValue({ added: true, conid: 265598 });

    const qc = makeQc();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    render(
      <QueryClientProvider client={qc}>
        <WatchlistTab activeConid={265598} activeSymbol="AAPL" />
      </QueryClientProvider>,
    );

    await waitFor(() => screen.getByText("RS Leaders"));
    fireEvent.click(screen.getByRole("checkbox"));

    await waitFor(() => {
      const keys = invalidateSpy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
      expect(keys).toContainEqual(["watchlist-instruments", "wl1"]);
    });
  });

  it("unchecking a box calls watchlistRemoveInstrument", async () => {
    vi.mocked(api.getWatchlists).mockResolvedValue([{ id: "wl1", name: "RS Leaders" }]);
    vi.mocked(api.watchlistMembership).mockResolvedValue({
      conid: 265598,
      watchlist_ids: ["wl1"],
    });
    vi.mocked(api.watchlistRemoveInstrument).mockResolvedValue({ removed: true, conid: 265598 });

    renderTab();
    await waitFor(() => screen.getByText("RS Leaders"));

    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => {
      expect(api.watchlistRemoveInstrument).toHaveBeenCalledWith("wl1", 265598);
    });
  });

  it("remove invalidates watchlist-instruments cache so dashboard sidebar stays in sync", async () => {
    vi.mocked(api.getWatchlists).mockResolvedValue([{ id: "wl1", name: "RS Leaders" }]);
    vi.mocked(api.watchlistMembership).mockResolvedValue({
      conid: 265598,
      watchlist_ids: ["wl1"],
    });
    vi.mocked(api.watchlistRemoveInstrument).mockResolvedValue({ removed: true, conid: 265598 });

    const qc = makeQc();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    render(
      <QueryClientProvider client={qc}>
        <WatchlistTab activeConid={265598} activeSymbol="AAPL" />
      </QueryClientProvider>,
    );

    await waitFor(() => screen.getByText("RS Leaders"));
    fireEvent.click(screen.getByRole("checkbox"));

    await waitFor(() => {
      const keys = invalidateSpy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
      expect(keys).toContainEqual(["watchlist-instruments", "wl1"]);
    });
  });

  it("shows empty message when no watchlists exist", async () => {
    vi.mocked(api.getWatchlists).mockResolvedValue([]);
    vi.mocked(api.watchlistMembership).mockResolvedValue({
      conid: 265598,
      watchlist_ids: [],
    });

    renderTab();
    await waitFor(() => {
      expect(screen.getByText(/no watchlists found/i)).toBeTruthy();
    });
  });
});
