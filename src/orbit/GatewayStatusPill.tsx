/**
 * GatewayStatusPill — top-bar IBKR status pill + connect popover.
 *
 * Derives a status dot + label from the gateway context. Clicking the pill
 * toggles a popover that renders the existing GatewaySetup verbatim (all
 * provision / download / start / login / recovery states reused). The popover
 * auto-opens while unauthenticated so the connect flow is immediately visible,
 * and closes once authenticated.
 */
import { useEffect, useRef, useState } from "react";
import { useGatewayContext } from "@/context/GatewayContext";
import { GatewaySetup } from "@/components/gateway/GatewaySetup";

type Tone = "green" | "amber" | "red";

function toneColor(tone: Tone): string {
  return tone === "green"
    ? "var(--clr-green)"
    : tone === "amber"
      ? "var(--clr-orange)"
      : "var(--clr-red)";
}

export function GatewayStatusPill() {
  const { status, isAuthenticated, needsLogin } = useGatewayContext();
  const [open, setOpen] = useState(!isAuthenticated);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close automatically once authenticated — the connect flow is done.
  useEffect(() => {
    if (isAuthenticated) setOpen(false);
  }, [isAuthenticated]);

  // Click-outside + Escape close the popover.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const { tone, label }: { tone: Tone; label: string } = (() => {
    const state = status?.state;
    if (state === "running" && isAuthenticated) return { tone: "green", label: "connected" };
    if (state === "running" && needsLogin) return { tone: "amber", label: "login required" };
    if (state === "error") return { tone: "red", label: "error" };
    return { tone: "red", label: "set up" };
  })();

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full border border-border bg-[var(--bg-2)] px-3 py-1 text-[11px] font-medium text-[var(--text-2)] transition-colors hover:border-[var(--clr-cyan)]"
      >
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: toneColor(tone), boxShadow: `0 0 6px ${toneColor(tone)}` }}
        />
        IBKR · {label}
        <span className="text-[var(--text-3)]">▾</span>
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-[300px] rounded-xl border border-border bg-[var(--bg-2)] p-3 shadow-[0_8px_30px_rgba(0,0,0,0.5)]">
          <GatewaySetup hideLogout={false} />
        </div>
      )}
    </div>
  );
}
