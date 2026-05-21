import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { AuthGuard } from "../AuthGuard";
import { useNavigationStore } from "@/store/navigation";

vi.mock("@/hooks/useGateway", () => ({
  useGateway: vi.fn(),
}));

import { useGateway } from "@/hooks/useGateway";

const setup = (gateway: Partial<ReturnType<typeof useGateway>>) => {
  (useGateway as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    isAuthenticated: false,
    isLoading: false,
    ...gateway,
  });
};

describe("AuthGuard", () => {
  beforeEach(() => {
    useNavigationStore.setState({
      activeScreen: "today",
      previousAuthenticatedTab: "today",
    });
  });

  it("renders a spinner while gateway status is loading", () => {
    setup({ isAuthenticated: false, isLoading: true });
    render(<AuthGuard><div>protected</div></AuthGuard>);
    expect(screen.getByRole("status", { name: /loading/i })).toBeInTheDocument();
    expect(screen.queryByText("protected")).not.toBeInTheDocument();
  });

  it("forces activeScreen to 'connection' when unauthenticated", () => {
    setup({ isAuthenticated: false, isLoading: false });
    render(<AuthGuard><div>protected</div></AuthGuard>);
    expect(useNavigationStore.getState().activeScreen).toBe("connection");
  });

  it("restores previousAuthenticatedTab when re-authenticating from connection", () => {
    useNavigationStore.setState({
      activeScreen: "connection",
      previousAuthenticatedTab: "screener",
    });
    setup({ isAuthenticated: true, isLoading: false });
    render(<AuthGuard><div>protected</div></AuthGuard>);
    expect(useNavigationStore.getState().activeScreen).toBe("screener");
  });

  it("renders children when authenticated and not on connection", () => {
    setup({ isAuthenticated: true, isLoading: false });
    useNavigationStore.setState({ activeScreen: "today" });
    render(<AuthGuard><div>protected</div></AuthGuard>);
    expect(screen.getByText("protected")).toBeInTheDocument();
  });
});
