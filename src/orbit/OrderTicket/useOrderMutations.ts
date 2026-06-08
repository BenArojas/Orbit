import { useMutation, useQueryClient } from "@tanstack/react-query";
import { moonmarketApi , type MoonMarketOrderDraft} from "@/modules/moonmarket/api";


export function usePreviewOrder() {
  return useMutation({
    mutationFn: (body: { account_id: string; order: MoonMarketOrderDraft }) =>
      moonmarketApi.moonmarketPreviewOrder(body),
  });
}

export function usePlaceOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { account_id: string; orders: MoonMarketOrderDraft[] }) =>
      moonmarketApi.moonmarketPlaceOrders(body),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["moonmarket", "live-orders", variables.account_id] });
      void queryClient.invalidateQueries({ queryKey: ["moonmarket", "portfolio", variables.account_id] });
    },
  });
}

export function useReplyOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { accountId: string; replyId: string; confirmed: boolean }) =>
      moonmarketApi.moonmarketReplyOrder(body.accountId, body.replyId, body.confirmed),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["moonmarket", "live-orders", variables.accountId] });
      void queryClient.invalidateQueries({ queryKey: ["moonmarket", "portfolio", variables.accountId] });
    },
  });
}

export function useCancelOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { accountId: string; orderId: string }) =>
      moonmarketApi.moonmarketCancelOrder(body.accountId, body.orderId),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["moonmarket", "live-orders", variables.accountId] });
      void queryClient.invalidateQueries({ queryKey: ["moonmarket", "funds", variables.accountId] });
      void queryClient.invalidateQueries({ queryKey: ["moonmarket", "portfolio", variables.accountId] });
    },
  });
}

export function useModifyOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { accountId: string; orderId: string; order: MoonMarketOrderDraft }) =>
      moonmarketApi.moonmarketModifyOrder(body.accountId, body.orderId, body.order),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["moonmarket", "live-orders", variables.accountId] });
      void queryClient.invalidateQueries({ queryKey: ["moonmarket", "funds", variables.accountId] });
      void queryClient.invalidateQueries({ queryKey: ["moonmarket", "portfolio", variables.accountId] });
    },
  });
}
