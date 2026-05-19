import { useEffect, useState, useRef, type RefObject } from "react";
import type { IChartApi, Time } from "lightweight-charts";
import type { CompareMarker } from "@/store/compare";

const MARKER_COLOR = "rgba(0, 212, 255, 0.7)";

interface Props {
  chartRef: RefObject<IChartApi | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  markers: CompareMarker[];
}

export default function MarkerOverlay({ chartRef, containerRef, markers }: Props) {
  const [positions, setPositions] = useState<{ id: string; x: number }[]>([]);
  const [height, setHeight] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const updatePositions = () => {
      const ts = chart.timeScale();
      // subscribeClick returns param.time as the *start* of the bar under
      // the cursor. Offset by half the bar width so the marker line visually
      // centers on the clicked bar instead of pinning to its left edge.
      const barSpacingPx = chart.timeScale().options().barSpacing ?? 8;
      const next: { id: string; x: number }[] = [];
      for (const m of markers) {
        const x = ts.timeToCoordinate(m.time as Time);
        if (x != null && x >= 0) next.push({ id: m.id, x: x + barSpacingPx / 2 });
      }
      setPositions(next);
      const container = containerRef.current;
      if (container) setHeight(container.clientHeight);
    };

    const scheduleUpdate = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(updatePositions);
    };

    updatePositions();
    chart.timeScale().subscribeVisibleTimeRangeChange(scheduleUpdate);

    const container = containerRef.current;
    let ro: ResizeObserver | null = null;
    if (container) {
      ro = new ResizeObserver(scheduleUpdate);
      ro.observe(container);
    }

    return () => {
      try { chart.timeScale().unsubscribeVisibleTimeRangeChange(scheduleUpdate); } catch { /* no-op */ }
      ro?.disconnect();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [chartRef, containerRef, markers]);

  if (positions.length === 0) return null;

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-[5] h-full w-full"
      preserveAspectRatio="none"
    >
      {positions.map((p) => (
        <line
          key={p.id}
          x1={p.x}
          x2={p.x}
          y1={0}
          y2={height}
          stroke={MARKER_COLOR}
          strokeWidth={1}
          strokeDasharray="4 3"
        />
      ))}
    </svg>
  );
}
