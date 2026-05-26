import { formatMoney, formatPercent } from "./format";
import { cn } from "@/lib/utils";
import type { GraphType, MoonMarketAllocationItem } from "./types";

const COLORS = [
  "var(--clr-cyan)",
  "var(--clr-green)",
  "var(--clr-orange)",
  "var(--clr-purple)",
  "var(--clr-red)",
  "var(--text-2)",
];

function colorAt(index: number): string {
  return COLORS[index % COLORS.length];
}

function visibleItems(allocation: MoonMarketAllocationItem[]): MoonMarketAllocationItem[] {
  return allocation.filter((item) => item.value > 0).slice(0, 12);
}

function EmptyChart() {
  return (
    <div className="flex h-full min-h-[360px] items-center justify-center rounded border border-dashed border-border text-[12px] text-[var(--text-3)]">
      No portfolio positions available.
    </div>
  );
}

type ChartViewProps = {
  items: MoonMarketAllocationItem[];
  selectedConid?: number | null;
  onSelect?: (item: MoonMarketAllocationItem) => void;
};

function itemSelected(item: MoonMarketAllocationItem, selectedConid?: number | null): boolean {
  return selectedConid === item.conid;
}

function selectedClasses(selected: boolean): string {
  return selected ? "ring-1 ring-[var(--clr-cyan)] shadow-[0_0_18px_var(--glow-cyan)]" : "";
}

function TreemapChart({ items, selectedConid, onSelect }: ChartViewProps) {
  if (!items.length) return <EmptyChart />;
  return (
    <div
      data-testid="moonmarket-chart-treemap"
      className="grid min-h-[360px] grid-cols-6 gap-2"
    >
      {items.map((item, index) => (
        <button
          key={item.conid}
          type="button"
          aria-label={`Select ${item.label}`}
          onClick={() => onSelect?.(item)}
          className={cn(
            "flex min-h-24 flex-col justify-between rounded border border-border bg-[var(--bg-2)] p-3 text-left shadow-[inset_0_0_24px_rgba(255,255,255,0.02)] transition-all hover:-translate-y-0.5 hover:bg-[var(--bg-3)]",
            selectedClasses(itemSelected(item, selectedConid)),
          )}
          style={{
            gridColumn: `span ${Math.max(2, Math.min(6, Math.round(item.percent / 12) + 1))}`,
            borderColor: colorAt(index),
          }}
        >
          <div>
            <div className="text-[13px] font-semibold text-[var(--text-1)]">{item.symbol}</div>
            <div className="mt-1 truncate text-[10px] text-[var(--text-3)]">{item.label}</div>
          </div>
          <div>
            <div className="font-data text-[16px] text-[var(--text-1)]">{formatPercent(item.percent)}</div>
            <div className="font-data text-[11px] text-[var(--text-3)]">{formatMoney(item.value)}</div>
          </div>
        </button>
      ))}
    </div>
  );
}

