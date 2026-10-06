import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MarketPage from "./MarketPage";
import type { MarketAssessmentResponse } from "@/modules/parallax/api";
import { useNavigationStore } from "@/store/navigation";

const marketAssessment = vi.hoisted(() => vi.fn());

vi.mock("@/modules/parallax/api", () => ({
  parallaxApi: { marketAssessment },
}));
vi.mock("@/context/GatewayContext", () => ({ useIbkrReady: () => true }));
vi.mock("@/hooks/useWebSocket", () => ({
  useWebSocket: () => ({
    status: "connected",
    upstreamStatus: { ibkrConnected: true, wsReady: true },
  }),
}));
vi.mock("@/hooks/useLiveQuotes", () => ({
  useLiveQuotes: () => new Map([
    [1, { last: 500, availability: "RB" }],
    [2, { last: 400, availability: "Z" }],
  ]),
}));

const sectors = ["XLK", "XLV", "XLF", "XLE", "XLI", "XLY", "XLP", "XLU", "XLRE", "XLC", "XLB"];

function assessmentFixture(indexClose = 500): MarketAssessmentResponse {
  return {
    status: "complete" as const,
    posture: "broad" as const,
    expected_session: "2026-10-02",
    evidence_session: "2026-10-02",
    calculated_at: "2026-10-02T20:05:00Z",
    indices: ["SPY", "QQQ", "IWM"].map((symbol, index) => ({
      symbol, name: null, conid: index + 1, session_date: "2026-10-02",
      close: indexClose, ema21: 490, sma50: 480, sma200: 450,
      ema21_distance_pct: (indexClose / 490 - 1) * 100,
      sma50_distance_pct: (indexClose / 480 - 1) * 100,
      trend: "constructive" as const, above_sma50: null, unavailable_reason: null,
    })),
    sectors: sectors.map((symbol, index) => ({
      symbol, name: symbol, conid: index + 4, session_date: "2026-10-02",
      close: 100, ema21: null, sma50: 99, sma200: null, trend: null,
      ema21_distance_pct: null, sma50_distance_pct: null,
      above_sma50: index < 8, unavailable_reason: null,
    })),
    participation: {
      total: 11 as const, available: 11, missing: 0, confirmed_above: 8,
      possible_above_min: 8, possible_above_max: 8,
    },
    issues: [], previous_assessment: null,
    next_reconcile_at: null, market_open: false,
  };
}

afterEach(() => {
  marketAssessment.mockReset();
  vi.useRealTimers();
});

