import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { BriefcaseBusiness, ClipboardList, ListTree, PieChart } from "lucide-react";
import { BackToOrbitButton } from "@/components/ui/BackToOrbitButton";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { useOrbitAccountContext } from "@/orbit/accountContext";
import { cn } from "@/lib/utils";

type MoonMarketPage = "portfolio" | "transactions" | "options";

const NAV_ITEMS: { page: MoonMarketPage; label: string; path: string; icon: typeof PieChart }[] = [
  { page: "portfolio", label: "Portfolio", path: "/moonmarket/portfolio", icon: PieChart },
  { page: "transactions", label: "Transactions", path: "/moonmarket/transactions", icon: ClipboardList },
  { page: "options", label: "Options", path: "/moonmarket/options", icon: ListTree },
];

export function MoonMarketLayout({
  activePage,
  children,
}: {
  activePage: MoonMarketPage;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const { accounts, selectedAccountId, setSelectedAccountId } = useOrbitAccountContext();
  const subtitle =
    activePage === "transactions"
      ? "Transactions ledger"
      : activePage === "options"
        ? "Options chain"
        : "Portfolio command deck";

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[var(--bg-1)] text-foreground">
      <header className="flex min-h-14 shrink-0 items-center gap-4 border-b border-border px-4 py-2">
        <BackToOrbitButton />
        <div className="flex min-w-0 items-center gap-2">
          <BriefcaseBusiness className="h-5 w-5 text-[var(--clr-cyan)]" strokeWidth={1.6} />
          <div>
            <h1 className="text-[15px] font-semibold">MoonMarket</h1>
            <p className="text-[10px] text-[var(--text-3)]">{subtitle}</p>
          </div>
        </div>

        <nav className="mx-auto flex h-8 items-center gap-1 rounded-md border border-border bg-[var(--bg-2)] p-1">
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

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <select
            aria-label="Account"
            value={selectedAccountId ?? ""}
            onChange={(event) => setSelectedAccountId(event.target.value)}
            disabled={!accounts.length}
            className="h-8 min-w-36 rounded-md border border-border bg-[var(--bg-2)] px-2 text-[11px] text-[var(--text-2)] outline-none disabled:opacity-50"
          >
            {accounts.map((account) => (
              <option key={account.account_id} value={account.account_id}>
                {account.label}
              </option>
            ))}
          </select>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
