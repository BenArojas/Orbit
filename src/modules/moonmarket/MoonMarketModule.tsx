import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { MoonMarketLayout } from "./MoonMarketLayout";
import { PortfolioPage } from "./PortfolioPage";
import { TransactionsPage } from "./TransactionsPage";

function activePageFromPath(pathname: string): "portfolio" | "transactions" {
  return pathname.startsWith("/moonmarket/transactions") ? "transactions" : "portfolio";
}

export function MoonMarketModule() {
  const location = useLocation();
  const activePage = activePageFromPath(location.pathname);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

  const accountsQuery = useQuery({
    queryKey: ["moonmarket", "accounts"],
    queryFn: ({ signal }) => api.moonmarketAccounts(signal),
  });

  const defaultAccountId = useMemo(() => {
    const data = accountsQuery.data;
    return data?.selected_account_id ?? data?.accounts[0]?.account_id ?? null;
  }, [accountsQuery.data]);

  useEffect(() => {
    if (!selectedAccountId && defaultAccountId) {
      setSelectedAccountId(defaultAccountId);
    }
  }, [defaultAccountId, selectedAccountId]);

  const accountId = selectedAccountId ?? defaultAccountId;
  const accounts = accountsQuery.data?.accounts ?? [];

  return (
    <MoonMarketLayout
      activePage={activePage}
      accounts={accounts}
      accountId={accountId}
      onAccountChange={setSelectedAccountId}
    >
      {activePage === "transactions" ? (
        <TransactionsPage accountId={accountId} />
      ) : (
        <PortfolioPage accountId={accountId} accountsLoading={accountsQuery.isLoading} />
      )}
    </MoonMarketLayout>
  );
}
