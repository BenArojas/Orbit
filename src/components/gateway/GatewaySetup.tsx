/**
 * GatewaySetup — Gateway status indicator and provisioning UI.
 *
 * State machine drives all rendering — single switch(), no nested ternaries.
 * States and their UI:
 *   not_provisioned  → "Set Up Gateway" button
 *   downloading_jre  → progress bar (JRE)
 *   downloading_gw   → progress bar (Gateway)
 *   starting         → spinner
 *   provisioned      → "Start Gateway" button
 *   running          → green (authenticated) or amber (login required)
 *   stopping         → dimmed spinner
 *   error            → error text + retry button
 *
 * D1: Uses switch() instead of nested ternaries — easier to extend.
 * D4: Three colour states: green (authed), amber (running/login needed), red (error).
 * D5: actionError auto-clears after 5 s.
 */

import { openUrl } from "@tauri-apps/plugin-opener";
import { useGatewayContext } from "@/context/GatewayContext";
import type { GatewayState } from "@/lib/api";

// ── Progress bar ───────────────────────────────────────────────

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

// ── Status dot ────────────────────────────────────────────────
// D4: three states — green (authed), amber (running/not authed), red (error/off)

type DotColor = "green" | "amber" | "red";

function StatusDot({ color }: { color: DotColor }) {
  const clr =
    color === "green"
      ? "var(--clr-green)"
      : color === "amber"
        ? "var(--clr-orange)"
        : "var(--clr-red)";
  return (
    <span
      className="inline-block h-2 w-2 rounded-full"
      style={{ background: clr, boxShadow: `0 0 6px ${clr}` }}
    />
  );
}

// ── Spinner ────────────────────────────────────────────────────

function Spinner() {
  return (
    <span className="inline-block h-3 w-3 animate-spin rounded-full border border-[var(--clr-cyan)] border-t-transparent" />
  );
}

// ── Derive dot color from state ────────────────────────────────

function dotColor(
  state: GatewayState,
  isAuthenticated: boolean,
): DotColor {
  switch (state) {
    case "running":
      return isAuthenticated ? "green" : "amber";
    case "error":
      return "red";
    default:
      return "red";
  }
}

// ── Derive border/bg from state ────────────────────────────────

function cardStyle(
  state: GatewayState,
  isAuthenticated: boolean,
): React.CSSProperties {
  if (state === "running") {
    return isAuthenticated
      ? { borderColor: "var(--clr-green)", background: "var(--glow-green)" }
      : { borderColor: "var(--clr-orange)", background: "rgba(255,165,0,0.04)" };
  }
  return { borderColor: "var(--border)", background: "var(--bg-1)" };
}

// ── Main component ─────────────────────────────────────────────

