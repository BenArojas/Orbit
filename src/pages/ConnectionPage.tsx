import { GatewaySetup } from "@/components/gateway/GatewaySetup";

export default function ConnectionPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 bg-[var(--bg-1)] px-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">
          Connect to IBKR
        </h1>
        <p className="mt-2 max-w-md text-sm text-[var(--text-3)]">
          Parallax routes all market data through your local IBKR Client Portal Gateway.
          Sign in below to start trading.
        </p>
      </div>
      <div className="w-full max-w-xl rounded-lg border border-border bg-[var(--bg-2)] p-6">
        <GatewaySetup />
      </div>
    </div>
  );
}
