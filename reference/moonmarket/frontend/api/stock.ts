import api from "@/api/axios";
import { ChartDataBars, ChartDataPoint } from "@/types/chart";
import { FilteredChainResponse, SingleContractResponse } from "@/types/options";
import { PositionInfo } from "@/types/position";
import { QuoteInfo, StaticInfo } from "@/types/stock";
import { Time } from "lightweight-charts";


export async function getStockData(ticker: string) {
  const stock = await api.get(
    `/market/quote/${ticker}`
  );
    return stock.data;
}

export const fetchHistoricalStockDataBars = async (
  conid: number,
  period: string
): Promise<ChartDataBars[]> => {
  try {
    const response = await api.get("/market/history", {
      params: {
        conid,
        period,
      },
    });
    return response.data as ChartDataBars[];
  } catch (error) {
    console.error("Error fetching historical stock data:", error);
    // Re-throw the error so react-query can catch it and set the error state
    throw error;
  }
};
/**
 * Fetches historical stock data from the backend API using conid.
 * @param conid The contract ID of the stock.
 * @param period The period for which to fetch data (e.g., "7D", "1M").
 * @returns A promise that resolves to an array of ChartDataPoint.
 */
export const fetchHistoricalStockData = async (
  conid: number,
  period: string
): Promise<ChartDataPoint[]> => {
  const { data } = await api.get<ChartDataBars[]>("/market/history", {
    // Pass conid instead of ticker
    params: { conid, period },
  });

  return data.map(({ time, close }) => ({
    time: time as unknown as Time,
    value: close,
  }));
};

// This function will fetch the initial quote to get the conid
export const fetchConidForTicker = async (ticker: string): Promise<{ conid: number; companyName: string }> => {
  const { data } = await api.get(`/market/conid/${ticker}`);
  return data;
};


export interface StockDetailsResponse {
  staticInfo: StaticInfo;
  quote: QuoteInfo;
  positionInfo: PositionInfo | null;
  optionPositions: PositionInfo[] | null;
}

export const fetchStockDetails = async (conid: number, accountId: string) => {
  const { data } = await api.get<StockDetailsResponse>(`/market/stock/${conid}/details`, {
    params: { accountId },
  });
  return data;
};

export const fetchExpirations = async (ticker: string) => {
  const { data } = await api.get<string[]>(`market/options/expirations/${ticker}`);
  return data;
};


export const fetchOptionChain = async (ticker: string, expiration: string) => {
  const { data } = await api.get<FilteredChainResponse>(`market/options/chain/${ticker}`, {
    params: { expiration_month: expiration },
  });
  return data;
};

export const fetchSingleContract = async (params: {
  ticker: string;
  expiration: string;
  strike: number;
}) => {
  const { ticker, expiration, strike } = params;
  const response = await api.get<SingleContractResponse>(
    `market/options/contract/${ticker}`,
    {
      params: { expiration_month: expiration, strike },
    }
  );
  return response.data;
};