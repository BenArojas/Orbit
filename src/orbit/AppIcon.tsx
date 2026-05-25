/**
 * AppIcon — one launcher tile. Enabled tiles colorize and are clickable;
 * disabled tiles render gray with reduced opacity and are non-interactive
 * (used while IBKR is unauthenticated, or for not-yet-built modules).
 */
import { type LucideIcon } from "lucide-react";

interface AppIconProps {
  label: string;
  icon: LucideIcon;
  enabled: boolean;
  onOpen?: () => void;
  badge?: string;
  description?: string;
}

export function AppIcon({ label, icon: Icon, enabled, onOpen, badge, description }: AppIconProps) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={!enabled}
      onClick={enabled ? onOpen : undefined}
      title={enabled ? undefined : "Connect IBKR to open"}
      className={[
        "relative flex h-44 w-44 flex-col items-center justify-center gap-2",
        "rounded-2xl border transition-all",
        enabled
          ? "border-border bg-[var(--bg-2)] text-foreground hover:shadow-[0_0_18px_var(--glow-cyan)] hover:border-[var(--clr-cyan)] cursor-pointer"
          : "border-border/40 bg-[var(--bg-2)]/40 text-[var(--text-3)] opacity-40 cursor-not-allowed grayscale",
      ].join(" ")}
    >
      <Icon className="h-12 w-12" strokeWidth={1.5} />
      <span className="text-[13px] font-semibold tracking-wide">{label}</span>
      {description && (
        <span className="text-[10px] text-[var(--text-3)]">{description}</span>
      )}
      {badge && (
        <span className="absolute right-2 top-2 rounded-full border border-border bg-[var(--bg-1)] px-2 py-0.5 text-[9px] font-medium text-[var(--text-3)]">
          {badge}
        </span>
      )}
    </button>
  );
}
