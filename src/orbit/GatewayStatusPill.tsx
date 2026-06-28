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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useGatewayContext } from "@/context/GatewayContext";
import { BROKER_SESSION_KEY } from "@/context/BrokerSessionContext";
import { GatewaySetup } from "@/components/gateway/GatewaySetup";
import { twsApi, TWS_CONNECT_DEFAULTS } from "@/modules/tws-execution-assistant/api";

// Same key as TwsExecutionAssistantModule — shares TanStack Query cache.
const TWS_STATUS_KEY = ["tws-status"] as const;

// Paper ports only — fail-closed gate matches the backend (4002 IB Gateway, 7497 TWS).
const PAPER_PORTS = [
  { port: 4002, label: "IB Gateway (4002)" },
  { port: 7497, label: "TWS (7497)" },
] as const;

type Tone = "green" | "amber" | "red";

function toneColor(tone: Tone): string {
  return tone === "green"
    ? "var(--clr-green)"
    : tone === "amber"
      ? "var(--clr-orange)"
      : "var(--clr-red)";
}

export function GatewayStatusPill() {
  const queryClient = useQueryClient();
  const { status, isAuthenticated, needsLogin } = useGatewayContext();
  const { data: twsStatus } = useQuery({
    queryKey: TWS_STATUS_KEY,
    queryFn: twsApi.getStatus,
    refetchInterval: 5000,
    staleTime: 2000,
  });

  const isTwsConnected = twsStatus?.connected === true;
  const isTwsReady = !isTwsConnected && twsStatus?.api_server_available === true;

  const [port, setPort] = useState<number>(TWS_CONNECT_DEFAULTS.port);

  // Connect/disconnect from the pill so TWS is managed from the top bar like
  // the Web API — both mutations refresh the session mode that gates the tiles.
  const onSession = (result: Awaited<ReturnType<typeof twsApi.connect>>) => {
    queryClient.setQueryData(TWS_STATUS_KEY, result);
    queryClient.invalidateQueries({ queryKey: BROKER_SESSION_KEY });
  };
  const connectMutation = useMutation({
    mutationFn: () => twsApi.connect({ ...TWS_CONNECT_DEFAULTS, port }),
    onSuccess: onSession,
  });
  const disconnectMutation = useMutation({
    mutationFn: twsApi.disconnect,
    onSuccess: onSession,
  });

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
      ? "TWS / IB Gateway is running. Connect Orbit to enter TWS mode."
      : "Start TWS or IB Gateway with the API enabled, then connect.";
  const connectError =
    connectMutation.error || disconnectMutation.error
      ? "Connection failed — check the port and that the API is enabled in TWS."
      : null;
  const busy = connectMutation.isPending || disconnectMutation.isPending;

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
            <p className="mb-2 text-[11px] text-[var(--text-3)]">{twsHint}</p>
          )}

          {isTwsConnected ? (
            <button
              type="button"
              onClick={() => disconnectMutation.mutate()}
              disabled={busy}
              className="mb-1 w-full rounded-md border border-border bg-[var(--bg-1)] px-3 py-1.5 text-[12px] font-medium text-[var(--text-2)] transition-colors hover:border-[var(--clr-red)] disabled:opacity-50"
            >
              {busy ? "Disconnecting…" : "Disconnect"}
            </button>
          ) : (
            <div className="mb-1 flex items-center gap-2">
              <select
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
                disabled={busy}
                className="flex-1 rounded-md border border-border bg-[var(--bg-1)] px-2 py-1.5 text-[12px] text-[var(--text-2)] disabled:opacity-50"
              >
                {PAPER_PORTS.map((p) => (
                  <option key={p.port} value={p.port}>
                    {p.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => connectMutation.mutate()}
                disabled={busy}
                className="rounded-md border border-[var(--clr-cyan)] bg-[var(--bg-1)] px-3 py-1.5 text-[12px] font-medium text-[var(--clr-cyan)] transition-colors hover:bg-[var(--clr-cyan)]/10 disabled:opacity-50"
              >
                {busy ? "Connecting…" : "Connect"}
              </button>
            </div>
          )}
          {connectError && (
            <p className="mb-2 text-[11px] text-[var(--clr-red)]">{connectError}</p>
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
