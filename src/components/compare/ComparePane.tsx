import PaneToolbar from "./PaneToolbar";
import CompareChart from "./CompareChart";
import { useChartStore } from "@/store/chart";
import { useCompareStore, type ComparePane as ComparePaneType } from "@/store/compare";
import { useCompareData } from "@/hooks/useCompareData";

export interface ComparePaneProps {
  pane: ComparePaneType;
}

const PANE_MIN_HEIGHT = 200;

export default function ComparePane({ pane }: ComparePaneProps) {
  const stockConid = useChartStore((s) => s.activeConid);
  const stockSymbol = useChartStore((s) => s.activeSymbol);
  const reference = useCompareStore((s) => s.reference);
  const panes = useCompareStore((s) => s.panes);
  const setPaneTimeframe = useCompareStore((s) => s.setPaneTimeframe);
  const setPaneLayout = useCompareStore((s) => s.setPaneLayout);
  const removePane = useCompareStore((s) => s.removePane);

  const data = useCompareData(
    stockConid,
    reference.conid,
    pane.timeframe,
    pane.layout,
  );

  const canRemove = panes.length > 1;

  return (
    <div
      className="flex min-h-0 flex-1 flex-col bg-[var(--bg-0)]"
      style={{ minHeight: PANE_MIN_HEIGHT }}
    >
      <PaneToolbar
        paneId={pane.id}
        timeframe={pane.timeframe}
        layout={pane.layout}
        canRemove={canRemove}
        onTimeframeChange={(tf) => setPaneTimeframe(pane.id, tf)}
        onLayoutChange={(layout) => setPaneLayout(pane.id, layout)}
        onRemove={() => removePane(pane.id)}
      />
      <div className="relative min-h-0 flex-1">
        {(() => {
          if (data.error) {
            return (
              <div className="flex h-full items-center justify-center text-xs text-[var(--clr-red)]">
                Failed to load data
              </div>
            );
          }
          const wantsStock = pane.layout !== "refOnly";
          const wantsRef = pane.layout !== "stockOnly";
          const stockEmpty = wantsStock && data.stockCandles !== undefined && data.stockCandles.length === 0;
          const refEmpty = wantsRef && data.refCandles !== undefined && data.refCandles.length === 0;
          if (!data.isLoading && (stockEmpty || refEmpty)) {
            const missing = stockEmpty ? stockSymbol : reference.symbol;
            return (
              <div className="flex h-full items-center justify-center text-xs text-[var(--text-3)]">
                No data for {missing || "this symbol"}
              </div>
            );
          }

          // Cold-start loading state: no candles at all yet — render a
          // labeled pill so the user understands the pane is fetching.
          const hasAnyData =
            (data.stockCandles && data.stockCandles.length > 0) ||
            (data.refCandles && data.refCandles.length > 0);
          if (data.isLoading && !hasAnyData) {
            return (
              <div className="flex h-full items-center justify-center">
                <div className="flex items-center gap-2 rounded border border-[var(--border)] bg-[var(--bg-1)] px-3 py-1.5 font-mono text-[11px] text-[var(--text-2)]">
                  <div className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--clr-cyan)] border-t-transparent" />
                  Loading {stockSymbol || "—"} vs {reference.symbol}…
                </div>
              </div>
            );
          }

          // Mid-flight refetch (timeframe/layout switch): keep the chart
          // visible at reduced opacity and float a small "Loading…" pill
          // so the user knows the displayed candles are about to update.
          return (
            <div className="relative h-full w-full">
              <div
                className={
                  data.isLoading
                    ? "h-full w-full opacity-50 transition-opacity"
                    : "h-full w-full transition-opacity"
                }
              >
                <CompareChart
                  layout={pane.layout}
                  stockCandles={data.stockCandles}
                  refCandles={data.refCandles}
                  stockSymbol={stockSymbol || "—"}
                  refSymbol={reference.symbol}
                  stockLiveTick={data.stockLiveTick}
                  refLiveTick={data.refLiveTick}
                />
              </div>
              {data.isLoading && (
                <div className="pointer-events-none absolute inset-0 flex items-start justify-center pt-3">
                  <div className="flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--bg-1)]/90 px-2.5 py-1 font-mono text-[10px] text-[var(--text-2)] backdrop-blur-sm">
                    <div className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-[var(--clr-cyan)] border-t-transparent" />
                    Loading…
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
