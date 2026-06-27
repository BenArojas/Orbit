/**
 * GatewayStatusPill — top-bar combined broker status pill + connect popover.
 *
 * Distinguishes three TWS states and two CP states, with TWS taking priority:
 *
 *   Orbit adapter connected    → green   "IBKR · TWS"
 *   API server reachable only  → green   "IBKR · TWS ready"
 *   CP Web API authenticated   → green   "IBKR · Web API"
 *   CP running, login needed   → amber   "IBKR · login required"
 *   CP error                   → red     "IBKR · error"
 *   none reachable             → red     "IBKR · disconnected"
 */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useGatewayContext } from "@/context/GatewayContext";
import { GatewaySetup } from "@/components/gateway/GatewaySetup";
import { twsApi } from "@/modules/tws-execution-assistant/api";

// Same key as TwsExecutionAssistantModule — shares TanStack Query cache.
const TWS_STATUS_KEY = ["tws-status"] as const;

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
  const { data: twsStatus } = useQuery({
    queryKey: TWS_STATUS_KEY,
    queryFn: twsApi.getStatus,
    refetchInterval: 5000,
    staleTime: 2000,
  });

  const isTwsConnected = twsStatus?.connected === true;
  const isTwsReady = !isTwsConnected && twsStatus?.api_server_available === true;

  const [open, setOpen] = useState(!isAuthenticated && !isTwsConnected && !isTwsReady);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close automatically once any broker is active.
  useEffect(() => {
    if (isAuthenticated || isTwsConnected) setOpen(false);
  }, [isAuthenticated, isTwsConnected]);

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
    if (isTwsConnected) return { tone: "green", label: "TWS" };
    if (isTwsReady) return { tone: "green", label: "TWS ready" };
    const state = status?.state;
    if (state === "running" && isAuthenticated) return { tone: "green", label: "Web API" };
    if (state === "running" && needsLogin) return { tone: "amber", label: "login required" };
    if (state === "error") return { tone: "red", label: "error" };
    return { tone: "red", label: "disconnected" };
  })();

  // TWS popover section text
  const twsStatusLabel = isTwsConnected
    ? "Connected"
    : isTwsReady
      ? "Ready"
      : "Not available";
  const twsStatusColor = isTwsConnected || isTwsReady ? "text-emerald-400" : "text-[var(--text-3)]";
  const twsHint = isTwsConnected
    ? null
    : isTwsReady
      ? "Open TWS Execution Assistant to connect Orbit."
      : "Open the TWS Execution Assistant module to connect.";

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
        <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-[320px] rounded-xl border border-border bg-[var(--bg-2)] p-3 shadow-[0_8px_30px_rgba(0,0,0,0.5)]">
          {/* TWS / IB Gateway section */}
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
              TWS / IB Gateway
            </span>
            <span className={`text-[11px] font-medium ${twsStatusColor}`}>
              {twsStatusLabel}
            </span>
          </div>
          {twsHint && (
            <p className="mb-3 text-[11px] text-[var(--text-3)]">{twsHint}</p>
          )}

          <div className="my-3 border-t border-border" />

          {/* Client Portal / Web API section */}
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
            Client Portal · Web API
          </p>
          <GatewaySetup hideLogout={false} />
        </div>
      )}
    </div>
  );
}