function DonutChart({ items, selectedConid, onSelect }: ChartViewProps) {
  if (!items.length) return <EmptyChart />;
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <div data-testid="moonmarket-chart-donut" className="grid min-h-[360px] grid-cols-1 items-center gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <svg viewBox="0 0 120 120" className="mx-auto h-64 w-64 rotate-[-90deg]">
        <circle cx="60" cy="60" r={radius} fill="none" stroke="var(--bg-3)" strokeWidth="14" />
        {items.map((item, index) => {
          const dash = (item.percent / 100) * circumference;
          const segment = (
            <circle
              key={item.conid}
              cx="60"
              cy="60"
              r={radius}
              fill="none"
              stroke={colorAt(index)}
              strokeWidth="14"
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
              strokeLinecap="round"
            />
          );
          offset += dash;
          return segment;
        })}
      </svg>
      <div className="space-y-2">
        {items.map((item, index) => (
          <button
            key={item.conid}
            type="button"
            aria-label={`Select ${item.label}`}
            onClick={() => onSelect?.(item)}
            className={cn(
              "flex w-full items-center justify-between gap-3 rounded border border-border bg-[var(--bg-2)] px-3 py-2 text-left transition-colors hover:bg-[var(--bg-3)]",
              selectedClasses(itemSelected(item, selectedConid)),
            )}
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: colorAt(index) }} />
              <span className="truncate text-[12px] font-medium">{item.symbol}</span>
            </div>
            <span className="font-data text-[12px] text-[var(--text-2)]">{formatPercent(item.percent)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function BubbleChart({ items, selectedConid, onSelect }: ChartViewProps) {
  if (!items.length) return <EmptyChart />;
  return (
    <div data-testid="moonmarket-chart-bubbles" className="relative min-h-[360px] overflow-hidden rounded border border-border bg-[var(--bg-2)]">
      {items.map((item, index) => {
        const size = Math.max(72, Math.min(180, 58 + item.percent * 2.1));
        const x = (index * 19) % 78;
        const y = (index * 31) % 72;
        return (
          <button
            key={item.conid}
            type="button"
            aria-label={`Select ${item.label}`}
            onClick={() => onSelect?.(item)}
            className={cn(
              "absolute flex flex-col items-center justify-center rounded-full border text-center shadow-[0_0_28px_rgba(0,0,0,0.18)] transition-transform hover:scale-105",
              selectedClasses(itemSelected(item, selectedConid)),
            )}
            style={{
              width: size,
              height: size,
              left: `${x}%`,
              top: `${y}%`,
              transform: "translate(-20%, -10%)",
              borderColor: colorAt(index),
              background: `color-mix(in srgb, ${colorAt(index)} 18%, transparent)`,
            }}
          >
            <span className="text-[12px] font-semibold">{item.symbol}</span>
            <span className="font-data text-[11px] text-[var(--text-3)]">{formatPercent(item.percent)}</span>
          </button>
        );
      })}
    </div>
  );
}

function LeadersChart({ items, selectedConid, onSelect }: ChartViewProps) {
  if (!items.length) return <EmptyChart />;
  return (
    <div data-testid="moonmarket-chart-leaders" className="min-h-[360px] space-y-3 rounded border border-border bg-[var(--bg-2)] p-4">
      {items.map((item, index) => (
        <button
          key={item.conid}
          type="button"
          aria-label={`Select ${item.label}`}
          onClick={() => onSelect?.(item)}
          className={cn(
            "grid w-full grid-cols-[72px_minmax(0,1fr)_80px] items-center gap-3 rounded px-2 py-1 text-left transition-colors hover:bg-[var(--bg-3)]",
            selectedClasses(itemSelected(item, selectedConid)),
          )}
        >
          <span className="truncate text-[12px] font-semibold">{item.symbol}</span>
          <div className="h-3 overflow-hidden rounded-full bg-[var(--bg-3)]">
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.min(100, item.percent)}%`, background: colorAt(index) }}
            />
          </div>
          <span className="text-right font-data text-[12px] text-[var(--text-2)]">{formatPercent(item.percent)}</span>
        </button>
      ))}
    </div>
  );
}

function FlowChart({ items, selectedConid, onSelect }: ChartViewProps) {
  if (!items.length) return <EmptyChart />;
  return (
    <div data-testid="moonmarket-chart-flow" className="min-h-[360px] rounded border border-border bg-[var(--bg-2)] p-4">
      <div className="grid h-full min-h-[320px] grid-cols-[160px_minmax(0,1fr)] items-center gap-5">
        <div className="rounded border border-[var(--clr-cyan)]/60 bg-[var(--clr-cyan)]/10 p-4 text-center">
          <div className="text-[11px] uppercase text-[var(--text-3)]">Account</div>
          <div className="mt-1 text-[18px] font-semibold">Portfolio</div>
        </div>
        <div className="space-y-3">
          {items.map((item, index) => (
            <button
              key={item.conid}
              type="button"
              aria-label={`Select ${item.label}`}
              onClick={() => onSelect?.(item)}
              className={cn(
                "grid w-full grid-cols-[minmax(44px,1fr)_92px] items-center gap-3 rounded p-1 transition-colors hover:bg-[var(--bg-3)]",
                selectedClasses(itemSelected(item, selectedConid)),
              )}
            >
              <div className="h-2 rounded-full bg-[var(--bg-3)]">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.max(10, item.percent)}%`, background: colorAt(index) }}
                />
              </div>
              <div className="rounded border border-border px-2 py-1 text-right">
                <div className="text-[11px] font-semibold">{item.symbol}</div>
                <div className="font-data text-[10px] text-[var(--text-3)]">{formatPercent(item.percent)}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function PortfolioChart({
  type,
  allocation,
  selectedConid,
  onSelect,
}: {
  type: GraphType;
  allocation: MoonMarketAllocationItem[];
  selectedConid?: number | null;
  onSelect?: (item: MoonMarketAllocationItem) => void;
}) {
  const items = visibleItems(allocation);
  const props = { items, selectedConid, onSelect };
  if (type === "donut") return <DonutChart {...props} />;
  if (type === "bubbles") return <BubbleChart {...props} />;
  if (type === "leaders") return <LeadersChart {...props} />;
  if (type === "flow") return <FlowChart {...props} />;
  return <TreemapChart {...props} />;
}
