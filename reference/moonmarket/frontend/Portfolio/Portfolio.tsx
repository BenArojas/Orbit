import DataGraph from "@/pages/Portfolio/DataGraph";
import { ErrorFallback } from "@/components/ErrorFallBack";
import GraphMenu, { GraphType } from "@/pages/Portfolio/GraphMenu";
import { HistoricalDataCard } from "@/pages/Portfolio/HistoricalDataCard";
import PerformanceCards from "@/pages/Portfolio/PerformanceCards";
import useGraphData from "@/hooks/useGraphData";
import {  useStockStore } from "@/stores/stockStore";
import "@/styles/App.css";
import { Box, Stack, useMediaQuery, useTheme } from "@mui/material";
import { useEffect, useState } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { StockData } from "@/types/stock";

function Portfolio() {
  const theme = useTheme();
  const isSmallScreen = useMediaQuery(theme.breakpoints.down("xl"));
  const isMobileScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const isMediumScreen = useMediaQuery(
    "(min-width:1550px) and (max-width:1800px)"
  );

  const stocks = useStockStore((state) => state.stocks);
  const status = useStockStore((state) => state.connectionStatus);
  const connectionStatus = useStockStore((state) => state.connectionStatus);
  const subscribeToPortfolio = useStockStore(state => state.subscribeToPortfolio);
  const unsubscribeFromPortfolio = useStockStore(state => state.unsubscribeFromPortfolio);



  useEffect(() => {
    // Only try to subscribe if the connection is actually active.
    if (connectionStatus === 'connected') {
      // console.log("Portfolio page is visible and connected, subscribing to data...");
      subscribeToPortfolio();
    }

    // When the component unmounts (you navigate away), unsubscribe.
    return () => {
      // console.log("Portfolio page is hidden, unsubscribing from data...");
      unsubscribeFromPortfolio();
    };
  }, [connectionStatus, subscribeToPortfolio, unsubscribeFromPortfolio]);



  if (status === "connecting") {
    return <div>Connecting to live data...</div>;
  }

  

  return (
    <Box
      className="custom-scrollbar"
      sx={{
        display: "flex",
        flexDirection: isSmallScreen ? "column" : "row",
        gridTemplateColumns: isSmallScreen ? "1fr" : "1000px auto",
        paddingX: isMobileScreen ? 2 : isSmallScreen ? 2 : 8,
        overflowY: "auto",
        height: isSmallScreen && !isMobileScreen ? "83vh" : "100%",
        gap: isMobileScreen ? 2 : isSmallScreen ? 2 : 4,
        alignItems: isMobileScreen ? "center" : "flex-start",
      }}
    >
      <ErrorBoundary FallbackComponent={ErrorFallback}>
        <PortfolioContent
          stocks={stocks}
          isMediumScreen={isMediumScreen}
          isMobileScreen={isMobileScreen}
          isSmallScreen={isSmallScreen}
        />
      </ErrorBoundary>

      <Box
        sx={{
          width: isSmallScreen ? "100%" : isMediumScreen ? 500 : 600,
          ml: isSmallScreen ? 0 : "auto",
        }}
      >
        <Stack
          spacing={isSmallScreen ? 4 : 3}
          direction={isSmallScreen ? "column-reverse" : "column"}
          sx={{ height: "100%" }}
        >
          <ErrorBoundary FallbackComponent={ErrorFallback}>
          <PerformanceCards/>
          </ErrorBoundary>
          <HistoricalDataCard />
        </Stack>
      </Box>
    </Box>
  );
}

interface PortfolioContentProps {
  stocks: { [symbol: string]: StockData };
  isSmallScreen: boolean;
  isMobileScreen: boolean;
  isMediumScreen: boolean;
}
function PortfolioContent({
  stocks,
  isSmallScreen,
  isMobileScreen,
  isMediumScreen,
}: PortfolioContentProps) {
  const [selectedGraph, setSelectedGraph] = useState<GraphType>("Treemap");
  const [isDailyView, setIsDailyView] = useState(false);
  const { visualizationData, isDataProcessed } = useGraphData(
    stocks,
    selectedGraph,
    isDailyView
  );

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: isMobileScreen ? "unset" : "center",
        width: isSmallScreen ? "100%" : isMediumScreen ? "800px" : "1000px",
      }}
    >
      <GraphMenu
        selectedGraph={selectedGraph}
        setSelectedGraph={setSelectedGraph}
        isMobileScreen={isMobileScreen}
        isDailyView={isDailyView}
        setIsDailyView={setIsDailyView}
      />
      <DataGraph
        isDataProcessed={isDataProcessed}
        selectedGraph={selectedGraph}
        visualizationData={visualizationData}
        width={
          isMobileScreen
            ? 300
            : isSmallScreen
            ? 500
            : isMediumScreen
            ? 800
            : 1000
        }
        height={
          isMobileScreen
            ? 250
            : isSmallScreen
            ? 500
            : isMediumScreen
            ? 550
            : 660
        }
        isDailyView={isDailyView}
      />
    </Box>
  );
}


export default Portfolio;
