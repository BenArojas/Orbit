export interface IbkrTrade {
    execution_id: string;
    symbol: string;
    side: 'B' | 'S'; // Buy or Sell
    order_description: string;
    trade_time_r: number; // epoch time
    size: number;
    price: string;
    commission: string;
    net_amount: number;
    company_name: string;
    conid: number;
    sec_type: 'STK' | 'OPT' | string;
  }

  export interface LiveOrder {
    orderId: number;
    ticker: string;
    side: "BUY" | "SELL";
    orderType: string;
    quantity: number; // Mapped from remainingQuantity
    limitPrice: string; // Mapped from price
    status: string;
    orderDesc: string; // e.g., "Buy 1 TSLA Limit 200.00, Day"
    conid: number;
  }

  export interface ModifyOrderPayload {
    orderId: number;
    newOrderData: {
      price?: number;
      quantity?: number;
    };
    accountId: string;
  }
  
  export interface CancelOrderPayload {
    orderId: number;
    accountId: string;
  }

  export interface OrderPayload {
    conid: number;
    orderType: string;
    side: 'BUY' | 'SELL';
    quantity: number;
    tif: string;
    price?: number;
    auxPrice?: number;
    cOID?: string;
    parentId?: string;
    isSingleGroup?: boolean;
  }
  
  export interface PreviewOrderVariables {
    accountId: string;
    order: OrderPayload;
  }