import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const orderTicketState = vi.hoisted(() => ({ open: vi.fn() }));

vi.mock("@/orbit/OrderTicket", () => ({
  useOrderTicketStore: (selector: (state: typeof orderTicketState) => unknown) => selector(orderTicketState),
}));

const mockApi = vi.hoisted(() => ({
  moonmarketOptionExpirations: vi.fn(),
  moonmarketOptionChain: vi.fn(),
  moonmarketOptionContract: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      ...mockApi,
    },
  };
});

import { OptionsChainPage } from "../OptionsChainPage";

function renderPage(initialEntry = "/moonmarket/options?conid=265598&symbol=AAPL") {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <OptionsChainPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("OptionsChainPage", () => {
  beforeEach(() => {
    orderTicketState.open.mockClear();
    mockApi.moonmarketOptionExpirations.mockReset();
    mockApi.moonmarketOptionChain.mockReset();
    mockApi.moonmarketOptionContract.mockReset();
    mockApi.moonmarketOptionExpirations.mockResolvedValue({
      underlying_conid: 265598,
      symbol: "AAPL",
      expirations: ["JUN24", "JUL24"],
    });
    mockApi.moonmarketOptionChain.mockResolvedValue({
      underlying_conid: 265598,
      expiration: "JUN24",
      all_strikes: [175, 180, 185, 190, 195, 200, 205],
      chain: {},
    });
    mockApi.moonmarketOptionContract.mockImplementation(
      async (_underlyingConid: number, expiration: string, strike: number) => ({
        strike,
        data: {
          call: {
            contractId: 7000 + strike,
            underlyingConid: 265598,
            expiration,
            strike,
            right: "C",
            type: "call",
            symbol: "AAPL",
            lastPrice: 4.2,
            bid: 4.1,
            ask: 4.3,
            volume: 150,
            delta: 0.62,
            bidSize: 12,
            askSize: 15,
          },
          put: {
            contractId: 8000 + strike,
            underlyingConid: 265598,
            expiration,
            strike,
            right: "P",
            type: "put",
            symbol: "AAPL",
            lastPrice: 3.9,
            bid: 3.8,
            ask: 4,
            volume: 110,
            delta: -0.38,
            bidSize: 10,
            askSize: 14,
          },
        },
      }),
    );
  });

  it("shows an empty state when opened without an underlying conid", () => {
    renderPage("/moonmarket/options");

    expect(screen.getByText(/open options from parallax analysis/i)).toBeInTheDocument();
    expect(mockApi.moonmarketOptionExpirations).not.toHaveBeenCalled();
  });

  it("loads expirations, strikes, and auto-loads the first visible strike contracts", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: /aapl options/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("combobox", { name: /expiration/i })).toHaveValue("JUN24"));
    expect(mockApi.moonmarketOptionExpirations).toHaveBeenCalledWith(265598, "AAPL", expect.any(AbortSignal));
    expect(mockApi.moonmarketOptionChain).toHaveBeenCalledWith(265598, "JUN24", expect.any(AbortSignal));
    await waitFor(() =>
      expect(mockApi.moonmarketOptionContract).toHaveBeenCalledWith(265598, "JUN24", 180, expect.any(AbortSignal)),
    );
    expect(await screen.findByRole("button", { name: /select call 180/i })).toBeInTheDocument();
  });

  it("manual-loads a strike row outside the initial visible window", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /load strike 205/i }));

    await waitFor(() =>
      expect(mockApi.moonmarketOptionContract).toHaveBeenCalledWith(265598, "JUN24", 205, expect.any(AbortSignal)),
    );
    const row = await screen.findByTestId("option-strike-205.00");
    expect(within(row).getByRole("button", { name: /select call 205/i })).toBeInTheDocument();
    expect(within(row).getByText("4.30")).toBeInTheDocument();
  });

  it("opens the shared OrderTicket with assetClass OPT when a call is selected", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /select call 180/i }));

    expect(orderTicketState.open).toHaveBeenCalledWith({
      conid: 7180,
      symbol: "AAPL JUN24 180 CALL",
      description: "AAPL JUN24 180 CALL",
      assetClass: "OPT",
      side: "BUY",
    });
  });
});
