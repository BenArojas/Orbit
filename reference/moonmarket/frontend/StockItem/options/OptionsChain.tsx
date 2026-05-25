// src/components/options/OptionsChain.tsx

import { fetchSingleContract } from "@/api/stock";
import { OptionContract, OptionsChainData } from "@/types/options";
import { Alert, Box, CircularProgress, FormControl, InputLabel, MenuItem, Paper, Select, SelectChangeEvent, Typography } from "@mui/material";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { OptionsChainHeader } from "./OptionsChainHeader";
import { StrikeRow } from "./StrikeRow";

interface OptionsChainProps {
  allStrikes: number[];
  ticker: string;
  onChainUpdate: (updatedChain: OptionsChainData) => void;
  chainData: OptionsChainData | null;
  expirations: string[];
  selectedExpiration: string;
  onExpirationChange: (event: SelectChangeEvent<string>) => void;
  isLoading: boolean;
  error: string | null;
  currentPrice: number;
  onOptionSelect: (option: OptionContract, type: 'call' | 'put') => void;
  isTradingEnabled: boolean;
}

export default function OptionsChain({
  allStrikes, ticker, onChainUpdate, chainData, expirations,
  selectedExpiration, onExpirationChange, isLoading, error, currentPrice,
  onOptionSelect, isTradingEnabled
}: OptionsChainProps) {
  const atmStrikeRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const closestStrike = useMemo(
    () => allStrikes.length > 0 ? allStrikes.reduce((prev, curr) =>
        Math.abs(curr - currentPrice) < Math.abs(prev - currentPrice) ? curr : prev
      ) : null,
    [allStrikes, currentPrice]
  );

  useEffect(() => {
    if (scrollContainerRef.current && atmStrikeRef.current) {
      const container = scrollContainerRef.current;
      const target = atmStrikeRef.current;
      const scrollTop = target.offsetTop - (container.clientHeight / 2) + (target.clientHeight / 2);
      container.scrollTo({ top: scrollTop, behavior: "smooth" });
    }
  }, [closestStrike]);

  const { mutate, isPending, variables: pendingStrike } = useMutation({
    mutationFn: (strike: number) =>
      fetchSingleContract({ ticker, expiration: selectedExpiration, strike }),
    onSuccess: (newData) => {
      const strikeKey = newData.strike.toFixed(2);
      onChainUpdate({ ...(chainData || {}), [strikeKey]: newData.data });
    },
    onError: (err, strike) => console.error(`Failed to fetch strike ${strike}`, err),
  });

  const handleSelectContract = (strike: number, type: 'call' | 'put') => {
    if (!isTradingEnabled) return;
    const contract = chainData?.[strike.toFixed(2)]?.[type];
    if (contract) {
      onOptionSelect(contract, type);
    }
  };

  if (isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: 400 }}>
        <CircularProgress />
        <Typography sx={{ ml: 2 }}>Loading Chain Data...</Typography>
      </Box>
    );
  }

  if (error) return <Alert severity="error">{error}</Alert>;

  return (
    <Paper sx={{ p: 2, borderRadius: 2 }}>
      <FormControl fullWidth sx={{ mb: 3 }}>
        <InputLabel id="expiration-select-label" sx={{ color: "#bdbdbd" }}>Expiration Date</InputLabel>
        <Select
          labelId="expiration-select-label"
          value={selectedExpiration}
          label="Expiration Date"
          onChange={onExpirationChange}
          disabled={expirations.length === 0}
          sx={{ color: "white", ".MuiOutlinedInput-notchedOutline": { borderColor: "#555" }, "& .MuiSvgIcon-root": { color: "white" } }}
        >
          {expirations.map((date) => (<MenuItem key={date} value={date}>{date}</MenuItem>))}
        </Select>
      </FormControl>

      {allStrikes.length > 0 && (
        <Box>
          <OptionsChainHeader />
          <Box ref={scrollContainerRef} sx={{ height: "350px", overflowY: "auto" }}>
            {allStrikes.map((strike) => {
              const strikeKey = strike.toFixed(2);
              return (
                <StrikeRow
                  key={strike}
                  ref={strike === closestStrike ? atmStrikeRef : null}
                  strike={strike}
                  call={chainData?.[strikeKey]?.call}
                  put={chainData?.[strikeKey]?.put}
                  isLoading={isPending && pendingStrike === strike}
                  currentPrice={currentPrice}
                  isTradingEnabled={isTradingEnabled}
                  onFetchData={() => mutate(strike)}
                  onSelectContract={(type) => handleSelectContract(strike, type)}
                />
              );
            })}
          </Box>
        </Box>
      )}
    </Paper>
  );
}