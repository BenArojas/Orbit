// src/components/options/StrikeRow.tsx

import React from "react";
import { Box, Chip, Grid, Skeleton } from "@mui/material";
import { OptionContract } from "@/types/options";
import { ContractData } from "./ContractData";

interface StrikeRowProps {
  strike: number;
  call?: OptionContract;
  put?: OptionContract;
  isLoading: boolean;
  currentPrice: number;
  isTradingEnabled: boolean;
  onFetchData: () => void;
  onSelectContract: (type: 'call' | 'put') => void;
}

export const StrikeRow = React.forwardRef<HTMLDivElement, StrikeRowProps>(
  ({ strike, call, put, isLoading, currentPrice, onFetchData, onSelectContract, isTradingEnabled }, ref) => {
    const hasData = !!call || !!put;
    const itmGreen = "rgba(38, 166, 154, 0.15)";
    const otmRed = "rgba(239, 83, 80, 0.15)";

    const interactiveSx = isTradingEnabled
      ? { cursor: 'pointer', '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.05)' } }
      : { cursor: 'not-allowed' };

    const renderContent = () => {
      if (!hasData) {
        return (
          <Box onClick={onFetchData} sx={{ cursor: 'pointer' }}>
            <Grid container alignItems="center" justifyContent="center">
              <Grid item xs={5} sx={{ p: 1.5 }}><Skeleton variant="text" width="90%" /></Grid>
              <Grid item xs={2} textAlign="center"><Chip label={strike.toFixed(2)} /></Grid>
              <Grid item xs={5} sx={{ p: 1.5 }}><Skeleton variant="text" width="90%" sx={{ ml: "auto" }} /></Grid>
            </Grid>
          </Box>
        );
      }

      return (
        <Grid container alignItems="center" justifyContent="center">
          <Grid item xs={5} onClick={() => call && onSelectContract('call')} sx={{ ...interactiveSx, p: 1.5, backgroundColor: strike < currentPrice ? itmGreen : 'transparent' }}>
            {isLoading ? <Skeleton variant="text" width="90%" /> : (call && <ContractData contract={call} type="call" />)}
          </Grid>
          <Grid item xs={2} textAlign="center"><Chip label={strike.toFixed(2)} /></Grid>
          <Grid item xs={5} onClick={() => put && onSelectContract('put')} sx={{ ...interactiveSx, p: 1.5, backgroundColor: strike > currentPrice ? otmRed : 'transparent' }}>
            {isLoading ? <Skeleton variant="text" width="90%" sx={{ ml: "auto" }} /> : (put && <ContractData contract={put} type="put" />)}
          </Grid>
        </Grid>
      );
    };

    return (
      <Box ref={ref} sx={{ borderBottom: "1px solid #333" }}>
        {renderContent()}
      </Box>
    );
  }
);