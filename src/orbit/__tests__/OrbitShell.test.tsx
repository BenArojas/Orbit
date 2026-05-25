import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { orbitRoutes } from "@/orbit/OrbitShell";

vi.mock("@/orbit/OrbitLauncher", () => ({
  OrbitLauncher: () => <div data-testid="launcher" />,
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

  it("renders Parallax at /parallax", () => {
    renderAt("/parallax");
    expect(screen.getByTestId("parallax")).toBeInTheDocument();
  });

  it("renders MoonMarket at /moonmarket", () => {
    renderAt("/moonmarket");
    expect(screen.getByTestId("moonmarket")).toBeInTheDocument();
  });
});
