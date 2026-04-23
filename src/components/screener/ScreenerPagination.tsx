/**
 * ScreenerPagination — Client-side page controls for screener results.
 *
 * Layout:
 *   Found 45 results. Showing 1–25 of 45.      [< Prev]  Page 1 of 2  [Next >]
 *
 * Notes:
 *   - All pagination is client-side — changing page never hits the backend.
 *   - Page size is fixed at SCREENER_PAGE_SIZE (no size selector).
 *   - Hidden when the buffer is empty AND no scan is in flight.
 *   - During a rescan (results exist + isScanning), the range text is replaced
 *     with "Loading…" and page navigation is disabled so users don't mistake
 *     stale row counts for the new scan's results.
 */

import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useScreenerStore, SCREENER_PAGE_SIZE } from "@/store/screener";

export default function ScreenerPagination() {
  const { results, page, setPage, isScanning } = useScreenerStore();

  const total = results.length;
  // Hide the pagination bar entirely on the cold-start empty state,
  // but keep it visible during a rescan so we can show "Loading…".
  if (total === 0 && !isScanning) return null;

  const totalPages = Math.max(1, Math.ceil(total / SCREENER_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * SCREENER_PAGE_SIZE + 1;
  const end = Math.min(safePage * SCREENER_PAGE_SIZE, total);

  const handlePrev = () => {
    if (safePage > 1 && !isScanning) setPage(safePage - 1);
  };
  const handleNext = () => {
    if (safePage < totalPages && !isScanning) setPage(safePage + 1);
  };

  return (
    <div className="flex items-center justify-between border-t border-border bg-[var(--bg-1)] px-4 py-2">
      {/* Range text — replaced by "Loading…" during a rescan */}
      {isScanning ? (
        <span className="flex items-center gap-1.5 font-data text-[11px] text-[var(--text-2)]">
          <Loader2 size={11} className="animate-spin text-[var(--clr-cyan)]" />
          Loading…
        </span>
      ) : (
        <span className="font-data text-[11px] text-[var(--text-2)]">
          Found <span className="text-[var(--text-1)]">{total}</span> results.
          {" "}
          Showing{" "}
          <span className="text-[var(--text-1)]">{start}</span>
          –
          <span className="text-[var(--text-1)]">{end}</span>
          {" "}
          of <span className="text-[var(--text-1)]">{total}</span>.
        </span>
      )}

      {/* Page navigation — disabled while scanning */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={safePage <= 1 || isScanning}
          onClick={handlePrev}
          className="h-7 w-7 p-0 text-[var(--text-3)] hover:text-[var(--text-1)] disabled:opacity-30"
          aria-label="Previous page"
        >
          <ChevronLeft size={14} />
        </Button>

        <span className="font-data text-[11px] text-[var(--text-2)]">
          Page{" "}
          <span className="font-medium text-[var(--text-1)]">{safePage}</span>
          {" of "}
          <span className="font-medium text-[var(--text-1)]">{totalPages}</span>
        </span>

        <Button
          variant="ghost"
          size="sm"
          disabled={safePage >= totalPages || isScanning}
          onClick={handleNext}
          className="h-7 w-7 p-0 text-[var(--text-3)] hover:text-[var(--text-1)] disabled:opacity-30"
          aria-label="Next page"
        >
          <ChevronRight size={14} />
        </Button>
      </div>
    </div>
  );
}
