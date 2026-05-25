// src/components/trading/OrderPanel.tsx

import React, { useEffect, useState } from "react";
import { Paper, Collapse, Alert, Typography, Box, Button, CircularProgress } from "@mui/material";
import { useStockStore } from "@/stores/stockStore";
import { useAccountSummary, useConfirmOrder, usePlaceOrder, usePreviewOrder } from "@/hooks/useOrderMutations";
import { toast } from "sonner";
import { v4 as uuidv4 } from "uuid";

import { TradingTarget } from "@/types/orderTypes";
import { OrderPanelHeader } from "./OrderPanelHeader";
import { OrderInfoDisplay } from "./OrderInfoDisplay";
import { OrderFormFields } from "./OrderFormFields";
import { OrderResultDisplay } from "./OrderResultDisplay";

interface OrderPanelProps {
  tradingTarget: TradingTarget | null;
  onRevertToStock: () => void;
  disabled?: boolean;
  disabledReason?: string;
}

const OrderPanel: React.FC<OrderPanelProps> = ({ tradingTarget, onRevertToStock, disabled = false, disabledReason = "" }) => {
  // --- UI & Form State ---
  const [isExpanded, setIsExpanded] = useState(true);
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [quantity, setQuantity] = useState(1);
  const [orderType, setOrderType] = useState("LMT");
  const [tif, setTif] = useState("DAY");
  const [price, setPrice] = useState("");
  const [auxPrice, setAuxPrice] = useState("");
  const [isBracketOrder, setIsBracketOrder] = useState(false);
  const [profitTakerPrice, setProfitTakerPrice] = useState("");
  const [stopLossPrice, setStopLossPrice] = useState("");

  // --- API/Data State ---
  const [previewData, setPreviewData] = useState<any>(null);
  const [orderIdToPlace, setOrderIdToPlace] = useState<string | null>(null);
  const [replyId, setReplyId] = useState<string | null>(null);

  // --- Hooks & Global State ---
  const selectedAccountId = useStockStore((state) => state.selectedAccountId);
  const previewMutation = usePreviewOrder();
  const placeMutation = usePlaceOrder();
  const confirmMutation = useConfirmOrder();
  const { data: accountSummary, isLoading: isSummaryLoading } = useAccountSummary(selectedAccountId);

  // --- State Reset Logic ---
  const resetOrderState = () => { setPreviewData(null); setOrderIdToPlace(null); setReplyId(null); };
  useEffect(() => {
    resetOrderState();
    if (!isBracketOrder) { setProfitTakerPrice(""); setStopLossPrice(""); }
  }, [side, quantity, orderType, price, auxPrice, tif, isBracketOrder, tradingTarget]);

  // --- API Response Handling ---
  const handleOrderResponse = (response: any) => {
    const data = response.data[0];
    if (data.error) { toast.error(`Order Rejected: ${data.error}`); resetOrderState(); return; }
    if (data.id) { toast.info("Confirmation required."); setReplyId(data.id); return; }
    if (data.order_id) { setReplyId(null); setOrderIdToPlace(data.order_id); toast.success(`Order ${data.order_id} has been submitted!`); return; }
    toast.error("Received an unknown response from the server."); resetOrderState();
  };

  // --- Event Handlers ---
  const handlePreview = () => {
    if (!tradingTarget?.conid || !selectedAccountId) return;
    const orderPayload: any = { conid: tradingTarget.conid, side, quantity, orderType, tif, price: parseFloat(price) || undefined, auxPrice: parseFloat(auxPrice) || undefined };
    previewMutation.mutate({ accountId: selectedAccountId, order: orderPayload }, {
      onSuccess: (res) => setPreviewData(res.data),
      onError: (err: any) => setPreviewData({ error: err.response?.data?.error || "Preview failed." }),
    });
  };

  const handlePlaceOrder = () => {
    if (!selectedAccountId || !tradingTarget?.conid) return;
    const parentId = `brkt-${uuidv4()}`;
    const baseOrder: any = { conid: tradingTarget.conid, side, quantity, orderType, tif, price: parseFloat(price) || undefined, auxPrice: parseFloat(auxPrice) || undefined };
    let orders = [baseOrder];

    if (isBracketOrder) {
      if (!profitTakerPrice || !stopLossPrice) { toast.error("Please fill out both bracket prices."); return; }
      const oppositeSide = side === "BUY" ? "SELL" : "BUY";
      baseOrder.cOID = parentId;
      orders.push({ conid: tradingTarget.conid, parentId, side: oppositeSide, quantity, orderType: "LMT", price: parseFloat(profitTakerPrice), tif: "GTC", isSingleGroup: true });
      orders.push({ conid: tradingTarget.conid, parentId, side: oppositeSide, quantity, orderType: "STP", price: parseFloat(stopLossPrice), tif: "GTC", isSingleGroup: true });
    }
    placeMutation.mutate({ accountId: selectedAccountId, orders }, { onSuccess: handleOrderResponse, onError: (err: any) => toast.error(`Error: ${err.response?.data?.error || "Placement failed."}`) });
  };

  const handleConfirm = (confirmed: boolean) => {
    if (!replyId) return;
    if (!confirmed) { toast.warning("Order canceled."); resetOrderState(); return; }
    confirmMutation.mutate({ replyId, confirmed: true }, { onSuccess: handleOrderResponse, onError: (err: any) => toast.error("Confirmation failed.") });
  };

  // --- Derived State & Render ---
  const isLoading = placeMutation.isPending || confirmMutation.isPending;
  const cashBalance = accountSummary?.totalcashvalue?.amount ?? 0;
  const orderTotal = parseFloat(previewData?.amount?.total?.replace(/,/g, "") || "0");
  const usesMargin = side === "BUY" && orderTotal > cashBalance && cashBalance > 0;

  if (disabled) {
    return (<Paper variant="outlined" sx={{ p: 2 }}><Alert severity="warning"><Typography variant="h6" component="p" gutterBottom>Trading Disabled</Typography>{disabledReason}</Alert></Paper>);
  }

  return (
    <Paper variant="outlined" sx={{ display: "flex", flexDirection: "column", maxHeight: "50vh" }}>
      <OrderPanelHeader isExpanded={isExpanded} toggleExpand={() => setIsExpanded(!isExpanded)} />
      <Collapse in={isExpanded} sx={{ overflowY: "auto" }}>
        <OrderInfoDisplay tradingTarget={tradingTarget} onRevertToStock={onRevertToStock} accountSummary={accountSummary} isSummaryLoading={isSummaryLoading} />
        <OrderFormFields {...{ side, setSide, orderType, setOrderType, tif, setTif, quantity, setQuantity, price, setPrice, auxPrice, setAuxPrice, isBracketOrder, setIsBracketOrder, profitTakerPrice, setProfitTakerPrice, stopLossPrice, setStopLossPrice }}/>
        
        {/* Action Buttons */}
        <Box sx={{ p: 2, pt: 0 }}>
          {!isBracketOrder ? (
            <Button variant="contained" onClick={handlePreview} disabled={previewMutation.isPending}>
              {previewMutation.isPending ? <CircularProgress size={24} /> : "Preview Order"}
            </Button>
          ) : (
            <Button variant="contained" color="secondary" onClick={handlePlaceOrder} disabled={isLoading}>
              {placeMutation.isPending ? <CircularProgress size={24} /> : "Place Bracket Order"}
            </Button>
          )}
        </Box>
        
        {/* Results / Confirmation */}
        <OrderResultDisplay
          previewData={previewData}
          replyId={replyId}
          orderIdToPlace={orderIdToPlace}
          isConfirming={confirmMutation.isPending}
          onConfirm={handleConfirm}
          onPlaceFromPreview={handlePlaceOrder}
          isPlacing={placeMutation.isPending}
          usesMargin={usesMargin}
          side={side}
        />
      </Collapse>
    </Paper>
  );
};

export default React.memo(OrderPanel);