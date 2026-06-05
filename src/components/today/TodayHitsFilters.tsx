/**
 * TodayHitsFilters — pill-style filters above the hit card grid.
 * Stateless: parent owns the active value.
 */

export type HitFilter =
  | { kind: "all" }
  | { kind: "watchlist"; name: string }
  | { kind: "high-conf" };

interface Props {
  value: HitFilter;
  onChange: (next: HitFilter) => void;
  watchlistNames: string[];
}

interface PillProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function Pill({ active, onClick, children }: PillProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2 py-0.5 text-[9px] ${
        active
          ? "border-[var(--clr-cyan)] bg-[var(--bg-3)] text-[var(--clr-cyan)]"
          : "border-border bg-[var(--bg-1)] text-[var(--text-3)]"
      }`}
    >
      {children}
    </button>
  );
}

export function TodayHitsFilters({ value, onChange, watchlistNames }: Props) {
  return (
    <div className="flex flex-wrap gap-1">
      <Pill active={value.kind === "all"} onClick={() => onChange({ kind: "all" })}>
        All
      </Pill>
      <Pill
        active={value.kind === "high-conf"}
        onClick={() => onChange({ kind: "high-conf" })}
      >
        High conf
      </Pill>
      {watchlistNames.map((n) => (
        <Pill
          key={n}
          active={value.kind === "watchlist" && value.name === n}
          onClick={() => onChange({ kind: "watchlist", name: n })}
        >
          {n}
        </Pill>
      ))}
    </div>
  );
}
