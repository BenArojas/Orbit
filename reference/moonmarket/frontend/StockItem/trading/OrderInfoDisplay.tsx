// src/components/trading/OrderInfoDisplay.tsx

import React from "react";
import { Box, Typography, Button, CircularProgress } from "@mui/material";
import { TradingTarget } from "@/types/orderTypes";

interface OrderInfoDisplayProps {
  tradingTarget: TradingTarget | null;
  onRevertToStock: () => void;
  accountSummary: any;
  isSummaryLoading: boolean;
}

export const OrderInfoDisplay: React.FC<OrderInfoDisplayProps> = ({ tradingTarget, onRevertToStock, accountSummary, isSummaryLoading }) => {
  const formatCurrency = (value: number, currency: string = "USD") =>
    new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);

  return (
    <>
      <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'action.hover' }}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ textTransform: 'uppercase' }}>
          Trading
        </Typography>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h6" component="p" noWrap title={tradingTarget?.name}>
            {tradingTarget?.name ?? 'No Instrument Selected'}
          </Typography>
          {tradingTarget?.type === 'OPTION' && (
            <Button size="small" variant="outlined" onClick={onRevertToStock} sx={{ ml: 1, flexShrink: 0 }}>
              Trade Stock
            </Button>
          )}
        </Box>
      </Box>
      {accountSummary && (
        <Box sx={{ p: 2, borderBottom: "1px solid", borderColor: "divider", display: "flex", flexDirection: "column", gap: 1 }}>
          <Typography variant="body2">
            Settled Cash:{" "}
            {isSummaryLoading ? <CircularProgress size={14} /> : <strong>{formatCurrency(accountSummary.totalcashvalue?.amount)}</strong>}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Trading Power:{" "}
            {isSummaryLoading ? <CircularProgress size={14} /> : <strong>{formatCurrency(accountSummary.availablefunds?.amount)}</strong>}
          </Typography>
        </Box>
      )}
    </>
  );
};