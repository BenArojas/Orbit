import { useEffect, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { useGateway } from "@/hooks/useGateway";
import { useNavigationStore } from "@/store/navigation";

interface Props {
  children: ReactNode;
}

/**
 * Gates rendering on IBKR auth state.
 * - Loading first auth probe -> spinner
 * - Unauthenticated -> force activeScreen='connection'
 * - Authenticated and stuck on 'connection' -> restore previousAuthenticatedTab
 */
export function AuthGuard({ children }: Props) {
  const { isAuthenticated, isLoading } = useGateway();
  const activeScreen = useNavigationStore((s) => s.activeScreen);
  const previousAuthenticatedTab = useNavigationStore(
    (s) => s.previousAuthenticatedTab,
  );

  // This effect mutates store state it depends on. That's intentional: the
  // guards become false after the first write, so subsequent runs no-op.
  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated && activeScreen !== "connection") {
      useNavigationStore.setState({ activeScreen: "connection" });
    } else if (isAuthenticated && activeScreen === "connection") {
      const restore =
        previousAuthenticatedTab === "connection"
          ? "today"
          : previousAuthenticatedTab;
      useNavigationStore.setState({ activeScreen: restore });
    }
  }, [isAuthenticated, isLoading, activeScreen, previousAuthenticatedTab]);

  if (isLoading) {
    return (
      <div
        role="status"
        aria-label="loading"
        className="flex h-screen items-center justify-center bg-[var(--bg-1)]"
      >
        <Loader2 className="h-8 w-8 animate-spin text-[var(--text-3)]" />
      </div>
    );
  }

  return <>{children}</>;
}
