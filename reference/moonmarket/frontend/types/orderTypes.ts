
export interface TradingTarget {
    conid: number;
    name: string;
    type: "STOCK" | "OPTION";
  }
  
  export const orderTypeHelp = {
    MKT: "A market order executes at the next available market price.",
    LMT: "A limit order executes only at your specified limit price or better.",
    STP: "A stop order triggers a market order when a specified stop price is reached.",
    STOP_LIMIT: "Triggers a limit order when a stop price is reached. Requires both a Stop Price and a Limit Price.",
  };
  
  export const bracketOrderHelp = "Automatically places a profit-taking limit order and a protective stop-loss order once your main order executes. If one exit order fills, the other is automatically canceled (OCA).";