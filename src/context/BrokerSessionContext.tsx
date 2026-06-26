/**
 * BrokerSessionContext — single source of truth for the Orbit broker session mode.
 *
 * Exposes none | client_portal | tws and which modules are available so the
 * launcher and route guards share one mode decision without prop-drilling.
 * Polls GET /orbit/session/mode every 5 s; mode changes are infrequent.
 */

import { createContext, useContext, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  twsApi,
  type BrokerSessionMode,
  type BrokerSessionSwitchTarget,
} from "@/modules/tws-execution-assistant/api";

export const BROKER_SESSION_KEY = ["broker-session-mode"] as const;

interface BrokerSessionContextValue {
  mode: BrokerSessionMode;
  availableModules: string[];
  isModuleAvailable: (moduleId: string) => boolean;
  setMode: (target: BrokerSessionSwitchTarget) => void;
}

const BrokerSessionContext = createContext<BrokerSessionContextValue | null>(null);

export function BrokerSessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: BROKER_SESSION_KEY,
    queryFn: twsApi.getMode,
    refetchInterval: 5000,
    staleTime: 2000,
  });

  const mutation = useMutation({
    mutationFn: twsApi.setMode,
    onSuccess: (result) => {
      queryClient.setQueryData(BROKER_SESSION_KEY, result);
    },
  });

  const mode = data?.mode ?? "none";
  const availableModules = data?.available_modules ?? [];

  return (
    <BrokerSessionContext.Provider
      value={{
        mode,
        availableModules,
        isModuleAvailable: (moduleId) => availableModules.includes(moduleId),
        setMode: (m) => mutation.mutate(m),
      }}
    >
      {children}
    </BrokerSessionContext.Provider>
  );
}

export function useBrokerSession(): BrokerSessionContextValue {
  const ctx = useContext(BrokerSessionContext);
  if (!ctx) {
    throw new Error("useBrokerSession must be used inside <BrokerSessionProvider>");
  }
  return ctx;
}
