/**
 * MoonMarketModule — Plan #3 portfolio dashboard.
 *
 * Scope is intentionally narrow: portfolio allocation chart deck on the left,
 * stacked performance cards on the right, no HistoricalDataCard/transactions/
 * order ticket/options yet.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, BriefcaseBusiness } from "lucide-react";
import { api } from "@/lib/api";
import { GraphSwitcher } from "./GraphSwitcher";
import { PerformanceCards } from "./PerformanceCards";
import { PortfolioChart } from "./PortfolioChart";
import { formatMoney, formatNumber, formatPercent } from "./format";
import type { GraphType, MoonMarketAllocationItem, MoonMarketPosition } from "./types";

function PositionInspector({
  position,
  allocation,
}: {
  position?: MoonMarketPosition;
  allocation?: MoonMarketAllocationItem;
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
  return (
    <section data-testid="moonmarket-position-inspector" className="mt-4 rounded-md border border-border bg-[var(--bg-2)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-[var(--text-3)]">Position Inspector</div>
          <div className="mt-1 flex items-baseline gap-2">
            <h3 className="text-[18px] font-semibold">{position.symbol}</h3>
            <span className="text-[11px] text-[var(--text-3)]">{position.asset_class || "Instrument"}</span>
          </div>
          <p className="mt-1 truncate text-[11px] text-[var(--text-3)]">{position.description}</p>
        </div>
        <div className={pnlPositive ? "font-data text-[20px] text-[var(--clr-green)]" : "font-data text-[20px] text-[var(--clr-red)]"}>
          {formatMoney(position.unrealized_pnl, position.currency)}
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

export function MoonMarketModule() {
  const navigate = useNavigate();
  const [graphType, setGraphType] = useState<GraphType>("treemap");
  const [period, setPeriod] = useState("1Y");
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [selectedConid, setSelectedConid] = useState<number | null>(null);

  const accountsQuery = useQuery({
    queryKey: ["moonmarket", "accounts"],
    queryFn: ({ signal }) => api.moonmarketAccounts(signal),
  });

  const defaultAccountId = useMemo(() => {
    const data = accountsQuery.data;
    return data?.selected_account_id ?? data?.accounts[0]?.account_id ?? null;
  }, [accountsQuery.data]);

  useEffect(() => {
    if (!selectedAccountId && defaultAccountId) {
      setSelectedAccountId(defaultAccountId);
    }
  }, [defaultAccountId, selectedAccountId]);

  const accountId = selectedAccountId ?? defaultAccountId;

  const portfolioQuery = useQuery({
    queryKey: ["moonmarket", "portfolio", accountId],
    enabled: Boolean(accountId),
    queryFn: ({ signal }) => api.moonmarketPortfolio(accountId ?? undefined, signal),
  });

  const performanceQuery = useQuery({
    queryKey: ["moonmarket", "performance", accountId, period],
    enabled: Boolean(accountId),
    queryFn: ({ signal }) => api.moonmarketPerformance(accountId as string, period, signal),
  });

  const portfolio = portfolioQuery.data;
  const positions = portfolio?.positions ?? [];
  const allocation = portfolio?.allocation ?? [];
  const currency = positions[0]?.currency ?? "USD";
  const isLoading = accountsQuery.isLoading || portfolioQuery.isLoading;
  const portfolioError = accountsQuery.error ?? portfolioQuery.error;
  const portfolioSummary = portfolio
    ? `${positions.length} positions · ${formatMoney(portfolio.total_market_value, currency)} total value`
    : portfolioError
      ? "Portfolio data unavailable"
      : "Loading portfolio positions";
  const selectedPosition = selectedConid
    ? positions.find((position) => position.conid === selectedConid)
    : undefined;
  const selectedAllocation = selectedConid
    ? allocation.find((item) => item.conid === selectedConid)
    : undefined;

  useEffect(() => {
    if (selectedConid && positions.length && !positions.some((position) => position.conid === selectedConid)) {
      setSelectedConid(null);
    }
  }, [positions, selectedConid]);

  return (
    <div className="min-h-screen bg-[var(--bg-1)] text-foreground">
      <header className="flex min-h-14 items-center justify-between gap-3 border-b border-border px-4">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="flex h-8 items-center gap-2 rounded-md border border-border px-2 text-[11px] text-[var(--text-2)] hover:border-[var(--clr-cyan)] hover:text-[var(--text-1)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.7} />
            Back to Orbit
          </button>
          <div className="flex min-w-0 items-center gap-2">
            <BriefcaseBusiness className="h-5 w-5 text-[var(--clr-cyan)]" strokeWidth={1.6} />
            <div>
              <h1 className="text-[15px] font-semibold">MoonMarket</h1>
              <p className="text-[10px] text-[var(--text-3)]">Portfolio command deck</p>
            </div>
          </div>
        </div>

        <select
          value={accountId ?? ""}
          onChange={(event) => setSelectedAccountId(event.target.value)}
          disabled={!accountsQuery.data?.accounts.length}
          className="h-8 min-w-36 rounded-md border border-border bg-[var(--bg-2)] px-2 text-[11px] text-[var(--text-2)] outline-none disabled:opacity-50"
        >
          {(accountsQuery.data?.accounts ?? []).map((account) => (
            <option key={account.account_id} value={account.account_id}>
              {account.label}
            </option>
          ))}
        </select>
      </header>

      <main className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="min-w-0">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[16px] font-semibold">Portfolio Allocation</h2>
              <p className="text-[11px] text-[var(--text-3)]">{portfolioSummary}</p>
            </div>
            <GraphSwitcher value={graphType} onChange={setGraphType} />
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
              onSelect={(item) => setSelectedConid(item.conid)}
            />
          )}

          {!portfolioError && !isLoading && graphType !== "leaders" && (
            <PositionInspector position={selectedPosition} allocation={selectedAllocation} />
          )}
        </section>

        <section className="min-w-0">
          <div className="mb-3 grid grid-cols-2 gap-3">
            <div className="rounded-md border border-border bg-[var(--bg-2)] p-3">
              <div className="text-[10px] uppercase text-[var(--text-3)]">Unrealized P&L</div>
              <div className={portfolio && portfolio.total_unrealized_pnl >= 0 ? "mt-1 font-data text-[18px] text-[var(--clr-green)]" : "mt-1 font-data text-[18px] text-[var(--clr-red)]"}>
                {portfolio ? formatMoney(portfolio.total_unrealized_pnl, currency) : "--"}
              </div>
            </div>
            <div className="rounded-md border border-border bg-[var(--bg-2)] p-3">
              <div className="text-[10px] uppercase text-[var(--text-3)]">Largest Weight</div>
              <div className="mt-1 font-data text-[18px] text-[var(--text-1)]">
                {allocation[0] ? formatPercent(allocation[0].percent) : "--"}
              </div>
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
    </div>
  );
}
