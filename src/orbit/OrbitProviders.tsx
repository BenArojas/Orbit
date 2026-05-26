/**
 * OrbitProviders — app-wide context providers, hoisted above the router so
 * every module (and the launcher itself) shares one QueryClient, one IBKR
 * gateway/session context, and one toast layer.
 */
import { type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/query";
import { GatewayProvider } from "@/context/GatewayContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/Toaster";
import { OrderTicket } from "@/orbit/OrderTicket";

export function OrbitProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <GatewayProvider>
        <TooltipProvider>
          {children}
          <OrderTicket />
          <Toaster />
        </TooltipProvider>
      </GatewayProvider>
    </QueryClientProvider>
  );
}
