import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAccountStore } from "@/orbit/OrderTicket/useAccountStore";
import { useInflectStore } from "@/store/inflect";
import { useInflectSync } from "@/hooks/useInflectSync";
import { InflectLayout } from "./InflectLayout";
import { CalendarPage } from "./CalendarPage";
import { TradesPage } from "./TradesPage";

export function InflectModule() {
  const page = useInflectStore((state) => state.page);
  const setPage = useInflectStore((state) => state.setPage);

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

  const sync = useInflectSync(accountId ?? undefined);

  return (
    <InflectLayout
      activePage={page}
      onPageChange={setPage}
      accounts={accounts}
      accountId={accountId}
      onAccountChange={setSelectedAccountId}
      onSync={() => sync.mutate(undefined)}
      syncing={sync.isPending}
    >
      {accountError ? (
        <div
          role="alert"
          className="mx-4 mt-4 rounded-md border border-[var(--clr-red)]/50 bg-[var(--clr-red)]/10 p-3 text-[12px] text-[var(--clr-red)]"
        >
          Inflect account data is unavailable.
        </div>
      ) : null}
      {page === "trades" ? (
        <TradesPage accountId={accountId} />
      ) : (
        <CalendarPage accountId={accountId} />
      )}
    </InflectLayout>
  );
}
