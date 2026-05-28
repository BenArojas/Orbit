import { useRef, useState } from "react";
import { hierarchy, pack, treemap } from "d3";
import { sankey, sankeyCenter, sankeyLinkHorizontal } from "d3-sankey";
import type { SankeyLink, SankeyNode } from "d3-sankey";
import { Trophy } from "lucide-react";
import { formatMoney, formatPercent } from "./format";
import { cn } from "@/lib/utils";
import {
  allocationMetricValue,
  displayAssetClass,
  displayHoldingName,
  displayHoldingSubtitle,
  groupAllocationItems,
  type AllocationDisplayMode,
  type DisplayAllocationItem,
} from "./portfolioData";
import type { GraphType, MoonMarketAllocationItem } from "./types";

const COLORS = [
  "var(--clr-cyan)",
  "var(--clr-green)",
  "var(--clr-orange)",
  "var(--clr-purple)",
  "var(--clr-red)",
  "var(--text-2)",
];

type HierarchyDatum = {
  item?: DisplayAllocationItem;
  value?: number;
  children?: HierarchyDatum[];
};

type FlowNodeDatum = {
  id: string;
  item?: DisplayAllocationItem;
  color: string;
};

type FlowLinkDatum = {
  source: string;
  target: string;
  value: number;
};

type FlowNode = SankeyNode<FlowNodeDatum, FlowLinkDatum>;
type FlowLink = SankeyLink<FlowNodeDatum, FlowLinkDatum>;

function colorAt(index: number): string {
  return COLORS[index % COLORS.length];
}

function visibleItems(allocation: MoonMarketAllocationItem[]): MoonMarketAllocationItem[] {
  return allocation.filter((item) => item.value > 0);
}

function EmptyChart() {
  return (
    <div className="flex h-full min-h-[360px] items-center justify-center rounded border border-dashed border-border text-[12px] text-[var(--text-3)]">
      No portfolio positions available.
    </div>
  );
}

type ChartViewProps = {
  items: DisplayAllocationItem[];
  selectedConid?: number | null;
  displayMode: AllocationDisplayMode;
  onSelect?: (item: DisplayAllocationItem) => void;
};

function itemSelected(item: MoonMarketAllocationItem, selectedConid?: number | null): boolean {
  return selectedConid === item.conid;
}

function selectedClasses(selected: boolean): string {
  return selected ? "ring-1 ring-[var(--clr-cyan)] shadow-[0_0_18px_var(--glow-cyan)]" : "";
}

function displayPercent(item: MoonMarketAllocationItem, displayMode: AllocationDisplayMode): string {
  const metric = allocationMetricValue(item, displayMode);
  return metric == null ? formatPercent(item.percent) : formatPercent(metric);
}

function leaderSortValue(item: MoonMarketAllocationItem, displayMode: AllocationDisplayMode): number {
  return allocationMetricValue(item, displayMode) ?? Number.NEGATIVE_INFINITY;
}

