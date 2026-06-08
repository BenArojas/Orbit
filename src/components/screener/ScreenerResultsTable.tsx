/**
 * ScreenerResultsTable — Sortable, paginated table of screener scan results
 *
 * Columns: Symbol, Name, Type, Price, Chg%, Volume
 * Click any row → open quick-peek (ScreenerPeekPanel) — mkt cap lives there,
 * not in the table row. IBKR snapshot doesn't expose it reliably.
 *
 * Sort model (client-side):
 *   - sortBy === "" → preserve IBKR scanner's natural arrival order.
 *   - Click a column header to sort by that column (toggles asc/desc).
 *
 * Pagination model (client-side):
 *   - The full sorted view is sliced to the current page.
 *   - ScreenerPagination owns the page counter.
 *
 * Disclaimer strip (top):
 *   - If lastBatchSize === 50 → "Searched top 50 results."
 *     (button deferred — see TODO)
 *   - If 0 < lastBatchSize < 50 → "Showing all N matching results."
 *
 * TODO (next pass): "Search next 50" button
 *   Wire it to appendResults() once IBKR offset paging is implemented.
 */

import { useMemo } from "react";
import { ArrowUpDown, ArrowUp, ArrowDown, TrendingUp, Info } from "lucide-react";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import type { ScreenerResultRow, StockTagMap } from "@/modules/parallax/api";
import {
  useScreenerStore,
  SCREENER_PAGE_SIZE,
  type SortDir,
} from "@/store/screener";
import { TableSkeleton } from "./ScreenerSkeleton";
import { useStockTags } from "@/hooks/useStockTags";
import { StockTagDots } from "@/components/tags/StockTagDots";

/** The IBKR /iserver/scanner/run cap we ask for per call. If we got exactly
 *  this many rows back, IBKR likely has more to give us. */
const IBKR_SCAN_BATCH_CAP = 50;

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
    // For no-quote scan rows (FIRST_TRADE_DATE_ASC etc.) last_price is null
    // and IBKR's scan_data carries the meaningful value (e.g. the next
    // first-trade date). Render it as the cell content with a small label
    // chip so the column tells the user what they're looking at.
    render: (r) => {
      if (r.last_price != null) {
        return <span className="text-[var(--text-2)]">{fmtPrice(r.last_price)}</span>;
      }
      if (r.scan_data) {
        return (
          <span
            className="text-[var(--text-2)] font-data text-[10px]"
            title={r.scan_data_label ?? undefined}
          >
            {r.scan_data_label && (
              <span className="text-[var(--text-3)] mr-1">
                {r.scan_data_label}:
              </span>
            )}
            {r.scan_data}
          </span>
        );
      }
      return <span className="text-[var(--text-3)]">—</span>;
    },
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
];

// ── Sort helpers ──────────────────────────────────────────────

function getSortValue(row: ScreenerResultRow, col: string): number | string {
  switch (col) {
    case "symbol":         return row.symbol;
    case "company_name":   return row.company_name;
    case "sec_type":       return row.sec_type;
    case "last_price":     return row.last_price ?? -Infinity;
    case "change_percent": return row.change_percent ?? -Infinity;
    case "volume":         return row.volume ?? -Infinity;
    default:               return -Infinity;
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

// ── Disclaimer strip ──────────────────────────────────────────

/**
 * Shows whether the user has seen all matching results or only the top N.
 *
 * TODO (next pass): render a "Search next 50" button here when lastBatchSize
 * equals IBKR_SCAN_BATCH_CAP. It should call appendResults() with the next
 * batch once IBKR offset paging is implemented. For now we only render the
 * informational disclaimer.
 */
function DisclaimerStrip({
  total,
  lastBatchSize,
}: {
  total: number;
  lastBatchSize: number;
}) {
  // First call returned fewer than the cap → we have everything IBKR matched.
  const exhausted = lastBatchSize > 0 && lastBatchSize < IBKR_SCAN_BATCH_CAP;
  // Last call returned the full cap → IBKR probably has more but we're capped.
  const mayHaveMore = lastBatchSize === IBKR_SCAN_BATCH_CAP;

  let text: string;
  if (exhausted) {
    text = `Showing all ${total} matching results.`;
  } else if (mayHaveMore) {
    text = `Searched the top ${total} results only.`;
  } else {
    return null;
  }

  return (
    <div className="flex items-center gap-2 border-b border-border bg-[var(--bg-1)]/50 px-4 py-1.5">
      <Info size={11} className="text-[var(--text-3)]" />
      <span className="font-data text-[10px] text-[var(--text-3)]">{text}</span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────

export default function ScreenerResultsTable() {
  const {
    results,
    isScanning,
    lastBatchSize,
    sortBy,
    sortDir,
    setSort,
    page,
    selectedPreset,
    setPeekConid,
  } = useScreenerStore();

  /**
   * Sorted + paginated slice.
   *
   * - When `sortBy === ""` we keep the scanner's natural arrival order
   *   (so Top Gainers stays in % gain order, Most Active in volume order,
   *   etc.) and only slice for the current page.
   * - When a column is selected, we sort the full buffer then slice. Sorting
   *   the full buffer (not just the visible page) is important so paging
   *   through sorted results stays consistent.
   */
  const pageRows = useMemo(() => {
    if (!results.length) return [];

    const sorted = sortBy
      ? [...results].sort((a, b) => {
          const aVal = getSortValue(a, sortBy);
          const bVal = getSortValue(b, sortBy);
          const cmp =
            typeof aVal === "string"
              ? (aVal as string).localeCompare(bVal as string)
              : (aVal as number) - (bVal as number);
          return sortDir === "asc" ? cmp : -cmp;
        })
      : results;

    const totalPages = Math.max(1, Math.ceil(sorted.length / SCREENER_PAGE_SIZE));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * SCREENER_PAGE_SIZE;
    return sorted.slice(start, start + SCREENER_PAGE_SIZE);
  }, [results, sortBy, sortDir, page]);

  // Tag dots for visible page (shows which results are firing watchlist rules)
  const tagConids = pageRows.map((r) => r.conid);
  const { data: stockTags } = useStockTags(tagConids);

  const handleSort = (col: string) => {
    if (sortBy !== col) {
      // First click on a new column → desc
      setSort(col, "desc");
    } else if (sortDir === "desc") {
      setSort(col, "asc");
    } else {
      // Third click returns to natural order
      setSort("", "desc");
    }
  };

  // Show skeleton while scanning
  if (isScanning) {
    return <TableSkeleton rows={15} />;
  }

  if (!results.length) {
    return <EmptyState hasPreset={!!selectedPreset} />;
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Disclaimer strip — top/bottom cap messaging */}
      <DisclaimerStrip total={results.length} lastBatchSize={lastBatchSize} />

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
            {pageRows.map((row) => (
              <TableRow
                key={row.conid}
                onClick={() => setPeekConid(row.conid)}
                className="cursor-pointer border-b border-border/50 transition-colors hover:bg-[var(--bg-3)]"
              >
                {COLUMNS.map((col) => (
                  <TableCell
                    key={col.key}
                    data-testid={col.key === "symbol" ? "screener-tag-cell" : undefined}
                    className={`px-3 py-2 font-data text-[11px] ${
                      col.align === "right" ? "text-right" : ""
                    }`}
                  >
                    {col.key === "symbol" ? (
                      <span className="inline-flex items-center gap-1.5">
                        {col.render(row)}
                        <StockTagDots
                          tags={(stockTags as StockTagMap | undefined)?.[row.conid] ?? []}
                          max={3}
                        />
                      </span>
                    ) : (
                      col.render(row)
                    )}
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
