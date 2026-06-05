import { LayoutGrid } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";

/**
 * Shared "Back to Orbit" launcher button. Used by every module header so the
 * return affordance looks and behaves identically across Parallax, MoonMarket,
 * and future modules.
 */
export function BackToOrbitButton({ className }: { className?: string }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate("/")}
      title="Back to Orbit launcher"
      className={cn(
        "flex items-center gap-1.5 rounded-md border border-border px-2.5 py-[3px] text-[10px] font-medium text-[var(--text-3)] transition-colors hover:border-[var(--clr-cyan)] hover:text-[var(--clr-cyan)]",
        className,
      )}
    >
      <LayoutGrid className="h-3 w-3" />
      Orbit
    </button>
  );
}