describe("MarketPage", () => {
  it("shows the completed-session assessment, all sector proxies, and streamed index price", async () => {
    marketAssessment.mockResolvedValue(assessmentFixture());
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><MarketPage /></QueryClientProvider>);

    expect(await screen.findByRole("heading", { name: "Broad strength" })).toBeInTheDocument();
    expect(screen.getByText("2026-10-02 completed · SPY, QQQ and IWM are constructive. Only 8 of 11 sector ETFs are above SMA50.")).toBeInTheDocument();
    expect(screen.getByText(/IBKR transport connected/)).toBeInTheDocument();
    expect(screen.getByText(/Live 1 · Frozen 1 · Unconfirmed 12 · quote availability/)).toBeInTheDocument();
    const feedStatus = screen.getByText(/IBKR transport connected/).closest('[role="status"]');
    expect(feedStatus?.querySelector(".bg-emerald-600")).toBeNull();
    expect(feedStatus?.querySelector(".bg-amber-500")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /SPY: EMA21/ })).toBeInTheDocument();
    expect(screen.getByText(/\$400 · Frozen/)).toBeInTheDocument();
    expect(screen.getByText(/\$500 · Live/)).toBeInTheDocument();
    expect(screen.getByText(/not individual-stock breadth/)).toBeInTheDocument();
    for (const symbol of sectors) expect(screen.getAllByText(new RegExp(symbol)).length).toBeGreaterThan(0);

    act(() => queryClient.setQueryData(["parallax", "market-assessment"], {
      ...assessmentFixture(), expected_session: "2026-10-05",
    }));
    expect(await screen.findByRole("heading", { name: "Previous assessment · Broad strength" })).toBeInTheDocument();
    expect(screen.getByText(/Dated evidence from 2026-10-02; current session 2026-10-05 is not confirmed/)).toBeInTheDocument();
    expect(screen.getAllByText("Available; market priority unknown")).toHaveLength(3);

    act(() => queryClient.setQueryData(["parallax", "market-assessment"], assessmentFixture()));

    marketAssessment.mockRejectedValueOnce(new Error("sidecar unavailable"));
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ["parallax", "market-assessment"] });
    });
    expect(marketAssessment).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole("heading", { name: "Current assessment unavailable" })).toBeInTheDocument();
    expect(screen.getByText("The latest assessment request failed. Any dated evidence below is the last successful result.")).toBeInTheDocument();
    for (const tactic of ["Pullbacks", "Breakouts", "Breakout retests"]) {
      expect(screen.getByRole("heading", { name: tactic })).toBeInTheDocument();
    }
    expect(screen.getAllByText("Available; market priority unknown")).toHaveLength(3);
    expect(screen.queryByText("Priority in broad strength")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Explore strong names" }));
    expect(useNavigationStore.getState().activeScreen).toBe("screener");
  });

  it("scales the evidence map to actual outliers and leaves missing averages unplotted", async () => {
    const fixture = assessmentFixture();
    fixture.indices[0]!.ema21_distance_pct = 18.75;
    fixture.indices[0]!.sma50_distance_pct = null;
    fixture.indices[1]!.ema21_distance_pct = null;
    fixture.indices[1]!.sma50_distance_pct = -7.25;
    marketAssessment.mockResolvedValue(fixture);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><MarketPage /></QueryClientProvider>);

    expect(await screen.findByRole("img", { name: "SPY: EMA21 +18.75%, SMA50 —" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "QQQ: EMA21 —, SMA50 -7.25%" })).toBeInTheDocument();
    expect(screen.getByText("+20.50%", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("-20.50%", { selector: "span" })).toBeInTheDocument();
    queryClient.clear();
  });

  it("retries identical incomplete assessments every five minutes outside market hours", async () => {
    vi.useFakeTimers();
    const incomplete = { ...assessmentFixture(), status: "partial" as const, market_open: false };
    marketAssessment.mockResolvedValue(incomplete);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={queryClient}><MarketPage /></QueryClientProvider>);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1);
      await Promise.resolve();
    });
    expect(screen.getByRole("heading", { name: "Broad strength" })).toBeInTheDocument();
    expect(marketAssessment).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });
    expect(marketAssessment).toHaveBeenCalledTimes(3);

    view.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(marketAssessment).toHaveBeenCalledTimes(3);
    queryClient.clear();
  });

  it("revalidates a complete assessment and renders corrected evidence without reconnect", async () => {
    vi.useFakeTimers();
    marketAssessment
      .mockResolvedValueOnce(assessmentFixture(101))
      .mockResolvedValueOnce(assessmentFixture(99));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={queryClient}><MarketPage /></QueryClientProvider>);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1);
      await Promise.resolve();
    });
    expect(screen.getByRole("heading", { name: "Broad strength" })).toBeInTheDocument();
    expect(marketAssessment).toHaveBeenCalledTimes(1);
    const summary = screen.getByText("Assessment evidence and update times");
    const details = summary.closest("details");
    expect(details).not.toBeNull();
    fireEvent.click(summary);
    const spyClose = (close: number) => screen.getByText((_, element) =>
      element?.tagName === "P" && element.textContent?.includes(`SPY · Close $${close}`) === true,
    );
    expect(spyClose(101)).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });

    expect(marketAssessment).toHaveBeenCalledTimes(2);
    expect(spyClose(99)).toBeInTheDocument();
    view.unmount();
    queryClient.clear();
  });
});
