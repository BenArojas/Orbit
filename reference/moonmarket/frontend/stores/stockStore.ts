// src/stores/stockStore.ts
import { ChartDataBars } from "@/types/chart";
import {
  AllocationDTO,
  AllocationView,
  PositionInfo,
  PositionsPayload,
} from "@/types/position";
import {
  InitialQuoteData,
  PriceLadderRow,
  QuoteInfo,
  StaticInfo,
  StockData,
} from "@/types/stock";
import { AccountDetailsDTO, BriefAccountInfo, PnlRow } from "@/types/user";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface FrontendMarketDataUpdate {
  type: "market_data";
  conid: number;
  symbol: string;
  last_price: number;
  quantity?: number;
  avg_bought_price?: number;
  value?: number;
  unrealized_pnl?: number;
  daily_change_percent?: number;
  daily_change_amount?: number;
}

export interface ActiveStockUpdate {
  type: "active_stock_update";
  conid: number;
  lastPrice?: number;
  bid?: number;
  ask?: number;
  changePercent?: number;
  changeAmount?: number;
  dayHigh?: number;
  dayLow?: number;
}

interface StockState {
  // State
  stocks: { [symbol: string]: StockData };
  activeStock: {
    conid: number | null;
    ticker: string | null;
    companyName: string | null;
    quote: QuoteInfo;
    depth: PriceLadderRow[];
    chartData: ChartDataBars[];
    position: PositionInfo | null;
    optionPositions: PositionInfo[] | null;
    secType: string | null;
    selectedPeriod: string;
  };
  watchlists: Record<string, string>;
  connectionStatus: "disconnected" | "connecting" | "connected" | "error";
  error?: string;
  allocation?: AllocationDTO;
  allocationView: AllocationView;
  accountDetails: AccountDetailsDTO | null;
  pnl: Record<string, PnlRow>;
  coreTotals: {
    dailyRealized: number;
    unrealized: number;
    netLiq: number;
    marketValue: number; // Add this
    equityWithLoanValue: number; // Add this
  };
  allAccounts: BriefAccountInfo[];
  selectedAccountId: string | null;
  areAiFeaturesEnabled: boolean | null;

  // Actions
  // chart bars
  setInitialChartData: (data: ChartDataBars[]) => void;
  setInitialCoreTotals: (totals: {
    dailyRealized: number;
    unrealized: number;
    netLiq: number;
    marketValue: number;
    equityWithLoanValue: number;
  }) => void;
  subscribeToStock: (conid: number) => void;
  setPositions: (payload: PositionsPayload) => void;
  subscribeToAllocation: () => void;
  setInitialQuote: (data: InitialQuoteData) => void;
  setPreloadedDetails: (details: StaticInfo) => void;
  subscribeToPortfolio: () => void;
  unsubscribeFromPortfolio: () => void;
  unsubscribeFromStock: (conid: number) => void;
  updateActiveQuote: (data: any) => void;
  updateLiveChartBar: (data: { timestamp: number; lastPrice: number }) => void;
  setSelectedPeriod: (period: string) => void;
  updateActiveDepth: (data: PriceLadderRow[]) => void;
  clearActiveStock: () => void;
  setPnl: (rows: Record<string, PnlRow>) => void;
  setAreAiFeaturesEnabled: (enabled: boolean) => void;
  setAllocation: (a: AllocationDTO) => void;
  setAllocationView: (v: AllocationView) => void;
  setAccountDetails: (details: AccountDetailsDTO) => void;
  setAllAccounts: (accounts: BriefAccountInfo[]) => void;
  setSelectedAccountId: (accountId: string) => void;
  setConnectionStatus: (status: StockState["connectionStatus"]) => void;
  setError: (errorMsg: string) => void;
  clearError: () => void;
  updateStock: (data: FrontendMarketDataUpdate) => void;
  setWatchlists: (w: Record<string, string>) => void;
  clearAllData: () => void;

