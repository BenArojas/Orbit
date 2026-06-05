import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAccountStore } from "@/orbit/OrderTicket/useAccountStore";
import { MoonMarketLayout } from "./MoonMarketLayout";
import { OptionsChainPage } from "./options/OptionsChainPage";
import { PortfolioPage } from "./PortfolioPage";
import { TransactionsPage } from "./TransactionsPage";

type MoonMarketPage = "portfolio" | "transactions" | "options";

function activePageFromPath(pathname: string): MoonMarketPage {
  if (pathname.startsWith("/moonmarket/transactions")) return "transactions";
  if (pathname.startsWith("/moonmarket/options")) return "options";
  return "portfolio";
}

export function MoonMarketModule() {
  const location = useLocation();
  const activePage = activePageFromPath(location.pathname);
  const selectedAccountId = useAccountStore((state) => state.selectedAccountId);
  const setAccounts = useAccountStore((state) => state.setAccounts);
  const setSelectedAccountId = useAccountStore((state) => state.setSelectedAccountId);

  const accountsQuery = useQuery({
    queryKey: ["moonmarket", "accounts"],
    queryFn: ({ signal }) => api.moonmarketAccounts(signal),
  });

  useEffect(() => {
    if (accountsQuery.data) {
      setAccounts(accountsQuery.data.accounts, accountsQuery.data.selected_account_id);
    }
  }, [accountsQuery.data, setAccounts]);

  const accountId = selectedAccountId;
  const accounts = accountsQuery.data?.accounts ?? [];
  const accountError = accountsQuery.error;

  return (
    <MoonMarketLayout
      activePage={activePage}
      accounts={accounts}
      accountId={accountId}
      onAccountChange={setSelectedAccountId}
    >
      {accountError ? (
        <div
          role="alert"
          className="mx-4 mt-4 rounded-md border border-[var(--clr-red)]/50 bg-[var(--clr-red)]/10 p-3 text-[12px] text-[var(--clr-red)]"
        >
          MoonMarket account data is unavailable.
        </div>
      ) : null}
      {activePage === "options" ? (
        <OptionsChainPage />
      ) : activePage === "transactions" ? (
        <TransactionsPage accountId={accountId} />
      ) : (
        <PortfolioPage accountId={accountId} accountsLoading={accountsQuery.isLoading} />
      )}
    </MoonMarketLayout>
  );
}
