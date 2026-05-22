import { GatewaySetup } from "@/components/gateway/GatewaySetup";

/**
 * Connection front-page — the only screen shown while unauthenticated.
 *
 * Branded landing rather than a transplanted dashboard widget: the brand
 * mark + value line set the tone, and the gateway card carries the actual
 * connect flow. The Logout affordance is suppressed here (hideLogout) —
 * there's no session to drop pre-auth; Logout lives in the navbar once in.
 */
export default function ConnectionPage() {
  return (
    <div className="relative flex h-screen flex-col items-center justify-center overflow-hidden bg-[var(--bg-0)] px-6">
      {/* Ambient cyan glow behind the card */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-[0.07] blur-3xl"
        style={{ background: "var(--clr-cyan)" }}
      />

      <div className="relative z-10 flex w-full max-w-md flex-col items-center">
        {/* Brand */}
        <span className="text-[26px] font-extrabold tracking-[6px] text-gradient-brand">
          PARALLAX
        </span>
        <p className="mt-3 text-center text-[13px] leading-relaxed text-[var(--text-3)]">
          Scan, analyse, and track setups — all local, all yours.
          <br />
          Connect your IBKR Client Portal Gateway to begin.
        </p>

        {/* Gateway card */}
        <div className="mt-8 w-full rounded-xl border border-border bg-[var(--bg-2)]/80 p-5 shadow-[0_0_40px_rgba(0,0,0,0.35)] backdrop-blur">
          <GatewaySetup hideLogout />
        </div>

        <p className="mt-5 text-center text-[10px] text-[var(--text-3)] opacity-70">
          Data never leaves this machine. No cloud, no subscription.
        </p>
      </div>
    </div>
  );
}
