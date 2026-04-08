/**
 * ScreenerResultsTable — Sortable table of screener scan results
 *
 * Columns: Symbol, Last Price, Change%, Volume, RSI, MACD, EMA 50, EMA 200, ADX
 * Click any row → navigateToAnalysis(conid)
 * Sortable columns with glow-highlighted headers
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

// ── Column definitions ────────────────────────────────────

interface ColumnDef {
  key: string;
  label: string;
  align: "left" | "right";
  width?: string;
  format: (row: ScreenerResultRow) => string;
  colorize?: (row: ScreenerResultRow) => "up" | "down" | "neutral";
}

const COLUMNS: ColumnDef[] = [
  {
    key: "symbol",
    label: "Symbol",
    align: "left",
    width: "w-[100px]",
    format: (r) => r.symbol || "—",
  },
  {
    key: "company_name",
    label: "Name",
    align: "left",
    width: "w-[160px]",
    format: (r) => r.company_name || "—",
  },
  {
    key: "last_price",
    label: "Price",
    align: "right",
    format: (r) => r.last_price != null ? r.last_price.toFixed(2) : "—",
  },
  {
    key: "change_percent",
    label: "Chg%",
    align: "right",
    format: (r) =>
      r.change_percent != null
        ? `${r.change_percent >= 0 ? "+" : ""}${r.change_percent.toFixed(2)}%`
        : "—",
    colorize: (r) =>
      r.change_percent == null
        ? "neutral"
        : r.change_percent > 0
          ? "up"
          : r.change_percent < 0
            ? "down"
            : "neutral",
  },
  {
    key: "volume",
    label: "Volume",
    align: "right",
    format: (r) => {
      if (r.volume == null) return "—";
      if (r.volume >= 1_000_000) return `${(r.volume / 1_000_000).toFixed(1)}M`;
      if (r.volume >= 1_000) return `${(r.volume / 1_000).toFixed(0)}K`;
      return r.volume.toFixed(0);
    },
  },
  {
    key: "rsi",
    label: "RSI",
    align: "right",
    format: (r) => formatIndicator(r.indicator_values.rsi),
    colorize: (r) => {
      const v = r.indicator_values.rsi;
      if (v == null) return "neutral";
      return v > 70 ? "up" : v < 30 ? "down" : "neutral";
    },
  },
  {
    key: "macd",
    label: "MACD",
    align: "right",
    format: (r) => formatIndicator(r.indicator_values.macd, 3),
    colorize: (r) => {
      const v = r.indicator_values.macd;
      if (v == null) return "neutral";
      return v > 0 ? "up" : v < 0 ? "down" : "neutral";
    },
  },
  {
    key: "ema_50",
    label: "EMA 50",
    align: "right",
    format: (r) => formatIndicator(r.indicator_values.ema_50),
  },
  {
    key: "ema_200",
    label: "EMA 200",
    align: "right",
    format: (r) => formatIndicator(r.indicator_values.ema_200),
  },
  {
    key: "adx",
    label: "ADX",
    align: "right",
    format: (r) => formatIndicator(r.indicator_values.adx),
    colorize: (r) => {
      const v = r.indicator_values.adx;
      if (v == null) return "neutral";
      return v > 25 ? "up" : "neutral";
    },
  },
];

function formatIndicator(val: number | null | undefined, decimals = 2): string {
  if (val == null) return "—";
  return val.toFixed(decimals);
}

// ── Sort icon ─────────────────────────────────────────────

function SortIcon({ col, sortBy, sortDir }: { col: string; sortBy: string; sortDir: SortDir }) {
  if (col !== sortBy)
    return <ArrowUpDown size={10} className="opacity-30" />;
  return sortDir === "asc" ? (
    <ArrowUp size={10} className="text-[var(--clr-cyan)]" />
  ) : (
    <ArrowDown size={10} className="text-[var(--clr-cyan)]" />
  );
}

// ── Color class for value ─────────────────────────────────

function valueColor(c: "up" | "down" | "neutral" | undefined): string {
  if (c === "up") return "text-[var(--clr-green)]";
  if (c === "down") return "text-[var(--clr-red)]";
  return "text-[var(--text-2)]";
}

// ── Sorting helper ────────────────────────────────────────

function getSortValue(row: ScreenerResultRow, col: string): number | string {
  switch (col) {
    case "symbol":
      return row.symbol;
    case "company_name":
      return row.company_name;
    case "last_price":
      return row.last_price ?? -Infinity;
    case "change_percent":
      return row.change_percent ?? -Infinity;
    case "volume":
      return row.volume ?? -Infinity;
    default:
      return row.indicator_values[col] ?? -Infinity;
  }
}

// ── Empty state ───────────────────────────────────────────

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

// ── Main component ────────────────────────────────────────

export default function ScreenerResultsTable() {
  const { results, totalScanned, totalMatched, sortBy, sortDir, setSort, selectedPreset } =
    useScreenerStore();
  const navigateToAnalysis = useNavigationStore((s) => s.navigateToAnalysis);

  // Sort results
  const sorted = useMemo(() => {
    if (!results.length) return [];
    const copy = [...results];
    copy.sort((a, b) => {
      const aVal = getSortValue(a, sortBy);
      const bVal = getSortValue(b, sortBy);
      const cmp = typeof aVal === "string"
        ? (aVal as string).localeCompare(bVal as string)
        : (aVal as number) - (bVal as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [results, sortBy, sortDir]);

  const handleSort = (col: string) => {
    if (sortBy === col) {
      setSort(col, sortDir === "asc" ? "desc" : "asc");
    } else {
      setSort(col, "desc");
    }
  };

  if (!results.length) {
    return <EmptyState hasPreset={!!selectedPreset} />;
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Results summary bar */}
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
                  className={`cursor-pointer select-none px-3 py-2 ${col.width ?? ""}`}
                  onClick={() => handleSort(col.key)}
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
                {COLUMNS.map((col) => {
                  const color = col.colorize ? col.colorize(row) : undefined;
                  return (
                    <TableCell
                      key={col.key}
                      className={`px-3 py-2 font-data text-[11px] ${
                        col.align === "right" ? "text-right" : ""
                      } ${
                        col.key === "symbol"
                          ? "font-semibold text-[var(--text-1)]"
                          : col.key === "company_name"
                            ? "text-[var(--text-3)] truncate max-w-[160px]"
                            : valueColor(color)
                      }`}
                    >
                      {col.format(row)}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
