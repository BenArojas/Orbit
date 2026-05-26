import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, BriefcaseBusiness, ClipboardList, PieChart } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MoonMarketAccount } from "./types";

type MoonMarketPage = "portfolio" | "transactions";

const NAV_ITEMS: { page: MoonMarketPage; label: string; path: string; icon: typeof PieChart }[] = [
  { page: "portfolio", label: "Portfolio", path: "/moonmarket/portfolio", icon: PieChart },
  { page: "transactions", label: "Transactions", path: "/moonmarket/transactions", icon: ClipboardList },
];

export function MoonMarketLayout({
  activePage,
  accounts,
  accountId,
  onAccountChange,
  children,
}: {
  activePage: MoonMarketPage;
  accounts: MoonMarketAccount[];
  accountId: string | null;
  onAccountChange: (accountId: string) => void;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const subtitle = activePage === "transactions" ? "Transactions ledger" : "Portfolio command deck";

  return (
    <div className="min-h-screen bg-[var(--bg-1)] text-foreground">
      <header className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="flex h-8 items-center gap-2 rounded-md border border-border px-2 text-[11px] text-[var(--text-2)] hover:border-[var(--clr-cyan)] hover:text-[var(--text-1)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.7} />
            Back to Orbit
          </button>
          <div className="flex min-w-0 items-center gap-2">
            <BriefcaseBusiness className="h-5 w-5 text-[var(--clr-cyan)]" strokeWidth={1.6} />
            <div>
              <h1 className="text-[15px] font-semibold">MoonMarket</h1>
              <p className="text-[10px] text-[var(--text-3)]">{subtitle}</p>
            </div>
          </div>
          <nav className="flex h-8 items-center gap-1 rounded-md border border-border bg-[var(--bg-2)] p-1">
            {NAV_ITEMS.map(({ page, label, path, icon: Icon }) => (
              <button
                key={page}
                type="button"
                aria-pressed={activePage === page}
                onClick={() => navigate(path)}
                className={cn(
                  "flex h-6 items-center gap-1.5 rounded px-2 text-[11px] font-medium transition-colors",
                  activePage === page
                    ? "bg-[var(--clr-cyan)]/15 text-[var(--clr-cyan)]"
                    : "text-[var(--text-3)] hover:bg-[var(--bg-3)] hover:text-[var(--text-1)]",
                )}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={1.7} />
                {label}
              </button>
            ))}
          </nav>
        </div>

        <select
          aria-label="Account"
          value={accountId ?? ""}
          onChange={(event) => onAccountChange(event.target.value)}
          disabled={!accounts.length}
          className="h-8 min-w-36 rounded-md border border-border bg-[var(--bg-2)] px-2 text-[11px] text-[var(--text-2)] outline-none disabled:opacity-50"
        >
          {accounts.map((account) => (
            <option key={account.account_id} value={account.account_id}>
              {account.label}
            </option>
          ))}
        </select>
      </header>
      {children}
    </div>
  );
}
