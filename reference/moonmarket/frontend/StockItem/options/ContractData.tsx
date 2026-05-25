// src/components/options/ContractData.tsx

import React from "react";
import { Grid, Typography } from "@mui/material";
import { OptionContract, ContractDataKey } from "@/types/options";

interface ContractDataProps {
  contract: OptionContract;
  type: "call" | "put";
}

export const ContractData: React.FC<ContractDataProps> = ({ contract, type }) => {
  const isCall = type === "call";

  const gridOrder: ContractDataKey[] = isCall
    ? ["delta", "bidSize", "askSize", "last", "ask", "bid"]
    : ["bid", "ask", "last", "askSize", "bidSize", "delta"];

  const dataMap: Record<ContractDataKey, string> = {
    delta: contract.delta?.toFixed(2) ?? "-",
    bidSize: contract.bidSize?.toLocaleString() ?? "-",
    askSize: contract.askSize?.toLocaleString() ?? "-",
    last: contract.lastPrice?.toFixed(2) ?? "-",
    ask: contract.ask?.toFixed(2) ?? "-",
    bid: contract.bid?.toFixed(2) ?? "-",
  };

  return (
    <Grid container alignItems="center" justifyContent={isCall ? "flex-start" : "flex-end"} spacing={2}>
      {gridOrder.map((field) => (
        <Grid item key={field} xs sx={{ textAlign: isCall ? "left" : "right", minWidth: "50px" }}>
          <Typography variant="body2">{dataMap[field]}</Typography>
        </Grid>
      ))}
    </Grid>
  );
};