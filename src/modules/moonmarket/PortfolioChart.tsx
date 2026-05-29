import { useEffect, useRef, useState, type ReactNode } from "react";
import { hierarchy, pack, treemap } from "d3";
import { sankey, sankeyCenter, sankeyLinkHorizontal } from "d3-sankey";
import type { SankeyLink, SankeyNode } from "d3-sankey";
import { Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMoney, formatPercent } from "./format";
import {
  allocationMetricValue,
  displayAssetClass,
  displayHoldingName,
  displayHoldingSubtitle,
  groupAllocationItems,
  isCashAssetClass,
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

const DEFAULT_CHART_WIDTH = 1000;
const DEFAULT_CHART_HEIGHT = 440;

export type LeaderSortMode = "percent" | "gain" | "size";

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

type ChartSize = {
  width: number;
  height: number;
};

type ChartViewProps = {
  items: DisplayAllocationItem[];
  selectedConid?: number | null;
  displayMode: AllocationDisplayMode;
  leaderSortMode: LeaderSortMode;
  onSelect?: (item: DisplayAllocationItem) => void;
};

function colorAt(index: number): string {
  return COLORS[index % COLORS.length];
}

function visibleItems(allocation: MoonMarketAllocationItem[]): MoonMarketAllocationItem[] {
  return allocation.filter((item) => item.value > 0);
}

function useChartSize(defaultHeight = DEFAULT_CHART_HEIGHT) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<ChartSize>({ width: DEFAULT_CHART_WIDTH, height: defaultHeight });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const measure = () => {
      const rect = element.getBoundingClientRect();
      setSize({
        width: Math.max(320, Math.round(rect.width || DEFAULT_CHART_WIDTH)),
        height: Math.max(360, Math.round(rect.height || defaultHeight)),
      });
    };

    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [defaultHeight]);

  return [ref, size] as const;
}

function SvgFrame({
  testId,
  children,
}: {
  testId: string;
  children: (size: ChartSize) => ReactNode;
}) {
  const [ref, size] = useChartSize();
  return (
    <div ref={ref} className="h-[clamp(420px,55vh,640px)] min-h-[420px] w-full rounded border border-border bg-[var(--bg-2)]">
      <svg
        data-testid={testId}
        viewBox={`0 0 ${size.width} ${size.height}`}
        preserveAspectRatio="none"
        className="h-full w-full overflow-hidden rounded"
      >
        {children(size)}
      </svg>
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="flex h-full min-h-[360px] items-center justify-center rounded border border-dashed border-border text-[12px] text-[var(--text-3)]">
      No portfolio positions available.
    </div>
  );
}

function itemSelected(item: MoonMarketAllocationItem, selectedConid?: number | null): boolean {
  return selectedConid === item.conid;
}

function selectedClasses(selected: boolean): string {
  return selected ? "ring-1 ring-[var(--clr-cyan)] shadow-[0_0_18px_var(--glow-cyan)]" : "";
}

function metricValue(item: MoonMarketAllocationItem, displayMode: AllocationDisplayMode): number | null {
  return allocationMetricValue(item, displayMode);
}

function displayMetric(item: MoonMarketAllocationItem, displayMode: AllocationDisplayMode): string {
  const metric = metricValue(item, displayMode);
  return metric == null ? "--" : formatPercent(metric);
}

function metricTone(item: MoonMarketAllocationItem, displayMode: AllocationDisplayMode): "positive" | "negative" | "neutral" {
  if (isCashAssetClass(item.asset_class)) return "neutral";
  const metric = metricValue(item, displayMode);
  if (metric == null || metric === 0) return "neutral";
  return metric > 0 ? "positive" : "negative";
}

function metricIntensity(value: number | null, displayMode: AllocationDisplayMode): number {
  if (value == null) return 18;
  const magnitude = Math.abs(value);
  if (displayMode === "daily") {
    if (magnitude > 5) return 52;
    if (magnitude > 2) return 42;
    return 30;
  }
  if (magnitude > 40) return 54;
  if (magnitude > 15) return 44;
  return 32;
}

