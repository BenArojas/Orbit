/**
 * LocationResetBanner — transient amber strip shown when the location
 * override had to be auto-reset.
 *
 * Path C: when the user picks a scan from the Browse all scans panel
 * whose `instruments` array doesn't include the current location's
 * instrument, we silently reset the override to STK.US.MAJOR. This
 * banner explains why so the user isn't surprised when their next scan
 * runs against US Listed/NASDAQ instead of (e.g.) Japan.
 *
 * Behavior:
 *   - Renders only when locationResetReason is non-null
 *   - Auto-dismisses after 5s
 *   - Manual dismiss via the × button
 *   - Sits between the filter bar and the results table — same slot as
 *     the existing scan-error banner, amber instead of red
 */

import { useEffect } from "react";
import { X, AlertTriangle } from "lucide-react";
import { useScreenerStore } from "@/store/screener";

const AUTO_DISMISS_MS = 5_000;

export default function LocationResetBanner() {
  const reason = useScreenerStore((s) => s.locationResetReason);
  const setLocationResetReason = useScreenerStore(
    (s) => s.setLocationResetReason,
  );

  // Auto-dismiss after AUTO_DISMISS_MS
  useEffect(() => {
    if (!reason) return;
    const t = window.setTimeout(
      () => setLocationResetReason(null),
      AUTO_DISMISS_MS,
    );
    return () => window.clearTimeout(t);
  }, [reason, setLocationResetReason]);

  if (!reason) return null;

  return (
    <div
      data-testid="location-reset-banner"
      role="status"
      className="flex items-center gap-2 border-b border-[var(--clr-orange)]/30 bg-[var(--clr-orange)]/10 px-4 py-1.5 text-[11px] text-[var(--clr-orange)]"
    >
      <AlertTriangle size={12} className="shrink-0" />
      <span className="flex-1">{reason}</span>
      <button
        onClick={() => setLocationResetReason(null)}
        aria-label="Dismiss"
        className="shrink-0 rounded p-0.5 transition-colors hover:bg-[var(--clr-orange)]/20"
      >
        <X size={12} />
      </button>
    </div>
  );
}
