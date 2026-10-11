import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { useIbkrReady } from "@/context/GatewayContext";
import { moonmarketApi, type MoonMarketAccount, type MoonMarketAccountsResponse } from "@/modules/moonmarket/api";
import { useAccountStore } from "./useAccountStore";

export type OrbitAccountMode = "paper" | "live" | "unknown";
export type OrbitAccountReadyState = "idle" | "loading" | "ready" | "empty" | "error";

type OrbitAccountContextValue = {
  accounts: MoonMarketAccount[];
  selectedAccountId: string | null;
  providerSelectedAccountId: string | null;
  providerSelectedAccountMode: OrbitAccountMode;
  providerScopeLoading: boolean;
  providerScopeError: boolean;
  selectedAccount: MoonMarketAccount | null;
  accountMode: OrbitAccountMode;
  isPaperAccount: boolean;
  isLiveAccount: boolean;
  isLoading: boolean;
  isReady: boolean;
  readyState: OrbitAccountReadyState;
  error: Error | null;
  setSelectedAccountId: (accountId: string | null) => void;
  refetchAccounts: () => Promise<MoonMarketAccountsResponse | undefined>;
};

const OrbitAccountContext = createContext<OrbitAccountContextValue | null>(null);

type OrbitAccountProviderProps = {
  children: ReactNode;
  enabled?: boolean;
};

export function OrbitAccountProvider({ children, enabled }: OrbitAccountProviderProps) {
  const ibkrReady = useIbkrReady();
  const queryEnabled = enabled ?? ibkrReady;

  const accounts = useAccountStore((state) => state.accounts);
  const selectedAccountId = useAccountStore((state) => state.selectedAccountId);
  const selectedAccount = useAccountStore((state) => state.selectedAccount());
  const setAccounts = useAccountStore((state) => state.setAccounts);
  const setSelectedAccountId = useAccountStore((state) => state.setSelectedAccountId);

  const accountsQuery = useQuery({
    queryKey: ["orbit", "accounts"],
    queryFn: ({ signal }) => moonmarketApi.moonmarketAccounts(signal),
    enabled: queryEnabled,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (accountsQuery.data) {
      setAccounts(accountsQuery.data.accounts, accountsQuery.data.selected_account_id);
    }
  }, [accountsQuery.data, setAccounts]);

  const accountMode: OrbitAccountMode = selectedAccount
    ? selectedAccount.is_paper
      ? "paper"
      : "live"
    : "unknown";

  const hasSelectedAccount = selectedAccount !== null;
  const providerSelectedAccountId = accountsQuery.data?.selected_account_id ?? null;
  const providerSelectedAccount = accountsQuery.data?.accounts.find(
    (account) => account.account_id === providerSelectedAccountId,
  ) ?? null;
  const providerSelectedAccountMode: OrbitAccountMode = providerSelectedAccount
    ? providerSelectedAccount.is_paper ? "paper" : "live"
    : "unknown";
  const providerScopeLoading = queryEnabled && accountsQuery.isLoading;
  const providerScopeError = queryEnabled && accountsQuery.isError;
  const isLoading = !hasSelectedAccount && queryEnabled && accountsQuery.isLoading;
  const error = accountsQuery.error instanceof Error ? accountsQuery.error : null;
  const isReady = hasSelectedAccount;
  const readyState: OrbitAccountReadyState = hasSelectedAccount
    ? "ready"
    : !queryEnabled
      ? "idle"
      : accountsQuery.isLoading
      ? "loading"
      : accountsQuery.isError
        ? "error"
        : "empty";
  const refetchAccounts = useCallback(
    async () => {
      const result = await accountsQuery.refetch();
      if (result.isError) throw result.error;
      return result.data;
    },
    [accountsQuery.refetch],
  );

  const value = useMemo<OrbitAccountContextValue>(
    () => ({
      accounts,
      selectedAccountId,
      providerSelectedAccountId,
      providerSelectedAccountMode,
      providerScopeLoading,
      providerScopeError,
      selectedAccount,
      accountMode,
      isPaperAccount: accountMode === "paper",
      isLiveAccount: accountMode === "live",
      isLoading,
      isReady,
      readyState,
      error,
      setSelectedAccountId,
      refetchAccounts,
    }),
    [
      accountMode,
      accounts,
      error,
      isLoading,
      isReady,
      providerScopeError,
      providerScopeLoading,
      providerSelectedAccountId,
      providerSelectedAccountMode,
      refetchAccounts,
      readyState,
      selectedAccount,
      selectedAccountId,
      setSelectedAccountId,
    ],
  );

  return (
    <OrbitAccountContext.Provider value={value}>
      {children}
    </OrbitAccountContext.Provider>
  );
}

export function useOrbitAccountContext(): OrbitAccountContextValue {
  const context = useContext(OrbitAccountContext);
  if (!context) {
    throw new Error("useOrbitAccountContext must be used inside <OrbitAccountProvider>");
  }
  return context;
}