function returnFill(item: MoonMarketAllocationItem, displayMode: AllocationDisplayMode): string {
  const metric = metricValue(item, displayMode);
  const tone = metricTone(item, displayMode);
  if (tone === "positive") {
    return `color-mix(in srgb, var(--clr-green) ${metricIntensity(metric, displayMode)}%, var(--bg-2))`;
  }
  if (tone === "negative") {
    return `color-mix(in srgb, var(--clr-red) ${metricIntensity(metric, displayMode)}%, var(--bg-2))`;
  }
  return "var(--bg-3)";
}

function returnStroke(item: MoonMarketAllocationItem, displayMode: AllocationDisplayMode): string {
  const tone = metricTone(item, displayMode);
  if (tone === "positive") return "var(--clr-green)";
  if (tone === "negative") return "var(--clr-red)";
  return "var(--text-3)";
}

function returnTextClass(item: MoonMarketAllocationItem, displayMode: AllocationDisplayMode): string {
  const tone = metricTone(item, displayMode);
  if (tone === "positive") return "var(--clr-green)";
  if (tone === "negative") return "var(--clr-red)";
  return "var(--text-2)";
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(1, maxChars - 1))}...`;
}

function TreemapChart({ items, selectedConid, displayMode, onSelect }: ChartViewProps) {
  if (!items.length) return <EmptyChart />;
  return (
    <SvgFrame testId="moonmarket-chart-treemap">
      {({ width, height }) => {
        const root = treemap<HierarchyDatum>()
          .size([width, height])
          .paddingInner(5)
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
          <>
            {leaves.map((leaf) => {
              const item = leaf.data.item as DisplayAllocationItem;
              const selected = itemSelected(item, selectedConid);
              const tileWidth = Math.max(0, leaf.x1 - leaf.x0);
              const tileHeight = Math.max(0, leaf.y1 - leaf.y0);
              const roomy = tileWidth > 150 && tileHeight > 108;
              const compact = tileWidth > 78 && tileHeight > 56;
              const titleSize = roomy ? Math.min(22, Math.max(15, tileWidth / 16)) : 13;
              const metricSize = roomy ? Math.min(30, Math.max(20, tileWidth / 13)) : 12;
              const titleChars = Math.max(3, Math.floor((tileWidth - 26) / (titleSize * 0.58)));
              const subtitle = displayHoldingSubtitle(item);
              const clipId = `moonmarket-tile-${item.conid}`;

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
                  <clipPath id={clipId}>
                    <rect x={leaf.x0 + 8} y={leaf.y0 + 8} width={Math.max(1, tileWidth - 16)} height={Math.max(1, tileHeight - 16)} rx={5} />
                  </clipPath>
                  <rect
                    x={leaf.x0}
                    y={leaf.y0}
                    width={tileWidth}
                    height={tileHeight}
                    rx={5}
                    fill={returnFill(item, displayMode)}
                    fillOpacity={selected ? 0.92 : 0.72}
                    stroke={returnStroke(item, displayMode)}
                    strokeWidth={selected ? 3 : 1.6}
                  />
                  <g clipPath={`url(#${clipId})`} className="pointer-events-none">
                    {compact ? (
                      <>
                        <text
                          x={leaf.x0 + 14}
                          y={leaf.y0 + (roomy ? 30 : 25)}
                          fill="var(--text-1)"
                          fontSize={titleSize}
                          fontWeight={800}
                        >
                          {truncateText(displayHoldingName(item), titleChars)}
                        </text>
                        {roomy && subtitle ? (
                          <text x={leaf.x0 + 14} y={leaf.y0 + 56} fill="var(--text-3)" fontSize={11}>
                            {truncateText(subtitle, Math.max(8, Math.floor((tileWidth - 26) / 6)))}
                          </text>
                        ) : null}
                        <text
                          x={leaf.x0 + 14}
                          y={roomy ? leaf.y1 - 42 : leaf.y0 + 45}
                          fill="var(--text-1)"
                          fontSize={metricSize}
                          fontWeight={800}
                          className="font-data"
                        >
                          {displayMetric(item, displayMode)}
                        </text>
                        {roomy ? (
                          <text x={leaf.x0 + 14} y={leaf.y1 - 18} fill="var(--text-3)" fontSize={12} className="font-data">
                            {formatMoney(item.value)}
                          </text>
                        ) : null}
                      </>
                    ) : (
                      <text x={leaf.x0 + 8} y={leaf.y0 + tileHeight / 2} fill="var(--text-1)" fontSize={10} fontWeight={700}>
                        {truncateText(displayHoldingName(item), Math.max(2, Math.floor(tileWidth / 10)))}
                      </text>
                    )}
                  </g>
                </g>
              );
            })}
          </>
        );
      }}
    </SvgFrame>
  );
}

