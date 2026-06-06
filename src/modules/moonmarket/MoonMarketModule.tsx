import { useLocation } from "react-router-dom";
import { useOrbitAccountContext } from "@/orbit/accountContext";
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
  const {
    selectedAccountId: accountId,
    isLoading: accountsLoading,
    error: accountError,
  } = useOrbitAccountContext();

  return (
    <MoonMarketLayout
      activePage={activePage}
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
        <PortfolioPage accountId={accountId} accountsLoading={accountsLoading} />
      )}
    </MoonMarketLayout>
  );
}
