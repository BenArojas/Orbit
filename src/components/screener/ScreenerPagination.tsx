/**
 * ScreenerPagination — Page controls for screener results.
 *
 * Shows: [< Prev] Page X of Y [Next >]  |  25 / 50 / 100 per page
 * Triggers a new scan request when page changes.
 */

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useScreenerStore } from "@/store/screener";

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

export default function ScreenerPagination({
  onPageChange,
}: {
  onPageChange: (page: number, pageSize: number) => void;
}) {
  const { page, pageSize, totalPages, totalMatched, setPage, setPageSize } =
    useScreenerStore();

  if (totalPages <= 1 && totalMatched <= PAGE_SIZE_OPTIONS[0]) return null;

  const handlePrev = () => {
    if (page <= 1) return;
    const newPage = page - 1;
    setPage(newPage);
    onPageChange(newPage, pageSize);
  };

  const handleNext = () => {
    if (page >= totalPages) return;
    const newPage = page + 1;
    setPage(newPage);
    onPageChange(newPage, pageSize);
  };

  const handlePageSize = (size: number) => {
    setPageSize(size);
    onPageChange(1, size);
  };

  return (
    <div className="flex items-center justify-between border-t border-border bg-[var(--bg-1)] px-4 py-2">
      {/* Page navigation */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={page <= 1}
          onClick={handlePrev}
          className="h-7 w-7 p-0 text-[var(--text-3)] hover:text-[var(--text-1)] disabled:opacity-30"
        >
          <ChevronLeft size={14} />
        </Button>

        <span className="font-data text-[11px] text-[var(--text-2)]">
          Page{" "}
          <span className="font-medium text-[var(--text-1)]">{page}</span>
          {" of "}
          <span className="font-medium text-[var(--text-1)]">{totalPages}</span>
        </span>

        <Button
          variant="ghost"
          size="sm"
          disabled={page >= totalPages}
          onClick={handleNext}
          className="h-7 w-7 p-0 text-[var(--text-3)] hover:text-[var(--text-1)] disabled:opacity-30"
        >
          <ChevronRight size={14} />
        </Button>
      </div>

      {/* Total count */}
      <span className="font-data text-[10px] text-[var(--text-3)]">
        {totalMatched} results
      </span>

      {/* Page size selector */}
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-[var(--text-3)]">Show:</span>
        {PAGE_SIZE_OPTIONS.map((size) => (
          <button
            key={size}
            onClick={() => handlePageSize(size)}
            className={`rounded px-1.5 py-0.5 font-data text-[10px] transition-colors ${
              pageSize === size
                ? "bg-[var(--clr-cyan)]/20 font-medium text-[var(--clr-cyan)]"
                : "text-[var(--text-3)] hover:text-[var(--text-1)]"
            }`}
          >
            {size}
          </button>
        ))}
      </div>
    </div>
  );
}