function DonutChart({ items, selectedConid, displayMode, onSelect }: ChartViewProps) {
  if (!items.length) return <EmptyChart />;
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <div data-testid="moonmarket-chart-donut" className="grid min-h-[420px] grid-cols-1 items-center gap-4 rounded border border-border bg-[var(--bg-2)] p-4 lg:grid-cols-[280px_minmax(0,1fr)]">
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
              "flex w-full items-center justify-between gap-3 rounded border border-border bg-[var(--bg-1)] px-3 py-2 text-left transition-colors hover:bg-[var(--bg-3)]",
              selectedClasses(itemSelected(item, selectedConid)),
            )}
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: colorAt(index) }} />
              <span className="truncate text-[12px] font-medium">{displayHoldingName(item)}</span>
            </div>
            <span className="font-data text-[12px]" style={{ color: returnTextClass(item, displayMode) }}>
              {displayMetric(item, displayMode)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function BubbleChart({ items, selectedConid, displayMode, onSelect }: ChartViewProps) {
  const [offsets, setOffsets] = useState<Record<number, { x: number; y: number }>>({});
  if (!items.length) return <EmptyChart />;
  return (
    <SvgFrame testId="moonmarket-chart-bubbles">
      {({ width, height }) => {
        const root = pack<HierarchyDatum>()
          .size([width, height])
          .padding(8)(
            hierarchy<HierarchyDatum>({
              children: items.map((item) => ({ item, value: item.value })),
            })
              .sum((datum) => datum.value ?? 0)
              .sort((a, b) => (b.value ?? 0) - (a.value ?? 0)),
          );
        const leaves = root.leaves().filter((leaf) => leaf.data.item);

        return (
          <>
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
                    fill={returnTextClass(item, displayMode)}
                    fontSize={Math.max(10, Math.min(13, leaf.r / 4))}
                    className="pointer-events-none font-data"
                  >
                    {displayMetric(item, displayMode)}
                  </text>
                </g>
              );
            })}
          </>
        );
      }}
    </SvgFrame>
  );
}

function leaderSortValue(item: MoonMarketAllocationItem, sortMode: LeaderSortMode): number {
  if (sortMode === "gain") return item.unrealized_pnl;
  if (sortMode === "size") return item.value;
  return item.pnl_percent ?? Number.NEGATIVE_INFINITY;
}

function leaderSortLabel(sortMode: LeaderSortMode): string {
  if (sortMode === "gain") return "$ Gain";
  if (sortMode === "size") return "Size";
  return "% Gain";
}

function leaderDisplay(item: MoonMarketAllocationItem, sortMode: LeaderSortMode): string {
  if (sortMode === "gain") return formatMoney(item.unrealized_pnl);
  if (sortMode === "size") return formatMoney(item.value);
  return displayMetric(item, "total");
}

