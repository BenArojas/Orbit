import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, ListTree, ShoppingCart } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useOrderTicketStore } from "@/orbit/OrderTicket/useOrderTicketStore";
import { useNavigationStore } from "@/store/navigation";
import { GraphSwitcher } from "./GraphSwitcher";
import { PerformanceCards } from "./PerformanceCards";
import { PortfolioChart, type LeaderSortMode } from "./PortfolioChart";
import { formatMoney, formatNumber, formatPercent } from "./format";
import {
  displayAssetClass,
  displayHoldingName,
  displayHoldingSubtitle,
  isCashAssetClass,
  optionOrderAssetClass,
  type AllocationDisplayMode,
  type DisplayAllocationItem,
} from "./portfolioData";
import type { GraphType, MoonMarketAllocationItem, MoonMarketPosition } from "./types";

function PositionInspector({
  position,
  allocation,
  onTrade,
  onAnalyze,
  onOptions,
}: {
  position?: MoonMarketPosition;
  allocation?: MoonMarketAllocationItem;
  onTrade: (position: MoonMarketPosition) => void;
  onAnalyze: (position: MoonMarketPosition) => void;
  onOptions: (position: MoonMarketPosition) => void;
}) {
  if (!position) {
    return (
      <section className="mt-4 rounded-md border border-dashed border-border bg-[var(--bg-2)]/60 p-4">
        <div className="text-[12px] font-semibold">Position Inspector</div>
        <p className="mt-1 text-[11px] text-[var(--text-3)]">
          Select a holding in the chart to inspect position details.
        </p>
      </section>
    );
  }

  const pnlPositive = position.unrealized_pnl >= 0;
  const disabledActions = isCashAssetClass(position.asset_class);
  return (
    <section data-testid="moonmarket-position-inspector" className="mt-4 rounded-md border border-border bg-[var(--bg-2)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-[var(--text-3)]">Position Inspector</div>
          <div className="mt-1 flex items-baseline gap-2">
            <h3 className="text-[18px] font-semibold">{displayHoldingName(position)}</h3>
            <span className="text-[11px] text-[var(--text-3)]">{displayAssetClass(position)}</span>
          </div>
          <p className="mt-1 truncate text-[11px] text-[var(--text-3)]">{displayHoldingSubtitle(position)}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              aria-label={`Trade ${displayHoldingName(position)}`}
              onClick={() => onTrade(position)}
              disabled={disabledActions}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--clr-cyan)]/60 px-2.5 text-[11px] text-[var(--clr-cyan)] hover:bg-[var(--clr-cyan)]/10 disabled:opacity-40"
            >
              <ShoppingCart className="h-3.5 w-3.5" />
              Trade
            </button>
            <button
              type="button"
              aria-label={`Analyze ${displayHoldingName(position)}`}
              onClick={() => onAnalyze(position)}
              disabled={disabledActions}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-[11px] text-[var(--text-2)] hover:border-[var(--clr-green)] hover:text-[var(--clr-green)] disabled:opacity-40"
            >
              <BarChart3 className="h-3.5 w-3.5" />
              Analyze
            </button>
            <button
              type="button"
              aria-label={`Options ${displayHoldingName(position)}`}
              onClick={() => onOptions(position)}
              disabled={disabledActions}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-[11px] text-[var(--text-2)] hover:border-[var(--clr-cyan)] hover:text-[var(--clr-cyan)] disabled:opacity-40"
            >
              <ListTree className="h-3.5 w-3.5" />
              Options
            </button>
          </div>
          <div className={pnlPositive ? "font-data text-[20px] text-[var(--clr-green)]" : "font-data text-[20px] text-[var(--clr-red)]"}>
            {formatMoney(position.unrealized_pnl, position.currency)}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded border border-border bg-[var(--bg-1)] px-3 py-2">
          <div className="text-[10px] uppercase text-[var(--text-3)]">Quantity</div>
          <div className="mt-1 font-data text-[13px]">{formatNumber(position.quantity)}</div>
        </div>
        <div className="rounded border border-border bg-[var(--bg-1)] px-3 py-2">
          <div className="text-[10px] uppercase text-[var(--text-3)]">Last Price</div>
          <div className="mt-1 font-data text-[13px]">{formatMoney(position.last_price, position.currency)}</div>
        </div>
        <div className="rounded border border-border bg-[var(--bg-1)] px-3 py-2">
          <div className="text-[10px] uppercase text-[var(--text-3)]">Market Value</div>
          <div className="mt-1 font-data text-[13px]">{formatMoney(position.market_value, position.currency)}</div>
        </div>
        <div className="rounded border border-border bg-[var(--bg-1)] px-3 py-2">
          <div className="text-[10px] uppercase text-[var(--text-3)]">Portfolio Weight</div>
          <div className="mt-1 font-data text-[13px]">{allocation ? formatPercent(allocation.percent) : "--"}</div>
        </div>
      </div>
    </section>
  );
}

