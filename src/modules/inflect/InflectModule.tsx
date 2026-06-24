import { useEffect } from "react";
import { useOrbitAccountContext } from "@/orbit/accountContext";
import { useInflectStore } from "@/store/inflect";
import { useInflectSync } from "@/hooks/useInflectSync";
import { InflectLayout } from "./InflectLayout";
import { CalendarPage } from "./CalendarPage";
import { TradesPage } from "./TradesPage";

const autoSyncedAccounts = new Set<string>();

export function InflectModule() {
  const page = useInflectStore((state) => state.page);
  const setPage = useInflectStore((state) => state.setPage);

  const {
    selectedAccountId: accountId,
    isLoading: accountsLoading,
    error: accountError,
  } = useOrbitAccountContext();

  const sync = useInflectSync(accountId ?? undefined);

  useEffect(() => {
    if (!accountId || accountsLoading || accountError || autoSyncedAccounts.has(accountId)) {
      return;
    }
    autoSyncedAccounts.add(accountId);
    sync.mutate(undefined);
  }, [accountError, accountId, accountsLoading, sync]);

  return (
    <InflectLayout
      activePage={page}
      onPageChange={setPage}
      onSync={() => sync.mutate(undefined)}
      syncing={sync.isPending}
    >
      {accountsLoading ? (
        <div
          role="status"
          aria-label="Loading Inflect"
          className="mx-4 mt-4 min-h-[220px] animate-pulse rounded-md border border-border bg-[var(--bg-2)]"
        />
      ) : accountError ? (
        <div
          role="alert"
          className="mx-4 mt-4 rounded-md border border-[var(--clr-red)]/50 bg-[var(--clr-red)]/10 p-3 text-[12px] text-[var(--clr-red)]"
        >
          Inflect account data is unavailable.
        </div>
      ) : page === "trades" ? (
        <TradesPage accountId={accountId} />
      ) : (
        <CalendarPage accountId={accountId} />
      )}
    </InflectLayout>
  );
}