function LeadersChart({ items, selectedConid, leaderSortMode, onSelect }: ChartViewProps) {
  if (!items.length) return <EmptyChart />;
  const sorted = [...items].sort((a, b) => leaderSortValue(b, leaderSortMode) - leaderSortValue(a, leaderSortMode));
  const top = sorted.slice(0, 3);
  const rest = sorted.slice(3);
  return (
    <div data-testid="moonmarket-chart-leaders" className="min-h-[420px] rounded border border-border bg-[var(--bg-2)] p-4">
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
                  <span className="mt-1 block font-data text-[16px]">{leaderDisplay(item, leaderSortMode)}</span>
                  <span className="mt-1 block font-data text-[11px] text-[var(--text-3)]">{formatMoney(item.value)}</span>
                </span>
                <span className="font-data text-[18px] text-[var(--text-3)]">#{index + 1}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-4 max-h-[260px] overflow-auto rounded border border-border">
        <table className="w-full table-fixed text-left text-[11px]">
          <thead className="sticky top-0 border-b border-border bg-[var(--bg-2)] text-[10px] uppercase text-[var(--text-3)]">
            <tr>
              <th className="w-[34%] px-3 py-2 font-medium">Symbol</th>
              <th className="w-[18%] px-3 py-2 font-medium">Type</th>
              <th className="w-[24%] px-3 py-2 text-right font-medium">Value</th>
              <th className="w-[24%] px-3 py-2 text-right font-medium">{leaderSortLabel(leaderSortMode)}</th>
            </tr>
          </thead>
          <tbody>
            {rest.map((item) => (
              <tr
                key={item.conid}
                role="button"
                tabIndex={0}
                aria-label={`Select ${displayHoldingName(item)}`}
                onClick={() => onSelect?.(item)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") onSelect?.(item);
                }}
                className={cn(
                  "cursor-pointer border-b border-border/70 hover:bg-[var(--bg-3)] last:border-0",
                  selectedClasses(itemSelected(item, selectedConid)),
                )}
              >
                <td className="truncate px-3 py-2 font-semibold">{displayHoldingName(item)}</td>
                <td className="px-3 py-2 text-[var(--text-3)]">{displayAssetClass(item)}</td>
                <td className="px-3 py-2 text-right font-data">{formatMoney(item.value)}</td>
                <td className="px-3 py-2 text-right font-data">{leaderDisplay(item, leaderSortMode)}</td>
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
  return (
    <SvgFrame testId="moonmarket-chart-flow">
      {({ width, height }) => {
        const labelColumnWidth = Math.min(220, Math.max(160, width * 0.22));
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
            [14, 18],
            [Math.max(340, width - labelColumnWidth), height - 18],
          ])({
          nodes: nodes.map((node) => ({ ...node })),
          links: links.map((link) => ({ ...link })),
        });
        const pathFor = sankeyLinkHorizontal<FlowNodeDatum, FlowLinkDatum>();

        return (
          <>
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
                  strokeOpacity={selectedConid == null || selected ? 0.42 : 0.14}
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
              const centerY = (y0 + y1) / 2;
              const labelX = x1 + 12;
              const name = item ? displayHoldingName(item) : "Portfolio";
              const value = item
                ? `${formatMoney(item.value)}   ${displayMetric(item, displayMode)}`
                : formatMoney(items.reduce((sum, current) => sum + current.value, 0));

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
                    fillOpacity={isPortfolio ? 0.34 : selected ? 0.5 : 0.28}
                    stroke={node.color}
                    strokeWidth={selected ? 3 : 1.5}
                  />
                  <text
                    x={labelX}
                    y={centerY - 5}
                    fill="var(--text-1)"
                    fontSize={isPortfolio ? 16 : 13}
                    fontWeight={800}
                    className="pointer-events-none"
                  >
                    {truncateText(name, isPortfolio ? 22 : 18)}
                  </text>
                  <text
                    x={labelX}
                    y={centerY + 13}
                    fill={item ? "var(--text-2)" : "var(--text-3)"}
                    fontSize={isPortfolio ? 12 : 11}
                    fontWeight={600}
                    className="pointer-events-none font-data"
                  >
                    {value}
                  </text>
                </g>
              );
            })}
          </>
        );
      }}
    </SvgFrame>
  );
}

export function PortfolioChart({
  type,
  allocation,
  selectedConid,
  displayMode,
  leaderSortMode,
  onSelect,
}: {
  type: GraphType;
  allocation: MoonMarketAllocationItem[];
  selectedConid?: number | null;
  displayMode: AllocationDisplayMode;
  leaderSortMode?: LeaderSortMode;
  onSelect?: (item: DisplayAllocationItem) => void;
}) {
  const items = groupAllocationItems(visibleItems(allocation), 12);
  const props = {
    items,
    selectedConid,
    displayMode,
    leaderSortMode: leaderSortMode ?? "percent",
    onSelect,
  };
  if (type === "donut") return <DonutChart {...props} />;
  if (type === "bubbles") return <BubbleChart {...props} />;
  if (type === "leaders") return <LeadersChart {...props} />;
  if (type === "flow") return <FlowChart {...props} />;
  return <TreemapChart {...props} />;
}