function GroupInspector({ group, onSelect }: { group: DisplayAllocationItem; onSelect: (item: MoonMarketAllocationItem) => void }) {
  const children = group.grouped_children ?? [];
  return (
    <section data-testid="moonmarket-group-inspector" className="mt-4 rounded-md border border-border bg-[var(--bg-2)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-[var(--text-3)]">Grouped Holdings</div>
          <h3 className="mt-1 text-[18px] font-semibold">Others</h3>
          <p className="text-[11px] text-[var(--text-3)]">{children.length} smaller positions represented in this box.</p>
        </div>
        <div className="text-right font-data text-[18px]">{formatMoney(group.value)}</div>
      </div>
      <div className="mt-3 max-h-52 overflow-y-auto rounded border border-border">
        {children.map((item) => (
          <button
            key={item.conid}
            type="button"
            onClick={() => onSelect(item)}
            className="grid w-full grid-cols-[minmax(0,1fr)_80px_82px] items-center gap-3 border-b border-border/70 px-3 py-2 text-left text-[11px] last:border-0 hover:bg-[var(--bg-3)]"
          >
            <span className="min-w-0">
              <span className="block truncate font-semibold">{displayHoldingName(item)}</span>
              <span className="block truncate text-[10px] text-[var(--text-3)]">{displayAssetClass(item)}</span>
            </span>
            <span className="text-right font-data">{formatMoney(item.value)}</span>
            <span className="text-right font-data text-[var(--text-3)]">{formatPercent(item.percent)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function PortfolioPage({ accountId, accountsLoading }: { accountId: string | null; accountsLoading?: boolean }) {
  const navigate = useNavigate();
  const openOrderTicket = useOrderTicketStore((state) => state.open);
  const navigateToAnalysis = useNavigationStore((state) => state.navigateToAnalysis);
  const [graphType, setGraphType] = useState<GraphType>("treemap");
  const [displayMode, setDisplayMode] = useState<AllocationDisplayMode>("total");
  const [leaderSortMode, setLeaderSortMode] = useState<LeaderSortMode>("percent");
  const [period, setPeriod] = useState("1Y");
  const [selectedConid, setSelectedConid] = useState<number | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<DisplayAllocationItem | null>(null);

  const portfolioQuery = useQuery({
    queryKey: ["moonmarket", "portfolio", accountId],
    enabled: Boolean(accountId),
    queryFn: ({ signal }) => api.moonmarketPortfolio(accountId ?? undefined, signal),
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  });

  const performanceQuery = useQuery({
    queryKey: ["moonmarket", "performance", accountId, period],
    enabled: Boolean(accountId),
    queryFn: ({ signal }) => api.moonmarketPerformance(accountId as string, period, signal),
    staleTime: 15 * 60 * 1000,
  });

  const portfolio = portfolioQuery.data;
  const positions = portfolio?.positions ?? [];
  const allocation = portfolio?.allocation ?? [];
  const currency = positions[0]?.currency ?? "USD";
  const isLoading = accountsLoading || portfolioQuery.isLoading;
  const portfolioError = portfolioQuery.error;
  const portfolioSummary = portfolio
    ? `${positions.length} positions · ${formatMoney(portfolio.total_market_value, currency)} total value`
    : portfolioError
      ? "Portfolio data unavailable"
      : "Loading portfolio positions";
  const selectedPosition = selectedConid
    != null
    ? positions.find((position) => position.conid === selectedConid)
    : undefined;
  const selectedAllocation = selectedConid
    != null
    ? allocation.find((item) => item.conid === selectedConid)
    : undefined;

  useEffect(() => {
    if (selectedConid != null && positions.length && !positions.some((position) => position.conid === selectedConid)) {
      setSelectedConid(null);
    }
  }, [positions, selectedConid]);

  const handleTrade = (position: MoonMarketPosition) => {
    if (isCashAssetClass(position.asset_class)) return;
    openOrderTicket({
      conid: position.conid,
      symbol: displayHoldingName(position),
      description: displayHoldingSubtitle(position),
      assetClass: optionOrderAssetClass(position),
      side: "SELL",
    });
  };

  const handleAnalyze = (position: MoonMarketPosition) => {
    if (isCashAssetClass(position.asset_class)) return;
    navigateToAnalysis(position.conid, position.symbol);
    navigate("/parallax");
  };

  const handleOptions = (position: MoonMarketPosition) => {
    if (isCashAssetClass(position.asset_class)) return;
    navigate(`/moonmarket/options?conid=${position.conid}&symbol=${encodeURIComponent(position.symbol)}`);
  };

  const handleSelectAllocation = (item: DisplayAllocationItem) => {
    if (item.grouped_children?.length) {
      setSelectedConid(null);
      setSelectedGroup(item);
      return;
    }
    setSelectedGroup(null);
    setSelectedConid(item.conid);
  };

  return (
    <main className="grid h-[calc(100vh-3.5rem)] gap-4 overflow-hidden p-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="min-h-0 min-w-0 overflow-y-auto pr-1">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[16px] font-semibold">Portfolio Allocation</h2>
            <p className="text-[11px] text-[var(--text-3)]">{portfolioSummary}</p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {graphType === "treemap" ? (
              <div className="flex h-9 items-center gap-1 rounded-md border border-border bg-[var(--bg-2)] p-1">
              <button
                type="button"
                aria-pressed={displayMode === "total"}
                onClick={() => setDisplayMode("total")}
                className={displayMode === "total" ? "h-7 rounded bg-[var(--clr-cyan)]/15 px-2 text-[11px] text-[var(--clr-cyan)]" : "h-7 rounded px-2 text-[11px] text-[var(--text-3)]"}
              >
                Since Buy
              </button>
              <button
                type="button"
                aria-pressed={displayMode === "daily"}
                onClick={() => setDisplayMode("daily")}
                className={displayMode === "daily" ? "h-7 rounded bg-[var(--clr-cyan)]/15 px-2 text-[11px] text-[var(--clr-cyan)]" : "h-7 rounded px-2 text-[11px] text-[var(--text-3)]"}
              >
                Today
              </button>
              </div>
            ) : null}
            {graphType === "leaders" ? (
              <label className="flex h-9 items-center gap-2 rounded-md border border-border bg-[var(--bg-2)] px-2 text-[11px] text-[var(--text-3)]">
                Sort
                <select
                  aria-label="Leader sort"
                  value={leaderSortMode}
                  onChange={(event) => setLeaderSortMode(event.target.value as LeaderSortMode)}
                  className="h-7 rounded border border-border bg-[var(--bg-1)] px-2 text-[11px] text-[var(--text-2)] outline-none"
                >
                  <option value="percent">% Gain</option>
                  <option value="gain">$ Gain</option>
                  <option value="size">Size</option>
                </select>
              </label>
            ) : null}
            <GraphSwitcher value={graphType} onChange={setGraphType} />
          </div>
        </div>

        {portfolioError ? (
          <div className="rounded-md border border-[var(--clr-red)]/50 bg-[var(--clr-red)]/10 p-4 text-[12px] text-[var(--clr-red)]">
            MoonMarket portfolio data is unavailable.
          </div>
        ) : isLoading ? (
          <div className="min-h-[360px] animate-pulse rounded-md border border-border bg-[var(--bg-2)]" />
        ) : (
          <PortfolioChart
            type={graphType}
            allocation={allocation}
            selectedConid={selectedConid}
            displayMode={graphType === "treemap" ? displayMode : "total"}
            leaderSortMode={leaderSortMode}
            onSelect={handleSelectAllocation}
          />
        )}

        {!portfolioError && !isLoading && selectedGroup ? (
          <GroupInspector
            group={selectedGroup}
            onSelect={(item) => {
              setSelectedGroup(null);
              setSelectedConid(item.conid);
            }}
          />
        ) : null}

        {!portfolioError && !isLoading && !selectedGroup && (
          <PositionInspector
            position={selectedPosition}
            allocation={selectedAllocation}
            onTrade={handleTrade}
            onAnalyze={handleAnalyze}
            onOptions={handleOptions}
          />
        )}
      </section>

      <section className="min-h-0 min-w-0 overflow-y-auto">
        <div className="mb-3 grid grid-cols-2 gap-3">
          <div className="rounded-md border border-border bg-[var(--bg-2)] p-3">
            <div className="text-[10px] uppercase text-[var(--text-3)]">Unrealized P&L</div>
            <div className={portfolio && portfolio.total_unrealized_pnl >= 0 ? "mt-1 font-data text-[18px] text-[var(--clr-green)]" : "mt-1 font-data text-[18px] text-[var(--clr-red)]"}>
              {portfolio ? formatMoney(portfolio.total_unrealized_pnl, currency) : "--"}
            </div>
          </div>
          <div className="rounded-md border border-border bg-[var(--bg-2)] p-3">
            <div className="text-[10px] uppercase text-[var(--text-3)]">Total Value</div>
            <div className="mt-1 font-data text-[20px] text-[var(--text-1)]">
              {portfolio ? formatMoney(portfolio.total_market_value, currency) : "--"}
            </div>
            <div className="mt-1 text-[10px] text-[var(--text-3)]">{allocation[0] ? `${displayHoldingName(allocation[0])} largest` : "Positions + cash"}</div>
          </div>
        </div>
        <PerformanceCards
          data={performanceQuery.data}
          period={period}
          onPeriodChange={setPeriod}
          loading={performanceQuery.isLoading}
        />
      </section>
    </main>
  );
}