export function GatewaySetup() {
  const {
    status,
    isAuthenticated,
    needsLogin,
    isProvisioning,
    sessionDropped,
    provision,
    start,
    resetSession,
    actionLoading,
  } = useGatewayContext();

  // Bug D: when a mid-session disconnect has triggered the IbkrReconnectBanner
  // above the nav, the "Open IBKR Login" button here becomes redundant — the
  // banner already has one, louder and more visible. Hide this card's button
  // in that case so the user only sees a single clear call to action.
  const bannerIsShowing = sessionDropped && !isAuthenticated;

  // NOTE: `actionError` is intentionally not rendered here. The backend sets
  // `gw.state = ERROR` + `error_message` before raising on every failure path
  // that produces a user-facing message (port in use, provisioning failure,
  // etc.), so the error already appears in `status.error` via the polled
  // status. Rendering `actionError` separately caused the same message to
  // show twice — once above the button (status.error) and once below
  // (actionError). See Phase 8 findings.

  if (!status) {
    return (
      <div className="rounded-lg border border-[var(--border)] p-4">
        <div className="text-[11px] text-[var(--text-3)]">
          Loading Gateway status...
        </div>
      </div>
    );
  }

  const state = status.state;

  // D1: single switch — header label
  const headerLabel = (() => {
    switch (state) {
      case "running":
        return isAuthenticated ? "authenticated" : "login required";
      case "downloading_jre":
        return "downloading JRE…";
      case "downloading_gw":
        return "downloading gateway…";
      case "starting":
        return "starting…";
      case "stopping":
        return "stopping…";
      case "provisioned":
        return "ready";
      case "error":
        return "error";
      default:
        return "not set up";
    }
  })();

  return (
    <div
      className="rounded-lg border p-4"
      style={cardStyle(state, isAuthenticated)}
    >
      {/* Header */}
      <div className="mb-3 flex items-center gap-2">
        {state === "starting" || state === "stopping" ? (
          <Spinner />
        ) : (
          <StatusDot color={dotColor(state, isAuthenticated)} />
        )}
        <span className="text-[12px] font-semibold text-foreground">
          IBKR Gateway
        </span>
        <span className="text-[10px] text-[var(--text-3)]">{headerLabel}</span>
      </div>

      {/* ── State bodies ── */}

      {/* not_provisioned */}
      {state === "not_provisioned" && (
        <div>
          <p className="mb-3 text-[11px] text-[var(--text-2)]">
            The IBKR Client Portal Gateway needs to be downloaded and set up.
            This is a one-time setup (~30–60 s).
          </p>
          <button
            className="cursor-pointer rounded-md px-3 py-1.5 text-[11px] font-medium text-[var(--bg-0)] disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: "var(--clr-cyan)" }}
            onClick={() => provision()}
            disabled={actionLoading}
          >
            {actionLoading ? "Setting up…" : "Set Up Gateway"}
          </button>
        </div>
      )}

      {/* D2: progress only shown during active download steps */}
      {isProvisioning && status.progress && (
        <ProgressBar
          percent={status.progress.percent}
          label={status.progress.step}
        />
      )}

      {/* provisioned — ready to start */}
      {state === "provisioned" && (
        <div>
          <p className="mb-3 text-[11px] text-[var(--text-2)]">
            Gateway is ready. Start it to connect to IBKR.
          </p>
          <button
            className="cursor-pointer rounded-md px-3 py-1.5 text-[11px] font-medium text-[var(--bg-0)] disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: "var(--clr-cyan)" }}
            onClick={start}
            disabled={actionLoading}
          >
            {actionLoading ? "Starting…" : "Start Gateway"}
          </button>
        </div>
      )}

      {/* running — show auth state */}
      {state === "running" && (
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
          {/* Login button — only shown when re-auth is required.
              Hidden when already authenticated because opening the gateway
              URL would just land on the login page again (the session cookie
              isn't shared with a freshly-opened browser tab).
              Tauri v2 blocks <a target="_blank"> inside the webview — we must
              call the opener plugin explicitly to open the URL in the user's
              default browser. */}
          {needsLogin && !bannerIsShowing && (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  if (status.gateway_url) {
                    openUrl(status.gateway_url).catch((err) => {
                      console.error("Failed to open gateway URL:", err);
                    });
                  }
                }}
                className="inline-block cursor-pointer rounded-md border px-3 py-1.5 text-[11px] font-medium transition-colors hover:bg-[var(--bg-2)]"
                style={{
                  borderColor: "var(--clr-orange)",
                  color: "var(--clr-orange)",
                }}
              >
                Open IBKR Login
              </button>
              {/* R2 — recover from a wedged session (client login succeeded but
                  UI never updated, dispatcher stopped downloading, etc.).
                  Acts immediately, no confirmation dialog: it just restarts
                  the gateway and clears in-memory state. Files on disk are
                  untouched — for that, see Factory Reset in Settings. */}
              <button
                type="button"
                onClick={resetSession}
                disabled={actionLoading}
                className="cursor-pointer text-[10px] text-[var(--text-3)] underline-offset-2 hover:text-[var(--text-1)] hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
                title="Restart the gateway and clear the in-memory session"
              >
                {actionLoading ? "Resetting…" : "Reset session"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* error */}
      {state === "error" && (
        <div>
          <p className="mb-2 text-[11px] text-[var(--clr-red)]">
            {status.error ?? "An unknown error occurred."}
          </p>
          <button
            className="cursor-pointer rounded-md px-3 py-1.5 text-[11px] font-medium text-[var(--bg-0)] disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: "var(--clr-orange)" }}
            onClick={() => provision(true)}
            disabled={actionLoading}
          >
            {actionLoading ? "Retrying…" : "Retry Setup"}
          </button>
        </div>
      )}

    </div>
  );
}
