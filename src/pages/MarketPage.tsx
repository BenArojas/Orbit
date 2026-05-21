/**
 * Market Page — Structural market overview (renamed from Dashboard).
 *
 * Hosts the gauges, sector performance, and RRG. No watchlist sidebar,
 * no alert log, no trigger management — those live on Today now.
 */
import { ArcGaugeRow } from "@/components/dashboard";
import SectorPerformancePanel from "../components/dashboard/SectorPerformancePanel";
import RRGPanel from "../components/dashboard/RRGPanel";

export default function MarketPage() {
  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <ArcGaugeRow />
      <SectorPerformancePanel />
      <RRGPanel />
    </div>
  );
}
