interface HistoricalPoint {
    date: string;
    price: number;
  }
  export interface watchListStockData {
    ticker: string;
    name: string;
    historical: HistoricalPoint[];
  }
  export interface stimulatedPortfolioItem {
    ticker: string;
    quantity: number;
  }
  export interface PortfolioPerf {
    totalValue: number;
    totalChange: number;
    totalPercentChange: number;
  }