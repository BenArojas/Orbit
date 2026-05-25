import api from "@/api/axios";
import {
  fetchExpirations,
  fetchOptionChain,
  fetchStockDetails,
  StockDetailsResponse
} from "@/api/stock";
import BlinkingDot from '@/components/BlinkingDot';
import CandleStickChart from "@/components/charts/CandleSticksChart";
import { useAccountPermissions } from "@/hooks/useAccountPermissions";
import { useStockStore } from "@/stores/stockStore";
import { OptionContract, OptionsChainData } from "@/types/options";
import {
  Box,
  Button,
  ButtonGroup,
  CircularProgress,
  Stack,
  Typography,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { startTransition, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import DepthOfBookTable from "./DepthOfBookTable";
import LiveQuoteDisplay from "./LiveQuoteDisplay";
import OptionsChain from "./options/OptionsChain";
import { PositionDetails } from "./PositionDetails";
import OrderPanel from "./trading/OrderPanel";

const timePeriods = ["1D", "7D", "1M", "3M", "YTD", "1Y", "5Y"];

export interface ChartBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface TradingTarget {
  conid: number;
  name: string; // A clean name for display, e.g., "Stock: AAPL" or "Option: AAPL..."
  type: "STOCK" | "OPTION";
}

export default function StockItem() {

  const [isChartLoading,setIsChartLoading] = useState<boolean>(true)
  const { conid: conidFromUrl } = useParams<{ conid: string }>();
  const [view, setView] = useState<"chart" | "options">("chart");
  const [tradingTarget, setTradingTarget] = useState<TradingTarget | null>(
    null
  );

  // Chart State
  const selectedPeriod = useStockStore((state) => state.activeStock.selectedPeriod);
  const setSelectedPeriod = useStockStore((state) => state.setSelectedPeriod);

  // Options State
  const [selectedExpiration, setSelectedExpiration] = useState<string>("");
  const [optionsChainData, setOptionsChainData] =
    useState<OptionsChainData | null>(null);

  // --- Granular Store Subscriptions (The Fix) ---
  const companyName = useStockStore((state) => state.activeStock.companyName);
  const ticker = useStockStore((state) => state.activeStock.ticker);
  const quote = useStockStore((state) => state.activeStock.quote);
  const depth = useStockStore((state) => state.activeStock.depth);
  const selectedAccountId = useStockStore((state) => state.selectedAccountId);

  // Actions from the store
  const setInitialQuote = useStockStore((state) => state.setInitialQuote);
  const setInitialChartData = useStockStore(
    (state) => state.setInitialChartData
  );
  const subscribeToStock = useStockStore((state) => state.subscribeToStock);
  const unsubscribeFromStock = useStockStore(
    (state) => state.unsubscribeFromStock
  );
  const setPreloadedDetails = useStockStore(
    (state) => state.setPreloadedDetails
  );
  const setPositions = useStockStore((state) => state.setPositions);

  const conid = conidFromUrl ? parseInt(conidFromUrl, 10) : null;

  const { data: permissions } = useAccountPermissions();

  const { data: stockDetails, isLoading: isDetailsLoading } =
    useQuery<StockDetailsResponse>({
      queryKey: ["stockDetails", conid, selectedAccountId],
      queryFn: () => fetchStockDetails(conid!, selectedAccountId!),
      enabled: !!conid && !!selectedAccountId,
    });

  const isPageLoading =
    isDetailsLoading || stockDetails?.staticInfo?.conid !== conid;

  useEffect(() => {
    if (stockDetails) {
      // Data has arrived, populate the store
      startTransition(() => {
        setPreloadedDetails(stockDetails.staticInfo);
        setInitialQuote({
          ...stockDetails.quote,
          conid: stockDetails.staticInfo.conid,
        });
        setPositions({
          stock: stockDetails.positionInfo,
          options: stockDetails.optionPositions,
        });
      });
      if (stockDetails.staticInfo) {
        setTradingTarget({
          conid: stockDetails.staticInfo.conid,
          name: `Stock: ${stockDetails.staticInfo.ticker}`,
          type: "STOCK",
        });
      }

      // Subscribe to live updates
      subscribeToStock(conid!);
    }

    // Unsubscribe when the component unmounts or conid changes
    return () => {
      if (conid) {
        unsubscribeFromStock(conid);
      }
    };
  }, [stockDetails, conid]);

  const {
    data: expirations,
    isLoading: isExpirationsLoading,
    error: expirationsError,
  } = useQuery({
    queryKey: ["expirations", ticker],
    queryFn: () => fetchExpirations(ticker!),
    enabled: view === "options" && !!ticker,
  });

  useEffect(() => {
    if (expirations && expirations.length > 0 && !selectedExpiration) {
      setSelectedExpiration(expirations[0]);
    }
  }, [expirations, selectedExpiration]);

  const {
    data: chainResponse,
    isLoading: isChainLoading,
    error: chainError,
  } = useQuery({
    queryKey: ["optionChain", ticker, selectedExpiration],
    queryFn: () => fetchOptionChain(ticker!, selectedExpiration!),
    enabled: !!ticker && !!selectedExpiration,
  });

  useEffect(() => {
    if (chainResponse) {
      setOptionsChainData(chainResponse.chain);
    }
  }, [chainResponse]);

  const handleChainUpdate = (updatedChain: OptionsChainData) => {
    setOptionsChainData(updatedChain);
  };

  useEffect(() => {
    if (!conid) return;
 
    const fetchChartData = async () => {
      setIsChartLoading(true);
      try {
        const historyResponse = await api.get<ChartBar[]>("/market/history", {
          params: { conid, period: selectedPeriod },
        });
 
        // BUG FIX: Set the chart data in the store with the fetched data
        startTransition(() => {
          setInitialChartData(historyResponse.data);
        });
      } catch (error) {
        console.error("Failed to fetch chart history:", error);
        // Optionally clear data or show an error state
        startTransition(() => {
          setInitialChartData([]);
        });
      } finally {
        startTransition(() => setIsChartLoading(false));
      }
    };
 
    fetchChartData();
    // This effect depends on the selected time period
  }, [conid, selectedPeriod, setInitialChartData]);


  const { isTradingDisabled, disabledReason } = useMemo(() => {
    if (!permissions || !tradingTarget) {
      return {
        isTradingDisabled: true,
        disabledReason: "Loading account permissions...",
      };
    }

    if (tradingTarget.type === "STOCK") {
      if (!permissions.canTrade) {
        return {
          isTradingDisabled: true,
          disabledReason: "Stock trading is not permitted on this account.",
        };
      }
    }

    if (tradingTarget.type === "OPTION") {
      if (!permissions.allowOptionsTrading) {
        return {
          isTradingDisabled: true,
          disabledReason: "Options trading is not permitted on this account.",
        };
      }
    }
    return { isTradingDisabled: false, disabledReason: "" };
  }, [permissions, tradingTarget]);

  const handleOptionSelect = (
    option: OptionContract,
    optionType: "call" | "put"
  ) => {
    const optionName = `${ticker} ${selectedExpiration} ${
      option.strike
    } ${optionType.toUpperCase()}`;

    setTradingTarget({
      conid: option.contractId,
      name: `Option: ${optionName}`,
      type: "OPTION",
    });

    toast.info(`Trading target set to: ${optionName}`);
  };

  const handleRevertToStock = () => {
    if (stockDetails?.staticInfo) {
      setTradingTarget({
        conid: stockDetails.staticInfo.conid,
        name: `Stock: ${stockDetails.staticInfo.ticker}`,
        type: "STOCK",
      });
      toast.info("Trading target reset to stock.");
    }
  };

  if (isPageLoading) {
    return (
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "80vh",
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box
      className="layoutContainer"
      sx={{
        p: 2,
        display: "grid",
        gridTemplateRows: "auto 1fr",
        gridTemplateColumns: "2fr 1fr",
        gap: "0 20px",
        height: "calc(100vh - 80px)",
      }}
    >
      <Typography
        variant="h5"
        component="h2"
        gutterBottom
        sx={{ gridColumn: "1 / -1" }}
      >
        {companyName} ({ticker})
      </Typography>

      <div
        className="chart-and-info"
        style={{
          gridRow: 2,
          gridColumn: 1,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        <LiveQuoteDisplay quote={quote} />
        <Stack
          sx={{ my: 2 }}
          direction="row-reverse"
          justifyContent={"space-between"}
        >
          <ButtonGroup variant="outlined" aria-label="view selector">
            <Button
              variant={view === "chart" ? "contained" : "outlined"}
              onClick={() => setView("chart")}
            >
              Chart
            </Button>
            <Button
              variant={view === "options" ? "contained" : "outlined"}
              onClick={() => setView("options")}
            >
              Options
            </Button>
          </ButtonGroup>
          {view === "chart" && (
            <Stack direction="row" alignItems="center" spacing={2}>
            {/* Show the indicator when the 1D period is selected */}
            {selectedPeriod === '1D' && (
              <Stack direction="row" alignItems="center" spacing={0.5}>
                <BlinkingDot />
                <Typography variant="caption" color="text.secondary">
                  Live
                </Typography>
              </Stack>
            )}
            <ButtonGroup variant="outlined" aria-label="time period selector">
              {timePeriods.map((period) => (
                <Button
                  key={period}
                  variant={selectedPeriod === period ? "contained" : "outlined"}
                  onClick={() => setSelectedPeriod(period)}
                >
                  {period}
                </Button>
              ))}
            </ButtonGroup>
          </Stack>
          )}
        </Stack>

        {view === "chart" &&
          (isChartLoading ? (
            <Box
              sx={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                height: "500px",
              }}
            >
              <CircularProgress />
            </Box>
          ) : (
            <CandleStickChart />
          ))}

        {view === "options" && (
          <OptionsChain
            allStrikes={chainResponse?.all_strikes || []}
            ticker={ticker || ""}
            onChainUpdate={handleChainUpdate}
            chainData={optionsChainData}
            expirations={expirations || []}
            selectedExpiration={selectedExpiration}
            onExpirationChange={(e) => setSelectedExpiration(e.target.value)}
            isLoading={isExpirationsLoading || isChainLoading}
            error={expirationsError?.message || chainError?.message || null}
            currentPrice={quote.lastPrice || 0}
            onOptionSelect={handleOptionSelect}
            isTradingEnabled={permissions?.allowOptionsTrading ?? false}
          />
        )}
      </div>
      <div
        className="trading-panel"
        style={{
          gridRow: 2,
          gridColumn: 2,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          overflowY: "auto",
          gap: "10px",
        }}
      >
        <PositionDetails />
        <DepthOfBookTable depth={depth} />
        <OrderPanel
          tradingTarget={tradingTarget}
          onRevertToStock={handleRevertToStock}
          disabled={isTradingDisabled}
          disabledReason={disabledReason}
        />
      </div>
    </Box>
  );
}