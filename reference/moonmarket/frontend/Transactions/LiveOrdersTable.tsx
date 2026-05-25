import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useStockStore } from "@/stores/stockStore";
import { useLiveOrders } from "@/hooks/useLiveOrders";
import { LiveOrder } from "@/types/transaction";

// Define the set of statuses where orders cannot be modified or cancelled.
const NON_ACTIONABLE_STATUSES = new Set([
    'Filled', 
    'Cancelled', 
    'PendingCancel', 
    'ApiCancelled'
]);


export const LiveOrdersTable: React.FC<{ orders: LiveOrder[] }> = ({ orders }) => {
  const { cancelMutation, modifyMutation } = useLiveOrders();
  const selectedAccountId = useStockStore(state => state.selectedAccountId);

  // State for managing the modification dialog
  const [isModifyOpen, setIsModifyOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<LiveOrder | null>(null);
  const [newOrderValues, setNewOrderValues] = useState({ price: "", quantity: "" });

  const handleCancel = (orderId: number) => {
    if (!selectedAccountId) {
      toast.error("No account selected.");
      return;
    }
    toast("Are you sure?", {
        description: `This will cancel order #${orderId}.`,
        action: {
            label: "Confirm Cancel",
            onClick: () => cancelMutation.mutate({ orderId, accountId: selectedAccountId }),
        },
        cancel: "Keep Order",
    });
  };

  // Opens the dialog and populates it with the order's current data
  const openModifyDialog = (order: LiveOrder) => {
    setSelectedOrder(order);
    setNewOrderValues({
      price: order.limitPrice,
      quantity: String(order.quantity),
    });
    setIsModifyOpen(true);
  };

  // Handles the final submission of the modified order
  const handleSaveChanges = () => {
    if (!selectedAccountId || !selectedOrder) {
      toast.error("No account or order selected.");
      return;
    }

    const price = parseFloat(newOrderValues.price);
    const quantity = parseInt(newOrderValues.quantity, 10);

    if (isNaN(price) || price <= 0 || isNaN(quantity) || quantity <= 0) {
        toast.error("Please enter a valid price and quantity.");
        return;
    }

    modifyMutation.mutate({
      orderId: selectedOrder.orderId,
      newOrderData: { price, quantity },
      accountId: selectedAccountId,
    });

    setIsModifyOpen(false);
  };

  return (
    <>
      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold">Live Orders</h3>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead>Side</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.length > 0 ? (
                orders.map((order) => {
                  // Determine if the buttons should be disabled for this order
                  const isActionable = !NON_ACTIONABLE_STATUSES.has(order.status);

                  return (
                    <TableRow key={order.orderId}>
                      <TableCell className="font-medium">{order.orderDesc}</TableCell>
                      <TableCell>{order.side}</TableCell>
                      <TableCell>{order.orderType}</TableCell>
                      <TableCell className="text-right">{order.quantity}</TableCell>
                      <TableCell className="text-right">{order.limitPrice}</TableCell>
                      <TableCell>{order.status}</TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button 
                          variant="outline" 
                          size="sm" 
                          onClick={() => openModifyDialog(order)}
                          disabled={!isActionable} // Disable button based on status
                        >
                          Modify
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleCancel(order.orderId)}
                          disabled={!isActionable} // Disable button based on status
                        >
                          Cancel
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-gray-500">
                    No live orders.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Modify Order Dialog */}
      <Dialog open={isModifyOpen} onOpenChange={setIsModifyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modify Order: {selectedOrder?.ticker}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="price" className="text-right">Price</Label>
              <Input
                id="price"
                type="number"
                value={newOrderValues.price}
                onChange={(e) => setNewOrderValues({ ...newOrderValues, price: e.target.value })}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="quantity" className="text-right">Quantity</Label>
              <Input
                id="quantity"
                type="number"
                value={newOrderValues.quantity}
                onChange={(e) => setNewOrderValues({ ...newOrderValues, quantity: e.target.value })}
                className="col-span-3"
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">Cancel</Button>
            </DialogClose>
            <Button type="button" variant="outline" onClick={handleSaveChanges}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
