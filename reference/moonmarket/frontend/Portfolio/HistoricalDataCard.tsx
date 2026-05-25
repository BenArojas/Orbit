import { fetchHistoricalStockData, fetchConidForTicker } from '@/api/stock'; 
import { AreaChart } from "@/components/charts/AreaChartLw";
import { ErrorFallback } from "@/components/ErrorFallBack";
import { useAuth } from '@/contexts/AuthContext';
import GraphSkeleton from "@/Skeletons/GraphSkeleton";
import "@/styles/App.css";
import { ChartDataPoint } from '@/types/chart';
import { Button, Card, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { useNavigate, useSearchParams } from "react-router-dom";


const getUnderlyingTicker = (instrumentName: string | null): string => {
  if (!instrumentName) {
  return "BTC"; // Return a default if nothing is selected
  }
  // Splits "IBIT JUL2025 $65.00 C" by spaces and returns the first part.
  return instrumentName.split(" ")[0];
  };

export function HistoricalDataCard() {
  const { isAuth } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedInstrument = searchParams.get("selected");
  const ticker = getUnderlyingTicker(selectedInstrument);
  const [selectedPeriod, setSelectedPeriod] = useState<string>("7D"); // Default period

  const handlePeriodChange = (newPeriod: string) => {
    setSelectedPeriod(newPeriod);
  };

  const { data: conidData, isLoading: isLoadingConid } = useQuery({
    queryKey: ['conidForTicker', ticker],
    queryFn: () => fetchConidForTicker(ticker),
    enabled:  !!ticker && isAuth,
  });

  const conid = conidData?.conid;
  const companyName = conidData?.companyName || ticker;

  const {
    data: chartData,
    isLoading: isLoadingHistory,
    isError,
    error,
  } = useQuery<ChartDataPoint[], Error>({
    queryKey: ["historicalStockData", conid, selectedPeriod],
    queryFn: () => fetchHistoricalStockData(conid!, selectedPeriod),
    enabled: !!conid,
  });

  const handleTradeClick = () => {
    if (conid) {
      navigate(`/app/stock/${conid}`, {
        state: {
          companyName: companyName,
          ticker: ticker,
        },
      });
    }
  };


  if (isLoadingConid || isLoadingHistory) {
    return <GraphSkeleton height={320} />;
  }

  if (isError && error) {
    const errorMessage =
      (error as any)?.response?.data?.detail || // For Axios-like errors
      error.message ||
      "Failed to fetch chart data";
    return <p>Error loading chart data: {errorMessage}</p>;
  }

  if (!chartData || chartData.length === 0) {
    return <p>No Stock data available for the selected period.</p>;
  }

  return (
    <ErrorBoundary FallbackComponent={ErrorFallback}>
      <Card
        sx={{
          display: "flex",
          flexDirection: "column",
          gap: 1,
          padding: "10px 15px",
        }}
      >
        <Stack
          direction="row"
          justifyContent="space-between"
          spacing={2}
          alignItems="center"
        >
          <Stack direction="row" spacing={2} alignItems="center">
            <Typography variant="h5">{ticker}</Typography>
            <Button
              variant="outlined"
              size="medium"
              onClick={handleTradeClick}
              disabled={!conid} // Button is disabled until conid is available
            >
              Trade
            </Button>
          </Stack>
          <div>
            {/* dropdown menu for period */}
            <TextField
              select
              size="small"
              label="Selected Period"
              value={selectedPeriod}
              onChange={(e) => handlePeriodChange(e.target.value)}
              sx={{ minWidth: 120 }}
            >
              <MenuItem value="1D">Last Day</MenuItem>
              <MenuItem value="7D">7 Days</MenuItem>
              <MenuItem value="1M">1 Month</MenuItem>
              <MenuItem value="3M">3 Months</MenuItem>
              <MenuItem value="6M">6 Months</MenuItem>
              <MenuItem value="1Y">1 Year</MenuItem>
            </TextField>
          </div>
        </Stack>
        <AreaChart
          data={chartData}
          colors={{
            lineColor: "#E1E5EB",
            areaTopColor: "#E1E5EB",
          }}
          height={260}
        />
      </Card>
    </ErrorBoundary>
  );
}