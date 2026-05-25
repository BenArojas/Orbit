import api from "@/api/axios";
import { CancelOrderPayload, IbkrTrade, LiveOrder, ModifyOrderPayload } from "@/types/transaction";


export async function getIbkrRecentTrades(days: number = 7): Promise<IbkrTrade[]> {
  const { data } = await api.get("/transactions/trades",
    { params: { days } }  
  )
  return data;
}

export const getLiveOrders = async (): Promise<LiveOrder[]> => {
  // 1. Expect the response data to be an array directly.
  const { data } = await api.get<any[]>("/transactions/live-orders");

  // 2. Validate that the data is an array before trying to map it.
  if (!Array.isArray(data)) {
    return [];
  }

  // 3. Map the 'data' array directly.
  return data.map((order: any): LiveOrder => ({
    orderId: order.orderId,
    ticker: order.ticker,
    side: order.side,
    orderType: order.orderType,
    quantity: order.remainingQuantity,
    limitPrice: order.price,
    status: order.status,
    orderDesc: order.orderDesc,
    conid: order.conid,
  }));
};


export const cancelOrder = async ({ orderId, accountId }: CancelOrderPayload) => {
  // Add the accountId as a URL query parameter
  await api.delete(`/transactions/orders/${orderId}`, {
    params: { accountId },
  });
};

export const modifyOrder = async ({ orderId, newOrderData, accountId }: ModifyOrderPayload) => {
  // Send newOrderData in the body and accountId as a URL query parameter
  await api.post(`/transactions/orders/${orderId}`, newOrderData, {
    params: { accountId },
  });
};