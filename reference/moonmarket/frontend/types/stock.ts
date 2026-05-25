export interface StaticInfo {
    conid: number;
    ticker: string;
    companyName: string;
    exchange?: string;
    secType?: string;
    currency?: string;
  }
  
  export interface InitialQuoteData {
    conid: number;
    lastPrice?: number;
    bid?: number;
    ask?: number;
    changePercent?: number;
    changeAmount?: number;
  }
  
  export interface QuoteInfo {
    lastPrice?: number;
    bid?: number;
    ask?: number;
    changePercent?: number;
    changeAmount?: number;
    dayHigh?: number;
    dayLow?: number;
  }

  export interface StockData {
    symbol: string;
    last_price: number;
    avg_bought_price: number;
    quantity: number;
    value: number;
    unrealizedPnl: number;
    daily_change_percent?: number;
    daily_change_amount?: number;
  }

  export interface PriceLadderRow {
    price: number;
    bidSize?: number;
    askSize?: number;
  }