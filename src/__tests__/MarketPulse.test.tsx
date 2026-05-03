/**
 * Tests for <MarketPulse> — Phase 8 / Task 3.1 (bundled endpoints).
 *
 * Verifies two key behaviors after the Task 3.1 refactor:
 *
 *   1. Exactly 1 call to /market/quotes?conids=... and 1 call to
 *      /market/candles?conids=... are issued regardless of how many
 *      tickers the pulse bar is configured with (here: 3 for speed).
 *
 *   2. Each PulseItem displays the price + change% from the bundled
 *      response slice keyed by its conid — correct slice attribution.
 *
 * Mocking strategy:
 *   - @/lib/api is mocked at the module level so no real network calls
 *     fire.  resolveConid returns a deterministic conid per symbol.
 *   - @/store is mocked to return a fixed 3-item pulse config.
 *   - @/context/GatewayContext is mocked so ibkrReady = true.
 *   - @/hooks/useIbkrReadyTier is mocked so tierReady = true.
 *   - @/lib/query exports queryClient — mocked to the per-test
 *     QueryClient so invalidation doesn't leak between tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── Module mocks (must come before any import that uses them) ─────────────

vi.mock("@/lib/api", () => ({
  api: {
    resolveConid: vi.fn(),
    quotesBundled: vi.fn(),
    candlesBundled: vi.fn(),
  },
}));

vi.mock("@/store", () => ({
  useNavigationStore: vi.fn(() => vi.fn()),
  usePulseConfigStore: vi.fn(),
}));

vi.mock("@/context/GatewayContext", () => ({
  useIbkrReady: () => true,
}));

vi.mock("@/hooks/useIbkrReadyTier", () => ({
  useIbkrReadyTier: () => true,
}));

// Stub skeletons so we don't need Tailwind CSS to render them.
vi.mock("./skeletons", () => ({
  Pulse: ({ className }: { className?: string }) =>
    React.createElement("div", { "data-testid": "pulse-skeleton", className }),
}));

// ── Imports after mocks ───────────────────────────────────────────────────

import { api } from "@/lib/api";
import { usePulseConfigStore, useNavigationStore } from "@/store";
import MarketPulse from "@/components/dashboard/MarketPulse";
import type { PulseItem } from "@/lib/api";

// ── Fixtures ──────────────────────────────────────────────────────────────

/** 3-item pulse config — small enough for fast tests, large enough to prove
 *  that N tickers → 1 bundled call (not N calls). */
const ITEMS: PulseItem[] = [
  { label: "SPY", resolve: "SPY", sec_type: "" },
  { label: "QQQ", resolve: "QQQ", sec_type: "" },
  { label: "BTC", resolve: "BTC", sec_type: "" },
];

/** Deterministic conid per fixture symbol. */
const CONIDS: Record<string, number> = {
  SPY: 756733,
  QQQ: 320227571,
  BTC: 532640894,
};

const QUOTES_RESPONSE = {
  items: [
    { conid: CONIDS.SPY, symbol: "SPY", companyName: "SPDR S&P 500 ETF",
      lastPrice: 542.50, bid: null, ask: null, open: null, high: null,
      low: null, previousClose: null, changePercent: 0.73, changeAmount: null, volume: null },
    { conid: CONIDS.QQQ, symbol: "QQQ", companyName: "Invesco QQQ",
      lastPrice: 461.20, bid: null, ask: null, open: null, high: null,
      low: null, previousClose: null, changePercent: -0.12, changeAmount: null, volume: null },
    { conid: CONIDS.BTC, symbol: "BTC", companyName: "Bitcoin",
      lastPrice: 62800.00, bid: null, ask: null, open: null, high: null,
      low: null, previousClose: null, changePercent: 1.45, changeAmount: null, volume: null },
  ],
};

const CANDLES_RESPONSE = {
  items: [
    { conid: CONIDS.SPY, candles: [{ time: 1, open: 540, high: 545, low: 539, close: 542, volume: 1000 }] },
    { conid: CONIDS.QQQ, candles: [{ time: 1, open: 462, high: 465, low: 460, close: 461, volume: 2000 }] },
    { conid: CONIDS.BTC, candles: [{ time: 1, open: 62000, high: 63000, low: 61000, close: 62800, volume: 500 }] },
  ],
  errors: {},
};

// ── Helpers ───────────────────────────────────────────────────────────────

function freshClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
  });
}

function renderPulse(qc: QueryClient) {
  return render(
    React.createElement(
      QueryClientProvider,
      { client: qc },
      React.createElement(MarketPulse),
    ),
  );
}

// ── Test suite ────────────────────────────────────────────────────────────

