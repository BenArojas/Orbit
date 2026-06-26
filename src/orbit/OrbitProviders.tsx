/**
 * OrbitProviders — app-wide context providers, hoisted above the router so
 * every module (and the launcher itself) shares one QueryClient, one IBKR
 * gateway/session context, and one toast layer.
 */
import { useEffect, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/query";
import { GatewayProvider } from "@/context/GatewayContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/Toaster";
import { OrbitAccountProvider } from "@/orbit/accountContext";
import { OrderTicket } from "@/orbit/OrderTicket";
import { useSettingsStore } from "@/store";
import { BrokerSessionProvider } from "@/context/BrokerSessionContext";

function OrbitSettingsEffects() {
  const loadSettings = useSettingsStore((state) => state.loadSettings);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  return null;
}

export function OrbitProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <GatewayProvider>
        <BrokerSessionProvider>
          <TooltipProvider>
            <OrbitAccountProvider>
              <OrbitSettingsEffects />
              {children}
              <OrderTicket />
              <Toaster />
            </OrbitAccountProvider>
          </TooltipProvider>
        </BrokerSessionProvider>
      </GatewayProvider>
    </QueryClientProvider>
  );
}
