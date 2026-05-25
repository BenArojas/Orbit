import { useStockStore } from "@/stores/stockStore";
import { StockData } from "@/types/stock";
import {
  processAllocationData,
  processCircularData,
  processLeaderboardsData,
  processSankeyData,
  processTreemapData,
} from "@/utils/dataProcessing";
import { useMemo } from "react";

function useGraphData(
  stocks: { [symbol: string]: StockData },
  selectedGraph: string,
  isDailyView: boolean = false
) {
  const tickers = Object.keys(stocks);
  const allocationView = useStockStore((state) => state.allocationView);
  const allocation = useStockStore((state) => state.allocation);

  const visualizationData = useMemo(() => {
    if (!stocks || Object.keys(stocks).length === 0) return null;

    switch (selectedGraph) {
      case "Treemap":
        return processTreemapData(stocks, isDailyView);
      case "DonutChart":
        return allocation
          ? processAllocationData(allocation, allocationView)
          : [];
      case "Circular":
        return processCircularData(stocks);
      case "Leaderboards":
        return processLeaderboardsData(stocks);
      case "Sankey":
        return processSankeyData(stocks);
      default:
        return processTreemapData(stocks);
    }
  }, [selectedGraph, stocks, isDailyView, , allocationView, allocation]);

  return {
    stockTickers: tickers,
    visualizationData,
    isDataProcessed: Object.keys(stocks).length > 0,
  };
}

export default useGraphData;