  // Connection management actions
  connect: () => void;
  disconnect: () => void;
}

export const useStockStore = create<StockState>()(
  persist(
    (set, get) => ({
      // --- Start of your state and actions object ---

      // Default State
      stocks: {},
      activeStock: {
        conid: null,
        ticker: null,
        companyName: null,
        quote: {},
        depth: [],
        chartData: [],
        position: null,
        optionPositions: null,
        secType: null,
        selectedPeriod: "7D",
      },
      watchlists: {},
      pnl: {},
      allocation: undefined,
      allocationView: "assetClass",
      coreTotals: {
        dailyRealized: 0,
        unrealized: 0,
        netLiq: 0,
        marketValue: 0, // Initialize new fields
        equityWithLoanValue: 0, // Initialize new fields
      },
      connectionStatus: "disconnected",
      error: undefined,
      accountDetails: null,
      allAccounts: [],
      selectedAccountId: null,
      areAiFeaturesEnabled: null,

      // Actions

      setInitialChartData: (data) =>
        set((state) => ({
          activeStock: { ...state.activeStock, chartData: data },
        })),
      setPositions: (payload) =>
        set((state) => ({
          activeStock: {
            ...state.activeStock,
            position: payload.stock,
            optionPositions: payload.options,
          },
        })),

      setInitialCoreTotals: (totals) => {
        set({ coreTotals: totals });
      },
      setSelectedPeriod: (period: string) =>
        set((state) => ({
          activeStock: { ...state.activeStock, selectedPeriod: period },
        })),

      setPnl: (rows) => {
        const coreKey = Object.keys(rows).find((k) => k.endsWith(".Core"));
        const core = coreKey ? rows[coreKey] : undefined;
        set({
          pnl: rows,
          coreTotals: core
            ? {
                dailyRealized: core.dpl ?? 0,
                unrealized: core.upl ?? 0,
                netLiq: core.nl ?? 0,
                marketValue: core.mv ?? 0, // Update this if PnL WebSocket also uses mv
                equityWithLoanValue: core.el ?? 0, // Update this if PnL WebSocket also uses el
              }
            : {
                dailyRealized: 0,
                unrealized: 0,
                netLiq: 0,
                marketValue: 0,
                equityWithLoanValue: 0,
              },
        });
      },
      updateLiveChartBar: (data) => {
        // Only proceed if the 1D period is selected and we have data
        if (
          get().activeStock.selectedPeriod !== "1D" ||
          get().activeStock.chartData.length === 0
        ) {
          return;
        }

        const { lastPrice, timestamp } = data;
        const chartData = [...get().activeStock.chartData]; // Create a mutable copy
        const lastBar = chartData[chartData.length - 1];

        // Timestamps are in seconds. Check if the new tick is in the same minute as the last bar.
        const lastBarMinute = Math.floor(lastBar.time / 60);
        const tickMinute = Math.floor(timestamp / 60);

        if (tickMinute === lastBarMinute) {
          // --- UPDATE the last bar ---
          lastBar.close = lastPrice;
          lastBar.high = Math.max(lastBar.high, lastPrice);
          lastBar.low = Math.min(lastBar.low, lastPrice);
          // Note: Real-time volume is not provided per tick, so we leave it as is.
        } else {
          // --- CREATE a new bar ---
          // The new bar starts at the beginning of the current minute
          const newBarTimestamp = tickMinute * 60;
          const newBar: ChartDataBars = {
            time: newBarTimestamp,
            open: lastPrice,
            high: lastPrice,
            low: lastPrice,
            close: lastPrice,
            volume: 0,
          };
          chartData.push(newBar);
        }

        // Update the state with the new chart data array
        set((state) => ({
          activeStock: { ...state.activeStock, chartData: chartData },
        }));
      },
      setPreloadedDetails: (details: StaticInfo) =>
        set((state) => ({
          activeStock: {
            ...state.activeStock,
            conid: details.conid,
            companyName: details.companyName,
            ticker: details.ticker,
            secType: details.secType ?? null,
            quote: {
              ...state.activeStock.quote,
              lastPrice: undefined,
              changeAmount: undefined,
              changePercent: undefined,
            },
          },
        })),
      setInitialQuote: (data: InitialQuoteData) =>
        set((state) => ({
          activeStock: {
            ...state.activeStock,
            conid: data.conid,
            quote: {
              ...state.activeStock.quote,
              ...data,
            },
          },
        })),
      setAreAiFeaturesEnabled: (enabled) =>
        set({ areAiFeaturesEnabled: enabled }),
      setAccountDetails: (details) => set({ accountDetails: details }),
      setAllAccounts: (accounts) => set({ allAccounts: accounts }),
      setSelectedAccountId: (accountId) =>
        set({ selectedAccountId: accountId }),
      setConnectionStatus: (status) => set({ connectionStatus: status }),
      setError: (errorMsg) =>
        set({ error: errorMsg, connectionStatus: "error" }),
      clearError: () => set({ error: undefined }),
      setWatchlists: (data) => set({ watchlists: data }),
      setAllocation: (data) => set({ allocation: data }),
      setAllocationView: (v) => set({ allocationView: v }),
      subscribeToAllocation: () => {
        const accountId = get().selectedAccountId;
        if (ws && ws.readyState === WebSocket.OPEN && accountId) {
          ws.send(
            JSON.stringify({
              action: "GET_INITIAL_ALLOCATION",
              account_id: accountId,
            })
          );
        }
      },
      subscribeToPortfolio: () => {
        const accountId = get().selectedAccountId;
        if (ws && ws.readyState === WebSocket.OPEN && accountId) {
          ws.send(
            JSON.stringify({
              action: "subscribe_portfolio",
              account_id: accountId,
            })
          );
        }
      },
      unsubscribeFromPortfolio: () => {
        const accountId = get().selectedAccountId;
        if (ws && ws.readyState === WebSocket.OPEN && accountId) {
          ws.send(
            JSON.stringify({
              action: "unsubscribe_portfolio",
              account_id: accountId,
            })
          );
        }
      },
      subscribeToStock: (conid) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          const command = { action: "subscribe_stock", conid };
          ws.send(JSON.stringify(command));
        }
      },
      unsubscribeFromStock: (conid) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          const command = { action: "unsubscribe_stock", conid };
          ws.send(JSON.stringify(command));
        }
      },
      updateActiveQuote: (data) =>
        set((state) => ({
          activeStock: {
            ...state.activeStock,
            quote: {
              ...state.activeStock.quote,
              lastPrice: data.lastPrice ?? state.activeStock.quote.lastPrice,
              bid: data.bid ?? state.activeStock.quote.bid,
              ask: data.ask ?? state.activeStock.quote.ask,
              changeAmount:
                data.changeAmount ?? state.activeStock.quote.changeAmount,
              changePercent:
                data.changePercent ?? state.activeStock.quote.changePercent,
              dayHigh: data.dayHigh ?? state.activeStock.quote.dayHigh,
              dayLow: data.dayLow ?? state.activeStock.quote.dayLow,
            },
          },
        })),
      updateActiveDepth: (data) =>
        set((state) => ({
          activeStock: { ...state.activeStock, depth: data },
        })),
      clearActiveStock: () =>
        set({
          activeStock: {
            conid: null,
            ticker: null,
            companyName: null,
            quote: {},
            depth: [],
            chartData: [],
            position: null,
            optionPositions: null,
            secType: null,
            selectedPeriod: "7D",
          },
        }),
      updateStock: (data: FrontendMarketDataUpdate) =>
        set((state) => {
          const prev = state.stocks[data.symbol] ?? {};
          const qty = data.quantity ?? prev.quantity ?? 0;
          return {
            stocks: {
              ...state.stocks,
              [data.symbol]: {
                symbol: data.symbol,
                last_price: data.last_price,
                quantity: qty,
                avg_bought_price:
                  data.avg_bought_price ?? prev.avg_bought_price ?? 0,
                unrealizedPnl: data.unrealized_pnl ?? prev.unrealizedPnl ?? 0,
                value: data.value ?? data.last_price * qty,
                daily_change_percent:
                  data.daily_change_percent ?? prev.daily_change_percent,
                daily_change_amount:
                  data.daily_change_amount ?? prev.daily_change_amount,
              },
            },
          };
        }),
      clearAllData: () =>
        set({
          stocks: {},
          watchlists: {},
        }),
      connect: () => {
        connectWebSocket(get);
      },
      disconnect: () => {
        disconnectWebSocket();
        get().setConnectionStatus("disconnected");
      },
    }),
    // --- End of your state and actions object ---

    // --- CHANGED: Configuration object for persist middleware ---
    {
      name: "stock-storage", // Unique name for localStorage key

      // Selectively save only the data that needs to persist
      partialize: (state) => ({
        selectedAccountId: state.selectedAccountId,
        watchlists: state.watchlists,
        allocationView: state.allocationView,
        areAiFeaturesEnabled: state.areAiFeaturesEnabled,
      }),
    }
  )
);

