import { AlertTriangle } from "lucide-react";

export function BasisBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-[var(--clr-orange)]/50 bg-[var(--clr-orange)]/10 px-2 py-1 text-[10px] font-medium text-[var(--clr-orange)]">
      <AlertTriangle className="h-3 w-3" strokeWidth={1.8} />
      Needs basis
    </span>
  );
}
