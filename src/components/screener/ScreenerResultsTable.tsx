/**
 * ScreenerResultsTable — Sortable table of screener scan results
 *
 * Columns: Symbol, Name, Type, Price, Chg%, Volume, Market Cap
 * Click any row → navigateToAnalysis(conid)
 * All columns sortable.
 */

import { useMemo } from "react";
import { ArrowUpDown, ArrowUp, ArrowDown, TrendingUp } from "lucide-react";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import type { ScreenerResultRow } from "@/lib/api";
import { useScreenerStore, type SortDir } from "@/store/screener";
import { useNavigationStore } from "@/store";

// ── Helpers ───────────────────────────────────────────────────

function fmtPrice(v: number | null): string {
  if (v == null) return "—";
  return v < 10 ? v.toFixed(3) : v.toFixed(2);
}

function fmtChange(v: number | null): string {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function fmtVolume(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return v.toFixed(0);
}

function fmtMarketCap(v: number | null): string {
  // v is already in $M from IBKR field 7289
  if (v == null) return "—";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}T`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}B`;
  return `$${v.toFixed(0)}M`;
}

function changeColor(v: number | null): string {
  if (v == null) return "text-[var(--text-3)]";
  if (v > 0) return "text-[var(--clr-green)]";
  if (v < 0) return "text-[var(--clr-red)]";
  return "text-[var(--text-2)]";
}

// ── Column definitions ────────────────────────────────────────

interface ColDef {
  key: string;
  label: string;
  align: "left" | "right";
  minWidth?: string;
  render: (row: ScreenerResultRow) => React.ReactNode;
}

const COLUMNS: ColDef[] = [
  {
    key: "symbol",
    label: "Symbol",
    align: "left",
    minWidth: "80px",
    render: (r) => (
      <span className="font-semibold text-[var(--text-1)]">{r.symbol || "—"}</span>
    ),
  },
  {
    key: "company_name",
    label: "Name",
    align: "left",
    minWidth: "160px",
    render: (r) => (
      <span className="max-w-[200px] truncate text-[var(--text-3)]">
        {r.company_name || "—"}
      </span>
    ),
  },
  {
    key: "sec_type",
    label: "Type",
    align: "left",
    minWidth: "50px",
    render: (r) => (
      <span className="rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide bg-[var(--bg-3)] text-[var(--text-3)]">
        {r.sec_type || "—"}
      </span>
    ),
  },
  {
    key: "last_price",
    label: "Price",
    align: "right",
    render: (r) => <span className="text-[var(--text-2)]">{fmtPrice(r.last_price)}</span>,
  },
  {
    key: "change_percent",
    label: "Chg%",
    align: "right",
    render: (r) => (
      <span className={changeColor(r.change_percent)}>{fmtChange(r.change_percent)}</span>
    ),
  },
  {
    key: "volume",
    label: "Volume",
    align: "right",
    render: (r) => <span className="text-[var(--text-2)]">{fmtVolume(r.volume)}</span>,
  },
  {
    key: "market_cap",
    label: "Mkt Cap",
    align: "right",
    render: (r) => <span className="text-[var(--text-2)]">{fmtMarketCap(r.market_cap)}</span>,
  },
];

// ── Sort helpers ──────────────────────────────────────────────

function getSortValue(row: ScreenerResultRow, col: string): number | string {
  switch (col) {
    case "symbol":      return row.symbol;
    case "company_name": return row.company_name;
    case "sec_type":    return row.sec_type;
    case "last_price":  return row.last_price ?? -Infinity;
    case "change_percent": return row.change_percent ?? -Infinity;
    case "volume":      return row.volume ?? -Infinity;
    case "market_cap":  return row.market_cap ?? -Infinity;
    default:            return -Infinity;
  }
}

function SortIcon({
  col,
  sortBy,
  sortDir,
}: {
  col: string;
  sortBy: string;
  sortDir: SortDir;
}) {
  if (col !== sortBy) return <ArrowUpDown size={10} className="opacity-30" />;
  return sortDir === "asc" ? (
    <ArrowUp size={10} className="text-[var(--clr-cyan)]" />
  ) : (
    <ArrowDown size={10} className="text-[var(--clr-cyan)]" />
  );
}

// ── Empty state ───────────────────────────────────────────────

function EmptyState({ hasPreset }: { hasPreset: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <div className="rounded-full bg-[var(--bg-3)] p-4">
        <TrendingUp size={24} className="text-[var(--text-3)]" />
      </div>
      <div>
        <p className="text-sm text-[var(--text-2)]">
          {hasPreset ? "No results yet" : "Select a scanner preset to start"}
        </p>
        <p className="mt-1 text-[11px] text-[var(--text-3)]">
          {hasPreset
            ? "Click Scan to run the screener with your filters"
            : "Choose from presets like Most Active, Top Gainers, etc."}
        </p>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────

export default function ScreenerResultsTable() {
  const {
    results,
    totalScanned,
    totalMatched,
    sortBy,
    sortDir,
    setSort,
    selectedPreset,
  } = useScreenerStore();
  const navigateToAnalysis = useNavigationStore((s) => s.navigateToAnalysis);

  const sorted = useMemo(() => {
    if (!results.length) return [];
    const copy = [...results];
    copy.sort((a, b) => {
      const aVal = getSortValue(a, sortBy);
      const bVal = getSortValue(b, sortBy);
      const cmp =
        typeof aVal === "string"
          ? (aVal as string).localeCompare(bVal as string)
          : (aVal as number) - (bVal as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [results, sortBy, sortDir]);

  const handleSort = (col: string) => {
    setSort(col, sortBy === col && sortDir === "desc" ? "asc" : "desc");
  };

  if (!results.length) {
    return <EmptyState hasPreset={!!selectedPreset} />;
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Summary bar */}
      <div className="flex items-center gap-3 border-b border-border bg-[var(--bg-1)]/50 px-4 py-1.5">
        <span className="font-data text-[10px] text-[var(--text-3)]">
          <span className="text-[var(--clr-cyan)]">{totalMatched}</span>
          {" matched / "}
          {totalScanned} scanned
        </span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-b border-border hover:bg-transparent">
              {COLUMNS.map((col) => (
                <TableHead
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  style={{ minWidth: col.minWidth }}
                  className="cursor-pointer select-none px-3 py-2"
                >
                  <div
                    className={`flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-3)] ${
                      col.align === "right" ? "justify-end" : ""
                    }`}
                  >
                    {col.label}
                    <SortIcon col={col.key} sortBy={sortBy} sortDir={sortDir} />
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((row) => (
              <TableRow
                key={row.conid}
                onClick={() => navigateToAnalysis(row.conid)}
                className="cursor-pointer border-b border-border/50 transition-colors hover:bg-[var(--bg-3)]"
              >
                {COLUMNS.map((col) => (
                  <TableCell
                    key={col.key}
                    className={`px-3 py-2 font-data text-[11px] ${
                      col.align === "right" ? "text-right" : ""
                    }`}
                  >
                    {col.render(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
