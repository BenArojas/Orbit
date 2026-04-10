/**
 * GatewaySetup — Gateway status indicator and provisioning UI.
 *
 * Shows different content based on Gateway state:
 *   - not_provisioned → "Set Up Gateway" button
 *   - downloading_*   → Progress bar with download status
 *   - provisioned     → "Start Gateway" button
 *   - running         → Green status + auth link
 *   - error           → Error message + retry button
 *
 * Designed to sit in the Dashboard or a settings panel.
 * Once the Gateway is running, the user authenticates via the IBKR
 * login page at the backend-provided gateway_url.
 */

import { useGateway } from "@/hooks/useGateway";

/* ── Progress bar ── */

function ProgressBar({ percent, label }: { percent: number; label: string }) {
  return (
    <div className="w-full">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] text-[var(--text-3)]">{label}</span>
        <span className="text-[10px] font-mono text-[var(--text-2)]">
          {percent}%
        </span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full"
        style={{ background: "var(--bg-0)" }}
      >
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${percent}%`,
            background: "var(--clr-cyan)",
          }}
        />
      </div>
    </div>
  );
}

/* ── Status dot ── */

function StatusDot({ running }: { running: boolean }) {
  return (
    <span
      className="inline-block h-2 w-2 rounded-full"
      style={{
        background: running ? "var(--clr-green)" : "var(--clr-red)",
        boxShadow: running
          ? "0 0 6px var(--clr-green)"
          : "0 0 6px var(--clr-red)",
      }}
    />
  );
}

/* ── Main component ── */

export function GatewaySetup() {
  const {
    status,
    isRunning,
    isAuthenticated,
    needsLogin,
    isProvisioning,
    provision,
    start,
    actionError,
    actionLoading,
  } = useGateway();

  if (!status) {
    return (
      <div className="rounded-lg border border-[var(--border)] p-4">
        <div className="text-[11px] text-[var(--text-3)]">
          Loading Gateway status...
        </div>
      </div>
    );
  }

  return (
    <div
      className="rounded-lg border p-4"
      style={{
        borderColor: isRunning ? "var(--clr-green)" : "var(--border)",
        background: isRunning ? "var(--glow-green)" : "var(--bg-1)",
      }}
    >
      {/* Header */}
      <div className="mb-3 flex items-center gap-2">
        <StatusDot running={isRunning} />
        <span className="text-[12px] font-semibold text-foreground">
          IBKR Gateway
        </span>
        <span className="text-[10px] text-[var(--text-3)]">
          {isRunning
            ? isAuthenticated
              ? "authenticated"
              : "login required"
            : status.state.replace(/_/g, " ")}
        </span>
      </div>

      {/* Not provisioned */}
      {status.state === "not_provisioned" && (
        <div>
          <p className="mb-3 text-[11px] text-[var(--text-2)]">
            The IBKR Client Portal Gateway needs to be downloaded and set up.
            This is a one-time setup that takes about 30-60 seconds.
          </p>
          <button
            className="rounded-md px-3 py-1.5 text-[11px] font-medium text-[var(--bg-0)] disabled:opacity-50"
            style={{ background: "var(--clr-cyan)" }}
            onClick={() => provision()}
            disabled={actionLoading}
          >
            {actionLoading ? "Setting up..." : "Set Up Gateway"}
          </button>
        </div>
      )}

      {/* Downloading */}
      {isProvisioning && status.progress && (
        <ProgressBar
          percent={status.progress.percent}
          label={status.progress.step}
        />
      )}

      {/* Starting (no progress data) */}
      {status.state === "starting" && !status.progress && (
        <div className="text-[11px] text-[var(--text-3)]">
          Starting Gateway...
        </div>
      )}

      {/* Provisioned but not running */}
      {status.state === "provisioned" && (
        <div>
          <p className="mb-3 text-[11px] text-[var(--text-2)]">
            Gateway is ready. Start it to connect to IBKR.
          </p>
          <button
            className="rounded-md px-3 py-1.5 text-[11px] font-medium text-[var(--bg-0)] disabled:opacity-50"
            style={{ background: "var(--clr-cyan)" }}
            onClick={start}
            disabled={actionLoading}
          >
            {actionLoading ? "Starting..." : "Start Gateway"}
          </button>
        </div>
      )}

      {/* Running */}
      {isRunning && (
        <div>
          <p className="mb-2 text-[11px] text-[var(--text-2)]">
            {needsLogin
              ? "Gateway is running. Open the IBKR login page and sign in to finish connecting."
              : "Gateway is running and authenticated. IBKR features are ready."}
          </p>
          {status.auth_message && (
            <p className="mb-2 text-[10px] text-[var(--text-3)]">
              {status.auth_message}
            </p>
          )}
          <a
            href={status.gateway_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block rounded-md border px-3 py-1.5 text-[11px] font-medium transition-colors hover:bg-[var(--bg-2)]"
            style={{
              borderColor: "var(--clr-cyan)",
              color: "var(--clr-cyan)",
            }}
          >
            {needsLogin ? "Open IBKR Login" : "Open Gateway"}
          </a>
        </div>
      )}

      {/* Error */}
      {status.state === "error" && (
        <div>
          <p className="mb-2 text-[11px] text-[var(--clr-red)]">
            {status.error}
          </p>
          <button
            className="rounded-md px-3 py-1.5 text-[11px] font-medium text-[var(--bg-0)] disabled:opacity-50"
            style={{ background: "var(--clr-orange)" }}
            onClick={() => provision(true)}
            disabled={actionLoading}
          >
            {actionLoading ? "Retrying..." : "Retry Setup"}
          </button>
        </div>
      )}

      {/* Action error (from hook) */}
      {actionError && (
        <p className="mt-2 text-[10px] text-[var(--clr-red)]">
          {actionError}
        </p>
      )}
    </div>
  );
}
