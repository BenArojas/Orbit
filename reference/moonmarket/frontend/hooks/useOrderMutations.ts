import { useMutation, useQuery } from '@tanstack/react-query';
import api from '@/api/axios';
import { AxiosError } from 'axios';
import { fetchAccountSummary } from '@/api/user';
import { OrderPayload, PreviewOrderVariables } from '@/types/transaction';



interface ErrorDetail {
  detail?: string;
}

// Hook to preview an order
export const usePreviewOrder = () => {
  // Use the new variables interface
  return useMutation<any, AxiosError<ErrorDetail>, PreviewOrderVariables>({
    mutationFn: ({ accountId, order }) => 
      api.post(
        '/transactions/orders/preview', // URL
        order,                          // Request Body
        { params: { accountId } }       // Axios config with URL query parameters
      ),
  });
};

interface PlaceOrderVariables {
  accountId: string;
  orders: OrderPayload[]; // The payload is now an ARRAY of orders
}

export const usePlaceOrder = () => {
  return useMutation<any, AxiosError<ErrorDetail>, PlaceOrderVariables>({
    mutationFn: ({ accountId, orders }) => 
      api.post(
        '/transactions/orders', 
        orders, 
        { params: { accountId } } 
      ),
  });
};

export const useConfirmOrder = () => {
  return useMutation<any, AxiosError<ErrorDetail>, any>({
    mutationFn: ({ replyId, confirmed }: { replyId: string, confirmed: boolean }) =>
      api.post(`/transactions/orders/reply/${replyId}`, { confirmed }),
  });
};

export const useAccountSummary = (accountId: string | null) => {
  return useQuery({
    queryKey: ["accountSummary", accountId],
    queryFn: () => fetchAccountSummary(accountId!),
    enabled: !!accountId,
    staleTime: 1000 * 60 * 2,
  });
};