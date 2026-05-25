import { watchListStockData } from "@/types/watchlist";
import api from "./axios";

export const fetchWatchlists = async () => {
    const { data } = await api.get("/watchlists");
    return data;
  };

  export const fetchWatchlistDetail = async (id: string) => {
    const { data } = await api.get("/watchlists/detail", { params: { id } });
    return data;
  };

  export const fetchWatchlistHistoricalData = async (
    tickers: string[],
    timeRange: string,
    secTypes: Record<string, string>
  ): Promise<watchListStockData[]> => {
    const body = {
      tickers,
      timeRange,
      sec_types: secTypes,
    };
    const { data } = await api.post("/watchlists/historical", body);
    return data;
  };