export interface PositionInfo {
    position: number;
    avgCost: number;
    unrealizedPnl: number;
    mktValue: number;
    name?: string;
    daysToExpire?: number;
  }

  /* -------------------------------- AllocationDTO ------------------------- */

export interface LongShort {
    long: Record<string, number>; // e.g. { STK: 12345.67, OPT: 9876 }
    short: Record<string, number>; // (may be an empty object)
  }
  
  export interface AllocationDTO {
    assetClass: LongShort; // STK / OPT / CASH …
    sector: LongShort; // Technology / Financial …
    group: LongShort; // Semiconductors / Banks …
  }
  export type AllocationView = "assetClass" | "sector" | "group";

  export interface PositionsPayload {
    stock: PositionInfo | null;
    options: PositionInfo[] | null;
  }