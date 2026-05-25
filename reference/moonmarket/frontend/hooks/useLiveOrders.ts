import { cancelOrder, getLiveOrders, modifyOrder } from "@/api/transaction";
import { CancelOrderPayload, ModifyOrderPayload } from "@/types/transaction";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export const useLiveOrders = () => {
    const queryClient = useQueryClient();

    const { data: liveOrders = [], isLoading, error } = useQuery({
        queryKey: ["liveOrders"],
        queryFn: getLiveOrders,
    });
    const invalidateLiveOrders = () => {
        queryClient.invalidateQueries({ queryKey: ["liveOrders"] });
      };

    const cancelMutation = useMutation({
        // The mutation function now receives the payload object
        mutationFn: (payload: CancelOrderPayload) => cancelOrder(payload),
        onSuccess: () => {
          toast.success("Cancel request submitted! Refreshing orders...");
          invalidateLiveOrders();
        },
        onError: (error: any) => {
          toast.error(`Failed to cancel order: ${error.response?.data?.detail || error.message}`);
        },
      });
    
      const modifyMutation = useMutation({
        // The mutation function now receives the payload object
        mutationFn: (payload: ModifyOrderPayload) => modifyOrder(payload),
        onSuccess: () => {
          toast.success("Modify request submitted! Refreshing orders...");
          invalidateLiveOrders();
        },
        onError: (error: any) => {
          toast.error(`Failed to modify order: ${error.response?.data?.detail || error.message}`);
        },
      });

    return { liveOrders, isLoading, error, cancelMutation, modifyMutation };
};