let ws: WebSocket | null = null;
let reconnectTimeout: NodeJS.Timeout;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;

function connectWebSocket(get: () => StockState) {
  // Prevent multiple connections
  if (ws && ws.readyState !== WebSocket.CLOSED) {
    return;
  }

  get().setConnectionStatus("connecting");
  get().clearError();

  const selectedAccountId = get().selectedAccountId;
  if (!selectedAccountId) {
    get().setError("Cannot connect WebSocket without a selected account.");
    return;
  }
  //use env var here
  const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsURL = `${wsProtocol}//${window.location.host}/ws?accountId=${selectedAccountId}`;
  // for dev
  // const wsURL = `${wsProtocol}//localhost:8000/ws?accountId=${selectedAccountId}`;

  console.log({ wsURL });
  ws = new WebSocket(wsURL);

  ws.onopen = () => {
    reconnectAttempts = 0;
    get().setConnectionStatus("connected");
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);

    switch (msg.type) {
      case "market_data":
        // This is a key change: we check if the update is for our
        // active stock or for the general portfolio.
        if (msg.conid && msg.conid === get().activeStock.conid) {
          get().updateActiveQuote(msg);
        } else {
          get().updateStock(msg); // The original behavior for portfolio stocks
        }
        break;

      case "active_stock_update":
        get().updateActiveQuote(msg);
        if (msg.lastPrice && msg.timestamp) {
          get().updateLiveChartBar(msg);
        }
        break;

      case "book_data":
        get().updateActiveDepth(msg.data);
        break;

      case "account_summary":
        // todo
        break;

      case "pnl":
        get().setPnl(msg.data);
        break;

      case "allocation":
        get().setAllocation(msg.data);
        break;

      case "watchlists":
        get().setWatchlists(msg.data);
        break;

      case "error":
        get().setError(msg.message);
        break;
    }
  };

  ws.onclose = () => {
    console.log("WebSocket disconnected");
    get().setConnectionStatus("disconnected");

    // Auto-reconnect
    if (reconnectAttempts < maxReconnectAttempts) {
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
      reconnectAttempts++;
      console.log(`Attempting to reconnect in ${delay}ms...`);
      reconnectTimeout = setTimeout(() => get().connect(), delay);
    } else {
      get().setError("Max reconnection attempts reached.");
    }
  };

  ws.onerror = () => {
    get().setError("WebSocket connection error.");
  };
}

function disconnectWebSocket() {
  if (reconnectTimeout) clearTimeout(reconnectTimeout);
  if (ws) {
    ws.onclose = null; // prevent reconnect logic on manual close
    ws.close();
    ws = null;
  }
}