function TreemapChart({ items, selectedConid, displayMode, onSelect }: ChartViewProps) {
  if (!items.length) return <EmptyChart />;
  const root = treemap<HierarchyDatum>()
    .size([1000, 360])
    .paddingInner(6)
    .paddingOuter(1)
    .round(true)(
      hierarchy<HierarchyDatum>({
        children: items.map((item) => ({ item, value: item.value })),
      })
        .sum((datum) => datum.value ?? 0)
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0)),
    );
  const leaves = root.leaves().filter((leaf) => leaf.data.item);
  return (
    <svg
      data-testid="moonmarket-chart-treemap"
      viewBox="0 0 1000 360"
      preserveAspectRatio="xMidYMid meet"
      className="min-h-[360px] w-full rounded border border-border bg-[var(--bg-2)]"
    >
      {leaves.map((leaf, index) => {
        const item = leaf.data.item as DisplayAllocationItem;
        const selected = itemSelected(item, selectedConid);
        const width = Math.max(0, leaf.x1 - leaf.x0);
        const height = Math.max(0, leaf.y1 - leaf.y0);
        const roomy = width > 120 && height > 76;
        const labelY = roomy ? 26 : height / 2 - 4;
        return (
          <g
            key={item.conid}
            role="button"
            aria-label={`Select ${displayHoldingName(item)}`}
            tabIndex={0}
            onClick={() => onSelect?.(item)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") onSelect?.(item);
            }}
            className="cursor-pointer outline-none"
          >
            <rect
              x={leaf.x0}
              y={leaf.y0}
              width={width}
              height={height}
              rx={5}
              fill={colorAt(index)}
              fillOpacity={selected ? 0.36 : 0.18}
              stroke={colorAt(index)}
              strokeWidth={selected ? 3 : 1.4}
            />
            <text
              x={leaf.x0 + 14}
              y={leaf.y0 + labelY}
              fill="var(--text-1)"
              fontSize={roomy ? 18 : 13}
              fontWeight={700}
              className="pointer-events-none"
            >
              {displayHoldingName(item)}
            </text>
            {roomy ? (
              <>
                <text
                  x={leaf.x0 + 14}
                  y={leaf.y0 + 52}
                  fill="var(--text-3)"
                  fontSize={11}
                  className="pointer-events-none"
                >
                  {displayHoldingSubtitle(item).slice(0, 34)}
                </text>
                <text
                  x={leaf.x0 + 14}
                  y={leaf.y1 - 38}
                  fill="var(--text-1)"
                  fontSize={24}
                  fontWeight={700}
                  className="pointer-events-none font-data"
                >
                  {displayPercent(item, displayMode)}
                </text>
                <text
                  x={leaf.x0 + 14}
                  y={leaf.y1 - 16}
                  fill="var(--text-3)"
                  fontSize={12}
                  className="pointer-events-none font-data"
                >
                  {formatMoney(item.value)}
                </text>
              </>
            ) : (
              <text
                x={leaf.x0 + 14}
                y={leaf.y0 + labelY + 18}
                fill="var(--text-3)"
                fontSize={10}
                className="pointer-events-none font-data"
              >
                {displayPercent(item, displayMode)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function DonutChart({ items, selectedConid, displayMode, onSelect }: ChartViewProps) {
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
          const selected = itemSelected(item, selectedConid);
          const segment = (
            <circle
              key={item.conid}
              cx="60"
              cy="60"
              r={radius}
              fill="none"
              stroke={colorAt(index)}
              strokeWidth={selected ? "18" : "14"}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
              strokeLinecap="round"
              opacity={selectedConid == null || selected ? 1 : 0.35}
              onClick={() => onSelect?.(item)}
              className="cursor-pointer transition-opacity"
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
            aria-label={`Select ${displayHoldingName(item)}`}
            onClick={() => onSelect?.(item)}
            className={cn(
              "flex w-full items-center justify-between gap-3 rounded border border-border bg-[var(--bg-2)] px-3 py-2 text-left transition-colors hover:bg-[var(--bg-3)]",
              selectedClasses(itemSelected(item, selectedConid)),
            )}
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: colorAt(index) }} />
              <span className="truncate text-[12px] font-medium">{displayHoldingName(item)}</span>
            </div>
            <span className="font-data text-[12px] text-[var(--text-2)]">{displayPercent(item, displayMode)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function BubbleChart({ items, selectedConid, displayMode, onSelect }: ChartViewProps) {
  const containerRef = useRef<SVGSVGElement | null>(null);
  const [offsets, setOffsets] = useState<Record<number, { x: number; y: number }>>({});
  if (!items.length) return <EmptyChart />;
  const root = pack<HierarchyDatum>()
    .size([1000, 360])
    .padding(6)(
      hierarchy<HierarchyDatum>({
        children: items.map((item) => ({ item, value: item.value })),
      })
        .sum((datum) => datum.value ?? 0)
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0)),
    );
  const leaves = root.leaves().filter((leaf) => leaf.data.item);
  return (
    <svg
      ref={containerRef}
      data-testid="moonmarket-chart-bubbles"
      viewBox="0 0 1000 360"
      preserveAspectRatio="xMidYMid meet"
      className="min-h-[360px] w-full touch-none rounded border border-border bg-[var(--bg-2)]"
    >
      {leaves.map((leaf, index) => {
        const item = leaf.data.item as DisplayAllocationItem;
        const offset = offsets[item.conid] ?? { x: 0, y: 0 };
        const selected = itemSelected(item, selectedConid);
        return (
          <g
            key={item.conid}
            role="button"
            aria-label={`Select ${displayHoldingName(item)}`}
            tabIndex={0}
            onClick={() => onSelect?.(item)}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
              setOffsets((current) => {
                const previous = current[item.conid] ?? { x: 0, y: 0 };
                return {
                  ...current,
                  [item.conid]: {
                    x: previous.x + event.movementX,
                    y: previous.y + event.movementY,
                  },
                };
              });
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") onSelect?.(item);
            }}
            transform={`translate(${offset.x} ${offset.y})`}
            className="cursor-grab outline-none active:cursor-grabbing"
          >
            <circle
              cx={leaf.x}
              cy={leaf.y}
              r={leaf.r}
              fill={colorAt(index)}
              fillOpacity={selected ? 0.4 : 0.2}
              stroke={colorAt(index)}
              strokeWidth={selected ? 3 : 1.5}
            />
            <text
              x={leaf.x}
              y={leaf.y - 4}
              textAnchor="middle"
              fill="var(--text-1)"
              fontSize={Math.max(11, Math.min(18, leaf.r / 3))}
              fontWeight={700}
              className="pointer-events-none"
            >
              {displayHoldingName(item)}
            </text>
            <text
              x={leaf.x}
              y={leaf.y + 15}
              textAnchor="middle"
              fill="var(--text-3)"
              fontSize={Math.max(10, Math.min(13, leaf.r / 4))}
              className="pointer-events-none font-data"
            >
              {displayPercent(item, displayMode)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function LeadersChart({ items, selectedConid, displayMode, onSelect }: ChartViewProps) {
  if (!items.length) return <EmptyChart />;
  const hasMetric = items.some((item) => allocationMetricValue(item, displayMode) != null);
  const sorted = [...items].sort((a, b) =>
    hasMetric ? leaderSortValue(b, displayMode) - leaderSortValue(a, displayMode) : b.value - a.value,
  );
  const top = sorted.slice(0, 3);
  const rest = sorted.slice(3);
  return (
    <div data-testid="moonmarket-chart-leaders" className="min-h-[360px] rounded border border-border bg-[var(--bg-2)] p-4">
      <div className="relative min-h-56 rounded border border-border bg-[radial-gradient(circle,rgba(255,255,255,0.055)_1px,transparent_1px)] [background-size:18px_18px] p-4">
        <div className="grid h-full min-h-48 grid-cols-3 items-end gap-3">
        {top.map((item, index) => {
          const orderClass =
            index === 0
              ? "order-2 min-h-44 translate-y-[-10px]"
              : index === 1
                ? "order-1 min-h-36"
                : "order-3 min-h-32";
          const tone =
            index === 0
              ? "border-[rgba(255,212,59,0.65)] bg-[linear-gradient(to_top,rgba(255,212,59,0.18),rgba(255,212,59,0.04))]"
              : index === 1
                ? "border-[rgba(116,192,252,0.55)] bg-[linear-gradient(to_top,rgba(116,192,252,0.15),rgba(116,192,252,0.03))]"
                : "border-[rgba(156,163,175,0.55)] bg-[linear-gradient(to_top,rgba(156,163,175,0.14),rgba(156,163,175,0.03))]";
          return (
            <button
              key={item.conid}
              type="button"
              aria-label={`Select ${displayHoldingName(item)}`}
              onClick={() => onSelect?.(item)}
              className={cn(
                "flex flex-col items-center justify-between rounded border p-3 text-center transition-transform hover:-translate-y-1",
                orderClass,
                tone,
                selectedClasses(itemSelected(item, selectedConid)),
              )}
            >
              <Trophy
                className={cn(
                  "h-6 w-6",
                  index === 0 && "text-[#ffd43b]",
                  index === 1 && "text-[#74c0fc]",
                  index === 2 && "text-[var(--text-3)]",
                )}
                strokeWidth={1.7}
              />
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold">{displayHoldingName(item)}</span>
                <span className="mt-1 block font-data text-[16px]">{displayPercent(item, displayMode)}</span>
                <span className="mt-1 block font-data text-[11px] text-[var(--text-3)]">{formatMoney(item.value)}</span>
              </span>
              <span className="font-data text-[18px] text-[var(--text-3)]">#{index + 1}</span>
            </button>
          );
        })}
        </div>
      </div>
      <div className="mt-4 max-h-[220px] overflow-auto rounded border border-border">
        <table className="w-full text-left text-[11px]">
          <thead className="sticky top-0 border-b border-border bg-[var(--bg-2)] text-[10px] uppercase text-[var(--text-3)]">
            <tr>
              <th className="px-3 py-2 font-medium">Symbol</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 text-right font-medium">Value</th>
              <th className="px-3 py-2 text-right font-medium">{displayMode === "daily" ? "Today" : "Since Buy"}</th>
            </tr>
          </thead>
          <tbody>
            {rest.map((item) => (
              <tr key={item.conid} className="border-b border-border/70 last:border-0">
                <td className="p-0" colSpan={4}>
                  <button
                    type="button"
                    aria-label={`Select ${displayHoldingName(item)}`}
                    onClick={() => onSelect?.(item)}
                    className={cn(
                      "grid w-full grid-cols-[minmax(0,1.1fr)_80px_96px_96px] items-center px-3 py-2 text-left hover:bg-[var(--bg-3)]",
                      selectedClasses(itemSelected(item, selectedConid)),
                    )}
                  >
                    <span className="truncate font-semibold">{displayHoldingName(item)}</span>
                    <span className="text-[var(--text-3)]">{displayAssetClass(item)}</span>
                    <span className="text-right font-data">{formatMoney(item.value)}</span>
                    <span className="text-right font-data">{displayPercent(item, displayMode)}</span>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FlowChart({ items, selectedConid, displayMode, onSelect }: ChartViewProps) {
  if (!items.length) return <EmptyChart />;
  const nodes: FlowNodeDatum[] = [
    { id: "Portfolio", color: "var(--clr-cyan)" },
    ...items.map((item, index) => ({
      id: String(item.conid),
      item,
      color: colorAt(index),
    })),
  ];
  const links: FlowLinkDatum[] = items.map((item) => ({
    source: "Portfolio",
    target: String(item.conid),
    value: Math.max(0.01, item.value),
  }));
  const flow = sankey<FlowNodeDatum, FlowLinkDatum>()
    .nodeId((node) => node.id)
    .nodeAlign(sankeyCenter)
    .nodeWidth(18)
    .nodePadding(14)
    .extent([
      [12, 12],
      [988, 348],
    ])({
    nodes: nodes.map((node) => ({ ...node })),
    links: links.map((link) => ({ ...link })),
  });
  const pathFor = sankeyLinkHorizontal<FlowNodeDatum, FlowLinkDatum>();
  return (
    <svg
      data-testid="moonmarket-chart-flow"
      viewBox="0 0 1000 360"
      preserveAspectRatio="xMidYMid meet"
      className="min-h-[360px] w-full rounded border border-border bg-[var(--bg-2)]"
    >
      {flow.links.map((link) => {
        const target = link.target as FlowNode;
        const item = target.item;
        const selected = item ? itemSelected(item, selectedConid) : false;
        return (
          <path
            key={`${String((link.source as FlowNode).id)}-${String(target.id)}`}
            d={pathFor(link as FlowLink) ?? undefined}
            fill="none"
            stroke={target.color}
            strokeOpacity={selectedConid == null || selected ? 0.34 : 0.12}
            strokeWidth={Math.max(1, link.width ?? 1)}
          />
        );
      })}
      {flow.nodes.map((node) => {
        const item = node.item;
        const selected = item ? itemSelected(item, selectedConid) : false;
        const isPortfolio = node.id === "Portfolio";
        const x0 = node.x0 ?? 0;
        const x1 = node.x1 ?? 0;
        const y0 = node.y0 ?? 0;
        const y1 = node.y1 ?? 0;
        const labelX = isPortfolio ? x1 + 10 : x0 - 10;
        const labelAnchor = isPortfolio ? "start" : "end";
        return (
          <g
            key={node.id}
            role={item ? "button" : undefined}
            aria-label={item ? `Select ${displayHoldingName(item)}` : undefined}
            tabIndex={item ? 0 : undefined}
            onClick={() => {
              if (item) onSelect?.(item);
            }}
            onKeyDown={(event) => {
              if (item && (event.key === "Enter" || event.key === " ")) onSelect?.(item);
            }}
            className={item ? "cursor-pointer outline-none" : undefined}
          >
            <rect
              x={x0}
              y={y0}
              width={Math.max(1, x1 - x0)}
              height={Math.max(1, y1 - y0)}
              rx={3}
              fill={node.color}
              fillOpacity={isPortfolio ? 0.28 : selected ? 0.42 : 0.24}
              stroke={node.color}
              strokeWidth={selected ? 3 : 1.5}
            />
            <text
              x={labelX}
              y={(y0 + y1) / 2 - 4}
              textAnchor={labelAnchor}
              fill="var(--text-1)"
              fontSize={item ? 12 : 14}
              fontWeight={700}
              className="pointer-events-none"
            >
              {item ? displayHoldingName(item) : "Portfolio"}
            </text>
            <text
              x={labelX}
              y={(y0 + y1) / 2 + 13}
              textAnchor={labelAnchor}
              fill="var(--text-3)"
              fontSize={10}
              className="pointer-events-none font-data"
            >
              {item ? `${formatMoney(item.value)} · ${displayPercent(item, displayMode)}` : formatMoney(items.reduce((sum, current) => sum + current.value, 0))}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function PortfolioChart({
  type,
  allocation,
  selectedConid,
  displayMode,
  onSelect,
}: {
  type: GraphType;
  allocation: MoonMarketAllocationItem[];
  selectedConid?: number | null;
  displayMode: AllocationDisplayMode;
  onSelect?: (item: DisplayAllocationItem) => void;
}) {
  const items = groupAllocationItems(visibleItems(allocation), 12);
  const props = { items, selectedConid, displayMode, onSelect };
  if (type === "donut") return <DonutChart {...props} />;
  if (type === "bubbles") return <BubbleChart {...props} />;
  if (type === "leaders") return <LeadersChart {...props} />;
  if (type === "flow") return <FlowChart {...props} />;
  return <TreemapChart {...props} />;
}
