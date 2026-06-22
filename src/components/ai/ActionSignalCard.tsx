/**
 * ActionSignalCard — AI analysis result display
 *
 * Shows the AI's trading signal after analysis runs. Skeleton/empty state
 * shown by default until AI backend is wired up (Phase 4.10–4.12).
 *
 * Layout from mockup:
 *   - Direction badge (STRONG LONG / SHORT) + confidence %
 *   - Description text
 *   - Entry / Stop / Target levels in a 3-column grid
 *   - Meta row (R:R, Score, ADX, Vol)
 *   - Confirmation/caution checklist
 *
 * Accepts a `signal` prop. When null, shows "Run analysis" placeholder.
 */

/* ── Types ── */

export type SignalDirection = "STRONG LONG" | "LONG" | "NEUTRAL" | "SHORT" | "STRONG SHORT";

export interface SignalLevel {
  label: string;
  value: string;
  sub: string;
  /** "green" for target, "red" for stop, undefined for entry */
  color?: "green" | "red";
}

export interface SignalCheck {
  text: string;
  type: "confirm" | "caution";
}

export interface SignalData {
  direction: SignalDirection;
  description: string;
  confidence: number;
  levels: SignalLevel[];
  meta: { label: string; value: string }[];
  checks: SignalCheck[];
}

/* ── Helpers ── */

function directionColor(dir: SignalDirection): string {
  if (dir.includes("LONG")) return "var(--clr-green)";
  if (dir.includes("SHORT")) return "var(--clr-red)";
  return "var(--text-2)";
}

function directionGlow(dir: SignalDirection): string {
  if (dir.includes("LONG")) return "var(--glow-green)";
  if (dir.includes("SHORT")) return "var(--glow-red)";
  return "transparent";
}

/* ── Component ── */

interface ActionSignalCardProps {
  signal: SignalData | null;
  status?: "directional" | "neutral" | "rejected" | null;
  warning?: string | null;
  narrative?: string | null;
  onViewRejected?: () => void;
}

export default function ActionSignalCard({ signal, status, warning, narrative, onViewRejected }: ActionSignalCardProps) {
  /* Empty state — shown before any analysis has run */
  if (!signal) {
    return (
      <div className="flex shrink-0 flex-col items-center justify-center gap-2 border-b border-[var(--border)] px-4 py-8">
        <div className="h-8 w-8 rounded-full border border-[var(--border)] bg-[var(--bg-0)] flex items-center justify-center">
          <span className="text-[var(--text-3)] text-sm">?</span>
        </div>
        <span className="text-center text-[10px] text-[var(--text-3)]">
          Run analysis to see signal
        </span>
      </div>
    );
  }

  const color = directionColor(signal.direction);
  const glow = directionGlow(signal.direction);

  return (
    <div className="flex shrink-0 flex-col gap-3 border-b border-[var(--border)] px-4 py-3">
      {/* Direction + Confidence */}
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <span
            className="inline-block rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
            style={{ color, background: glow }}
          >
            {signal.direction}
          </span>
          <span className="text-[10px] text-[var(--text-2)] leading-snug max-w-[200px]">
            {signal.description}
          </span>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold tabular-nums" style={{ color }}>
            {signal.confidence}%
          </div>
          <div className="text-[8px] uppercase tracking-wider text-[var(--text-3)]">
            confidence
          </div>
        </div>
      </div>

      {/* Entry / Stop / Target levels */}
      <div className="grid grid-cols-3 gap-2">
        {signal.levels.map((level) => (
          <div
            key={level.label}
            className="rounded-md border border-[var(--border)] bg-[var(--bg-0)] px-2 py-1.5 text-center"
          >
            <div className="text-[8px] uppercase tracking-wider text-[var(--text-3)]">
              {level.label}
            </div>
            <div
              className="text-sm font-bold tabular-nums"
              style={{ color: level.color ? `var(--clr-${level.color})` : "var(--text-1)" }}
            >
              {level.value}
            </div>
            <div className="text-[8px] text-[var(--text-3)]">
              {level.sub || (level.value === "—" ? "No grounded level" : "")}
            </div>
          </div>
        ))}
      </div>

      {/* Meta row */}
      <div className="flex items-center justify-between rounded-md bg-[var(--bg-0)] px-3 py-1.5 font-data text-[9px] text-[var(--text-3)]">
        {signal.meta.map((m) => (
          <span key={m.label}>
            {m.label}{" "}
            <span className="text-[var(--text-2)]">{m.value}</span>
          </span>
        ))}
      </div>

      {/* Confirmation / Caution checks */}
      <div className="flex flex-col gap-1">
        {signal.checks.map((check, i) => (
          <div
            key={i}
            className="flex items-start gap-2 rounded px-2 py-1 text-[10px]"
            style={{
              background:
                check.type === "confirm"
                  ? "rgba(0, 255, 136, 0.04)"
                  : "rgba(255, 159, 28, 0.04)",
            }}
          >
            <span
              className="mt-px flex-shrink-0 text-[10px]"
              style={{
                color:
                  check.type === "confirm"
                    ? "var(--clr-green)"
                    : "var(--clr-orange)",
              }}
            >
              {check.type === "confirm" ? "✓" : "⚠"}
            </span>
            <span className="flex-1 text-[var(--text-2)]">{check.text}</span>
            <span
              className="flex-shrink-0 rounded px-1.5 py-0.5 text-[8px] font-bold uppercase"
              style={{
                color:
                  check.type === "confirm"
                    ? "var(--clr-green)"
                    : "var(--clr-orange)",
                background:
                  check.type === "confirm"
                    ? "var(--glow-green)"
                    : "var(--glow-orange)",
              }}
            >
              {check.type === "confirm" ? "CONFIRM" : "CAUTION"}
            </span>
          </div>
        ))}
      </div>

      {/* Safety warning — shown once for neutral/rejected */}
      {warning && (status === "neutral" || status === "rejected") && (
        <div
          data-testid="signal-warning"
          className="rounded-md border border-[var(--clr-orange,#ff9f1c)] bg-[rgba(255,159,28,0.06)] px-2 py-1.5 text-[10px] leading-relaxed text-[var(--clr-orange,#ff9f1c)]"
        >
          ⚠ {warning}
        </div>
      )}

      {/* Model commentary — shown for neutral only, labelled "not verified" */}
      {narrative && status === "neutral" && (
        <div className="rounded-md border border-[var(--border)] bg-[var(--bg-0)] px-2 py-1.5">
          <div className="mb-1 text-[8px] font-bold uppercase tracking-wider text-[var(--text-3)]">
            Model commentary — not verified
          </div>
          <div className="text-[10px] leading-relaxed text-[var(--text-2)] whitespace-pre-wrap">
            {narrative}
          </div>
        </div>
      )}

      {/* View raw rejected output — shown for rejected only */}
      {status === "rejected" && onViewRejected && (
        <button
          type="button"
          data-testid="view-rejected-output"
          onClick={onViewRejected}
          className="w-full rounded-md border border-[var(--border)] bg-[var(--bg-0)] px-2 py-1.5 text-[10px] text-[var(--text-3)] hover:text-[var(--text-2)] text-left"
        >
          View unverified model output →
        </button>
      )}
    </div>
  );
}
