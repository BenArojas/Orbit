// src/components/trading/OrderResultDisplay.tsx

import React from "react";
import { Box, Typography, Alert, Button, ButtonGroup, CircularProgress, Divider } from "@mui/material";

interface OrderResultDisplayProps {
  previewData?: { error?: string; amount?: any; equity?: any; warn?: string } | null;
  replyId: string | null;
  orderIdToPlace: string | null;
  isConfirming: boolean;
  onConfirm: (confirmed: boolean) => void;
  onPlaceFromPreview: () => void;
  isPlacing: boolean;
  usesMargin: boolean;
  side: "BUY" | "SELL";
}

const formatIbkrWarning = (rawWarning: string = ""): string => rawWarning.replace(/^\d+\//, "").replace(/<[^>]*>/g, "");

export const OrderResultDisplay: React.FC<OrderResultDisplayProps> = ({ previewData, replyId, orderIdToPlace, isConfirming, onConfirm, onPlaceFromPreview, isPlacing, usesMargin, side }) => {
  if (!previewData && !replyId && !orderIdToPlace) return null;

  return (
    <Box sx={{ p: 2, pt: 0 }}>
      {previewData && (
        <Box sx={{ mt: 2, p: 2, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
          <Typography variant="subtitle1" gutterBottom>Order Preview</Typography>
          <Divider sx={{ mb: 1 }} />
          {previewData.error ? (<Alert severity="error">{previewData.error}</Alert>) : (
            <>
              <Typography variant="body2">
                {side === "BUY" ? "Total Cost: " : "Total Proceeds: "}
                <strong>{previewData.amount?.total}</strong>
              </Typography>
              <Typography variant="body2">Commission: <strong>{previewData.amount?.commission}</strong></Typography>
              <Typography variant="body2">Equity After: <strong>{previewData.equity?.after}</strong></Typography>
              {usesMargin && <Alert severity="info" sx={{ mt: 1 }}>This order will use margin.</Alert>}
              {previewData.warn && <Alert severity="warning" sx={{ mt: 1, whiteSpace: "pre-wrap" }}>{formatIbkrWarning(previewData.warn)}</Alert>}
              {!orderIdToPlace && !replyId && (
                <Button variant="contained" color="primary" onClick={onPlaceFromPreview} disabled={isPlacing} fullWidth sx={{ mt: 2 }}>
                  {isPlacing ? <CircularProgress size={24} /> : "Place Order"}
                </Button>
              )}
            </>
          )}
        </Box>
      )}

      {replyId && (
        <Box sx={{ mt: 2 }}>
          <Alert severity="warning" sx={{ mb: 2 }}>Please confirm the action to submit your order.</Alert>
          <ButtonGroup fullWidth>
            <Button color="success" onClick={() => onConfirm(true)} disabled={isConfirming}>{isConfirming ? <CircularProgress size={24} color="inherit" /> : "Confirm & Submit"}</Button>
            <Button color="error" onClick={() => onConfirm(false)} disabled={isConfirming}>Cancel</Button>
          </ButtonGroup>
        </Box>
      )}
      
      {orderIdToPlace && <Alert severity="success" sx={{ mt: 2 }}>Order Submitted! ID: {orderIdToPlace}</Alert>}
    </Box>
  );
};