describe("MarketPulse — Task 3.1 bundled endpoints", () => {
  beforeEach(() => {
    // Wire store mock to return the 3-item config.
    (usePulseConfigStore as ReturnType<typeof vi.fn>).mockImplementation(
      (selector: (s: { items: PulseItem[] }) => unknown) =>
        selector({ items: ITEMS }),
    );

    // Wire navigation store mock.
    (useNavigationStore as ReturnType<typeof vi.fn>).mockImplementation(
      () => vi.fn(),
    );

    // Wire API mocks.
    (api.resolveConid as ReturnType<typeof vi.fn>).mockImplementation(
      (symbol: string) =>
        Promise.resolve({ conid: CONIDS[symbol] ?? 1, symbol }),
    );
    (api.quotesBundled as ReturnType<typeof vi.fn>).mockResolvedValue(
      QUOTES_RESPONSE,
    );
    (api.candlesBundled as ReturnType<typeof vi.fn>).mockResolvedValue(
      CANDLES_RESPONSE,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("issues exactly 1 quotes call and 1 candles call for 3 tickers", async () => {
    const qc = freshClient();
    renderPulse(qc);

    await waitFor(() => {
      expect(api.quotesBundled).toHaveBeenCalledTimes(1);
    });

    expect(api.candlesBundled).toHaveBeenCalledTimes(1);

    // The bundled calls must have received ALL three conids, not per-ticker.
    const quotesCall = (api.quotesBundled as ReturnType<typeof vi.fn>).mock.calls[0];
    const passedConids: number[] = quotesCall[0];
    expect(passedConids).toHaveLength(3);
    expect(passedConids).toContain(CONIDS.SPY);
    expect(passedConids).toContain(CONIDS.QQQ);
    expect(passedConids).toContain(CONIDS.BTC);

    // Period defaults to "5D".
    const candlesCall = (api.candlesBundled as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(candlesCall[1]).toBe("5D");
  });

  it("each PulseItem displays the correct price from its bundled response slice", async () => {
    const qc = freshClient();
    renderPulse(qc);

    // SPY: lastPrice=542.50, changePercent=+0.73%
    await waitFor(() => {
      expect(screen.getByText("542.50")).toBeInTheDocument();
    });
    expect(screen.getByText("+0.73%")).toBeInTheDocument();

    // QQQ: lastPrice=461.20, changePercent=-0.12%
    expect(screen.getByText("461.20")).toBeInTheDocument();
    expect(screen.getByText("-0.12%")).toBeInTheDocument();

    // BTC: lastPrice=62800 (≥1000 → comma-formatted, 0 decimals)
    expect(screen.getByText("62,800")).toBeInTheDocument();
    expect(screen.getByText("+1.45%")).toBeInTheDocument();
  });

  it("shows skeletons for all items before the bundled response arrives", async () => {
    // Make quotesBundled hang so we can inspect the loading state.
    (api.quotesBundled as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {}), // never resolves
    );

    const qc = freshClient();
    renderPulse(qc);

    // Conid resolution + candles can still resolve, but without quotes
    // PulseItem.loaded=false → all items render as skeletons.
    await waitFor(() => {
      // The bar should render all 3 labels in skeleton form.
      // Skeletons include the label text alongside the Pulse placeholder.
      expect(screen.getByText("SPY")).toBeInTheDocument();
      expect(screen.getByText("QQQ")).toBeInTheDocument();
      expect(screen.getByText("BTC")).toBeInTheDocument();
    });

    // No live prices should be in the DOM yet.
    expect(screen.queryByText("542.50")).not.toBeInTheDocument();
    expect(screen.queryByText("461.20")).not.toBeInTheDocument();
  });

  it("renders nothing (empty div) when the item list is empty", () => {
    (usePulseConfigStore as ReturnType<typeof vi.fn>).mockImplementation(
      (selector: (s: { items: PulseItem[] }) => unknown) =>
        selector({ items: [] }),
    );

    const qc = freshClient();
    const { container } = renderPulse(qc);

    // Should render the empty-bar div, not any PulseItem buttons.
    expect(container.querySelector("button")).toBeNull();
    // No bundled calls should have been made.
    expect(api.quotesBundled).not.toHaveBeenCalled();
    expect(api.candlesBundled).not.toHaveBeenCalled();
  });

  it("does not fire bundled queries while conid resolution is pending", async () => {
    // Make resolveConid hang — simulates cold-start IBKR conid lookups
    // (first run, SQLite cache empty) or a slow IBKR search response.
    (api.resolveConid as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {}), // never resolves
    );

    const qc = freshClient();
    renderPulse(qc);

    // Give async effects time to settle — resolveConid is still pending so
    // allResolved=false, meaning the bundled queries must stay disabled.
    await new Promise((r) => setTimeout(r, 50));

    expect(api.quotesBundled).not.toHaveBeenCalled();
    expect(api.candlesBundled).not.toHaveBeenCalled();
  });
});
