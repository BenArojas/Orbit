/**
 * TodayContextStrip — 7-cell market snapshot bar at the top of the Today page.
 * Cells: SPX | VIX | Breadth | Strength | Rotation | Top sector | Worst sector
 *
 * Each cell renders "—" if its slice of the snapshot is missing rather than
 * pulling the whole strip down. Pure presentation — data comes from
 * `useMarketSnapshot`.
 */

import { useMarketSnapshot } from "@/hooks/useMarketSnapshot";

const formatNum = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: 2 });

const fmtPct = (p: number) => `${p >= 0 ? "+" : ""}${p.toFixed(2)}%`;

interface CellProps {
  label: string;
  value: string;
  delta?: { text: string; up?: boolean };
}

function Cell({ label, value, delta }: CellProps) {
  const deltaColor =
    delta?.up === undefined
      ? "text-[var(--text-3)]"
      : delta.up
        ? "text-[var(--clr-green)]"
        : "text-[var(--clr-red)]";

  return (
    <div className="bg-[var(--bg-1)] px-3 py-2 text-center">
      <div className="text-[8px] uppercase tracking-wider text-[var(--text-3)]">
        {label}
      </div>
      <div className="mt-0.5 font-data text-[12px] font-bold text-[var(--text-1)]">
        {value}
      </div>
      {delta && (
        <div className={`mt-0.5 font-data text-[8.5px] ${deltaColor}`}>
          {delta.text}
        </div>
      )}
    </div>
  );
}

export function TodayContextStrip() {
  const { data } = useMarketSnapshot();

  if (!data) {
    return <div className="h-[54px] bg-[var(--bg-1)]" />;
  }

  return (
    <div className="grid grid-cols-7 gap-px bg-[var(--bg-3)]">
      <Cell
        label="SPX"
        value={data.spx ? formatNum(data.spx.last) : "—"}
        delta={
          data.spx
            ? { text: fmtPct(data.spx.changePct), up: data.spx.changePct >= 0 }
            : undefined
        }
      />
      <Cell
        label="VIX"
        value={data.vix ? formatNum(data.vix.last) : "—"}
        delta={
          data.vix
            ? { text: fmtPct(data.vix.changePct), up: data.vix.changePct < 0 }
            : undefined
        }
      />
      <Cell
        label="Breadth"
        value={
          data.breadth
            ? `${data.breadth.value > 0 ? "+" : ""}${data.breadth.value}`
            : "—"
        }
        delta={data.breadth ? { text: data.breadth.label } : undefined}
      />
      <Cell
        label="Strength"
        value={data.strength ? String(data.strength.value) : "—"}
        delta={data.strength ? { text: data.strength.label } : undefined}
      />
      <Cell
        label="Rotation"
        value={data.rotation?.leader ?? "—"}
        delta={data.rotation ? { text: "leading" } : undefined}
      />
      <Cell
        label="Top Sec"
        value={data.topSector?.ticker ?? "—"}
        delta={
          data.topSector
            ? {
                text: fmtPct(data.topSector.changePct),
                up: data.topSector.changePct >= 0,
              }
            : undefined
        }
      />
      <Cell
        label="Worst Sec"
        value={data.worstSector?.ticker ?? "—"}
        delta={
          data.worstSector
            ? {
                text: fmtPct(data.worstSector.changePct),
                up: data.worstSector.changePct >= 0,
              }
            : undefined
        }
      />
    </div>
  );
}
