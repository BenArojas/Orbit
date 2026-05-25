/**
 * MoonMarketModule — stub mounted under /moonmarket/*. Real pages (Portfolio,
 * Transactions, shared OrderTicket) are ported in later plans. For the
 * foundation it proves the route mounts and can return to Orbit.
 */
import { useNavigate } from "react-router-dom";
import { Briefcase } from "lucide-react";

export function MoonMarketModule() {
  const navigate = useNavigate();

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 bg-[var(--bg-1)] text-foreground">
      <Briefcase className="h-12 w-12 text-[var(--text-3)]" strokeWidth={1.5} />
      <h1 className="text-lg font-semibold">MoonMarket</h1>
      <p className="text-[12px] text-[var(--text-3)]">
        Portfolio and trading are being ported here.
      </p>
      <button
        type="button"
        onClick={() => navigate("/")}
        className="rounded-md border border-border px-3 py-1 text-[11px] text-[var(--text-2)] hover:border-[var(--clr-cyan)]"
      >
        Back to Orbit
      </button>
    </div>
  );
}
