// src/types/options.ts

export interface OptionContract {
    contractId: number;
    strike: number;
    type: "call" | "put";
    lastPrice?: number;
    bid?: number;
    ask?: number;
    volume?: number;
    delta?: number;
    bidSize?: number;
    askSize?: number;
  }
  
  export type OptionsChainData = Record<
  string,
  {
    call?: OptionContract;
    put?: OptionContract;
  }
>;
  
export interface SingleContractResponse {
    strike: number;
    data: {
      call?: OptionContract;
      put?: OptionContract;
    };
  }

  export interface FilteredChainResponse {
    all_strikes: number[];
    chain: OptionsChainData;
  }
  
  export type ContractDataKey = "delta" | "bidSize" | "askSize" | "last" | "ask" | "bid";