import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { orbitRoutes } from "@/orbit/OrbitShell";

let isAuthenticated = false;

vi.mock("@/context/GatewayContext", () => ({
  useGatewayContext: () => ({ isAuthenticated }),
}));

vi.mock("@/orbit/OrbitLauncher", () => ({
  OrbitLauncher: () => <div data-testid="launcher" />,
}));

vi.mock("@/components/gateway/GatewaySetup", () => ({
  GatewaySetup: () => <div data-testid="gateway-setup" />,
}));

vi.mock("@/modules/parallax/ParallaxModule", () => ({
  ParallaxModule: () => <div data-testid="parallax" />,
}));

vi.mock("@/modules/moonmarket/MoonMarketModule", () => ({
  MoonMarketModule: () => <div data-testid="moonmarket" />,
}));

function renderAt(path: string) {
  const router = createMemoryRouter(orbitRoutes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
}

describe("orbitRoutes", () => {
  it("renders the launcher at /", () => {
    renderAt("/");
    expect(screen.getByTestId("launcher")).toBeInTheDocument();
  });

  it("keeps /moonmarket locked in place while unauthenticated", () => {
    isAuthenticated = false;
    renderAt("/moonmarket");
    expect(screen.getByText("MoonMarket is locked")).toBeInTheDocument();
    expect(screen.queryByTestId("moonmarket")).not.toBeInTheDocument();
  });

  it("renders MoonMarket at /moonmarket once authenticated", () => {
    isAuthenticated = true;
    renderAt("/moonmarket");
    expect(screen.getByTestId("moonmarket")).toBeInTheDocument();
  });

  it("renders Parallax at /parallax once authenticated", () => {
    isAuthenticated = true;
    renderAt("/parallax");
    expect(screen.getByTestId("parallax")).toBeInTheDocument();
  });
});
