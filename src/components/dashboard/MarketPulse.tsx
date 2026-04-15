/**
 * Market Pulse Bar — Task 3.1
 *
 * A horizontal bar at the top of the Dashboard showing key market indices
 * (SPX, VIX, QQQ, DIA, IWM, etc.) with price, change %, and mini sparklines.
 *
 * Each item is a clickable card — clicking navigates to Analysis for that ticker.
 *
 * Data comes from the backend /market/quote endpoint for each symbol.
 * Sparklines are built from the last 12 candles (5-day bars).
 *
 * Conids are resolved at runtime via /market/conid/{symbol} so they work
 * across paper and live IBKR accounts. Results are cached by TanStack Query.
 *
 * Design: dark bg, monospace prices, colored change %, tiny bar sparklines,
 * glow underline on hover matching up/down color.
 */

import { useQuery } from "@tanstack/react-query";
import { api, type QuoteResponse, type CandleData, type ConidResponse } from "@/lib/api";
import { useNavigationStore } from "@/store";
import { useIbkrReady } from "@/context/GatewayContext";

/** The market symbols we show in the pulse bar */
const PULSE_SYMBOLS = ["SPX", "VIX", "QQQ", "DIA", "IWM", "TLT", "GLD", "USO"];

/** Mini sparkline — 12 tiny bars showing recent price direction */
function MiniSparkline({ candles, isUp }: { candles: CandleData[]; isUp: boolean }) {
  // Take the last 12 candles for the sparkline
  const bars = candles.slice(-12);
  if (bars.length === 0) return null;

  const closes = bars.map((c) => c.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;

  return (
    <div className="flex items-end gap-px" style={{ height: 16 }}>
      {bars.map((bar, i) => {
        const height = Math.max(2, ((bar.close - min) / range) * 14);
        return (
          <div
            key={i}
            className="w-[2px] rounded-sm"
            style={{
              height,
              backgroundColor: isUp ? "var(--clr-green)" : "var(--clr-red)",
              opacity: 0.4,
            }}
          />
        );
      })}
    </div>
  );
}

/** One pulse item — symbol, price, change, sparkline */
function PulseItem({ symbol }: { symbol: string }) {
  const navigateToAnalysis = useNavigationStore((s) => s.navigateToAnalysis);
  const ibkrReady = useIbkrReady();

  // Step 1: Resolve symbol → conid at runtime (cached indefinitely)
  const { data: resolved } = useQuery<ConidResponse>({
    queryKey: ["conid", symbol],
    queryFn: () => api.resolveConid(symbol),
    staleTime: Infinity, // conid never changes within a session
    enabled: ibkrReady,
  });

  const conid = resolved?.conid;

  // Step 2: Fetch live quote (only once we have a conid)
  const { data: quote } = useQuery<QuoteResponse>({
    queryKey: ["quote", conid],
    queryFn: () => api.quote(conid!),
    enabled: ibkrReady && conid != null,
    refetchInterval: 10_000,
  });

  // Step 3: Fetch recent candles for sparkline (5-day window → ~12 daily bars)
  const { data: candles } = useQuery<CandleData[]>({
    queryKey: ["candles", conid, "5D"],
    queryFn: () => api.candles(conid!, "5D"),
    enabled: ibkrReady && conid != null,
    staleTime: 60_000,
  });

  const price = quote?.lastPrice;
  const changePct = quote?.changePercent;
  const isUp = (changePct ?? 0) >= 0;

  return (
    <button
      onClick={() => conid && navigateToAnalysis(conid)}
      className="group relative flex min-w-[115px] flex-col gap-0.5 px-[18px] py-2 transition-colors hover:bg-[var(--bg-2)]"
    >
      {/* Glow underline on hover */}
      <div
        className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full opacity-0 transition-opacity group-hover:opacity-100"
        style={{
          backgroundColor: isUp ? "var(--clr-green)" : "var(--clr-red)",
          boxShadow: `0 0 8px ${isUp ? "var(--clr-green)" : "var(--clr-red)"}`,
        }}
      />

      {/* Top row: symbol + price */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold text-[var(--text-3)]">
          {symbol}
        </span>
        <span className="font-data text-[13px] font-bold text-[var(--text-1)]">
          {price != null ? formatPrice(price) : "--"}
        </span>
      </div>

      {/* Bottom row: change % + sparkline */}
      <div className="flex items-center justify-between gap-2">
        <span
          className={`font-data text-[10px] ${isUp ? "text-up" : "text-down"}`}
        >
          {changePct != null
            ? `${isUp ? "+" : ""}${changePct.toFixed(2)}%`
            : "--"}
        </span>
        {candles && <MiniSparkline candles={candles} isUp={isUp} />}
      </div>
    </button>
  );
}

/** Format price — add commas for thousands */
function formatPrice(price: number): string {
  if (price >= 1000) {
    return price.toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  }
  return price.toFixed(2);
}

/** The full Market Pulse bar */
export default function MarketPulse() {
  return (
    <div className="col-span-2 flex items-center overflow-x-auto border-b border-border bg-[var(--bg-1)]">
      {PULSE_SYMBOLS.map((symbol) => (
        <PulseItem key={symbol} symbol={symbol} />
      ))}
    </div>
  );
}
