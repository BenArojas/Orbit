/**
 * HealthStrip — Phase 7.5
 *
 * Thin status bar at the bottom of AppShell.
 * Shows a single coloured dot + summary text ("All systems OK" / "1 issue" / "N issues").
 * Click anywhere on the strip to open the health detail modal.
 *
 * Modal contains 5 named checks in plain English:
 *   IBKR Gateway · Ollama (AI) · Scanner · Database · Trigger Rules
 *
 * "Copy diagnostics" exports the raw API JSON to the clipboard — for devs only.
 * Non-technical users see only the plain-English messages.
 *
 * Polls GET /health/details every 10 s.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "@/config/endpoints";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────

interface HealthCheck {
  ok: boolean;
  label: string;
  message: string;
  severity: "ok" | "warning" | "error";
}

interface HealthDetails {
  overall: "ok" | "warning" | "error";
  checks: HealthCheck[];
  generated_at: string;
}

// ── Data fetching ─────────────────────────────────────────────────────────────

async function fetchHealthDetails(): Promise<HealthDetails> {
  const res = await fetch(`${API_BASE}/health/details`);
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  return res.json() as Promise<HealthDetails>;
}

function useHealthDetails() {
  return useQuery<HealthDetails>({
    queryKey: ["health-details"],
    queryFn: fetchHealthDetails,
    // 10 s — balances responsiveness with backend load; health checks are cheap
    // but run multiple sub-checks (IBKR, Ollama, scanner, DB, triggers).
    refetchInterval: 10_000,
    retry: 2,
    staleTime: 8_000,
  });
}

// ── Visual helpers ────────────────────────────────────────────────────────────

const OVERALL_DOT: Record<string, string> = {
  ok: "bg-[var(--clr-green)]",
  warning: "bg-[var(--clr-orange)]",
  error: "bg-[var(--clr-red)]",
};

const OVERALL_TEXT: Record<string, string> = {
  ok: "text-[var(--clr-green)]",
  warning: "text-[var(--clr-orange)]",
  error: "text-[var(--clr-red)]",
};

const CHECK_ICON: Record<string, { icon: string; color: string }> = {
  ok: { icon: "●", color: "text-[var(--clr-green)]" },
  warning: { icon: "●", color: "text-[var(--clr-orange)]" },
  error: { icon: "●", color: "text-[var(--clr-red)]" },
};

function summaryText(data: HealthDetails | undefined, isError: boolean): string {
  if (isError) return "Health check unavailable";
  if (!data) return "Checking system status…";
  const issues = data.checks.filter((c) => !c.ok).length;
  if (issues === 0) return "All systems OK";
  return `${issues} issue${issues !== 1 ? "s" : ""} detected`;
}

// ── Modal content ─────────────────────────────────────────────────────────────

function CheckRow({ check }: { check: HealthCheck }) {
  const { icon, color } = CHECK_ICON[check.severity] ?? CHECK_ICON.ok;
  return (
    <div className="flex items-start gap-3 py-3 border-b border-border last:border-0">
      <span className={`mt-px text-[8px] shrink-0 ${color}`}>{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium text-[var(--text-1)]">{check.label}</p>
        <p className="text-[10px] text-[var(--text-3)] leading-snug mt-0.5">{check.message}</p>
      </div>
    </div>
  );
}

function HealthModal({
  open,
  onClose,
  data,
  rawJson,
}: {
  open: boolean;
  onClose: () => void;
  data: HealthDetails | undefined;
  rawJson: string;
}) {
  function copyDiagnostics() {
    navigator.clipboard.writeText(rawJson).then(
      () => toast.success("Diagnostics copied to clipboard"),
      () => toast.error("Failed to copy diagnostics"),
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm bg-[var(--bg-2)] border-border">
        <DialogHeader>
          <DialogTitle className="text-[13px] font-semibold text-[var(--text-1)]">
            System Health
          </DialogTitle>
        </DialogHeader>

        <div className="mt-1">
          {data ? (
            data.checks.map((check) => (
              <CheckRow key={check.label} check={check} />
            ))
          ) : (
            <p className="py-6 text-center text-[11px] text-[var(--text-3)]">
              Loading health status…
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="mt-3 flex items-center justify-between">
          {data && (
            <span className="text-[9px] text-[var(--text-3)]">
              Updated {new Date(data.generated_at).toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={copyDiagnostics}
            disabled={!data}
            className="ml-auto text-[10px] text-[var(--text-3)] hover:text-[var(--text-2)] disabled:opacity-40 transition-colors"
          >
            Copy diagnostics
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Strip ─────────────────────────────────────────────────────────────────────

export function HealthStrip() {
  const [modalOpen, setModalOpen] = useState(false);
  const { data, isError } = useHealthDetails();

  const overall = data?.overall ?? (isError ? "error" : "ok");
  const dotClass = OVERALL_DOT[overall] ?? OVERALL_DOT.ok;
  const textClass = OVERALL_TEXT[overall] ?? OVERALL_TEXT.ok;
  const summary = summaryText(data, isError);
  const rawJson = data ? JSON.stringify(data, null, 2) : "{}";

  return (
    <>
      <button
        onClick={() => setModalOpen(true)}
        className="flex h-7 w-full items-center gap-2 border-t border-border bg-[var(--bg-1)] px-4 hover:bg-[var(--bg-2)] transition-colors"
        aria-label="View system health"
      >
        {/* Status dot */}
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} />

        {/* Summary text */}
        <span className={`font-data text-[10px] ${textClass}`}>{summary}</span>

        {/* Spacer */}
        <span className="flex-1" />

        {/* "Details" hint */}
        <span className="text-[9px] text-[var(--text-3)] opacity-60">Details</span>
      </button>

      <HealthModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        data={data}
        rawJson={rawJson}
      />
    </>
  );
}
