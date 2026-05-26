import type { ReactNode } from "react";
import { Activity, LineChart, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMoney, formatPercent } from "./format";
import type { MoonMarketPerformanceResponse, MoonMarketSeries } from "./types";

const PERIODS = ["1M", "3M", "6M", "1Y", "YTD"];

function lastValue(series?: MoonMarketSeries): number | null {
  if (!series?.values.length) return null;
  return series.values[series.values.length - 1];
}

function firstValue(series?: MoonMarketSeries): number | null {
  if (!series?.values.length) return null;
  return series.values[0];
}

function Sparkline({ series, tone = "cyan" }: { series?: MoonMarketSeries; tone?: "cyan" | "green" | "orange" }) {
  const values = series?.values ?? [];
  if (values.length < 2) {
    return <div className="h-10 rounded bg-[var(--bg-3)]" />;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 160;
      const y = 38 - ((value - min) / range) * 34;
      return `${x},${y}`;
    })
    .join(" ");
  const stroke =
    tone === "green"
      ? "var(--clr-green)"
      : tone === "orange"
        ? "var(--clr-orange)"
        : "var(--clr-cyan)";

  return (
    <svg viewBox="0 0 160 40" className="h-10 w-full overflow-visible">
      <polyline fill="none" stroke={stroke} strokeWidth="2" points={points} />
    </svg>
  );
}

function MetricCard({
  title,
  value,
  detail,
  icon: Icon,
  children,
  tone = "cyan",
}: {
  title: string;
  value: string;
  detail: string;
  icon: typeof Activity;
  children: ReactNode;
  tone?: "cyan" | "green" | "orange";
}) {
  return (
    <section className="rounded-md border border-border bg-[var(--bg-2)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-[var(--text-3)]">{title}</div>
          <div className="mt-2 font-data text-[24px] text-[var(--text-1)]">{value}</div>
          <div className="mt-1 text-[11px] text-[var(--text-3)]">{detail}</div>
        </div>
        <div
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded border",
            tone === "green" && "border-[var(--clr-green)]/40 text-[var(--clr-green)]",
            tone === "orange" && "border-[var(--clr-orange)]/40 text-[var(--clr-orange)]",
            tone === "cyan" && "border-[var(--clr-cyan)]/40 text-[var(--clr-cyan)]",
          )}
        >
          <Icon className="h-4 w-4" strokeWidth={1.7} />
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function PerformanceCards({
  data,
  period,
  onPeriodChange,
  loading,
}: {
  data?: MoonMarketPerformanceResponse;
  period: string;
  onPeriodChange: (period: string) => void;
  loading?: boolean;
}) {
  const navLatest = lastValue(data?.nav);
  const navStart = firstValue(data?.nav);
  const navDelta = navLatest != null && navStart != null ? navLatest - navStart : null;
  const cumulative = lastValue(data?.cumulative_return);
  const periodReturn = lastValue(data?.period_return);

  return (
    <aside className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[13px] font-semibold">Performance</h2>
          <p className="text-[11px] text-[var(--text-3)]">Account performance</p>
        </div>
        <select
          value={period}
          onChange={(event) => onPeriodChange(event.target.value)}
          className="h-8 rounded-md border border-border bg-[var(--bg-2)] px-2 text-[11px] text-[var(--text-2)] outline-none"
        >
          {PERIODS.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((item) => (
            <div key={item} className="h-40 animate-pulse rounded-md border border-border bg-[var(--bg-2)]" />
          ))}
        </div>
      ) : (
        <>
          <MetricCard
            title="Net Liquidation"
            value={formatMoney(navLatest)}
            detail={navDelta == null ? "No NAV change available" : `${formatMoney(navDelta)} over ${period}`}
            icon={LineChart}
          >
            <Sparkline series={data?.nav} />
          </MetricCard>

          <MetricCard
            title="Cumulative Return"
            value={formatPercent(cumulative)}
            detail={`Cumulative performance over ${period}`}
            icon={TrendingUp}
            tone="green"
          >
            <Sparkline series={data?.cumulative_return} tone="green" />
          </MetricCard>

          <MetricCard
            title="Period Return"
            value={formatPercent(periodReturn)}
            detail="Time weighted period performance"
            icon={Activity}
            tone="orange"
          >
            <Sparkline series={data?.period_return} tone="orange" />
          </MetricCard>
        </>
      )}
    </aside>
  );
}
