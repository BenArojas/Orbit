import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const navigate = vi.fn();
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));

let authed = false;
vi.mock("@/context/GatewayContext", () => ({
  useGatewayContext: () => ({ isAuthenticated: authed }),
}));

vi.mock("@/pages/ConnectionPage", () => ({
  default: () => <div data-testid="connection-page" />,
}));

import { OrbitLauncher } from "@/orbit/OrbitLauncher";

describe("OrbitLauncher", () => {
  beforeEach(() => {
    navigate.mockClear();
    authed = false;
  });

  it("disables Parallax and MoonMarket icons when unauthenticated", () => {
    render(<OrbitLauncher />);
    expect(screen.getByRole("button", { name: /parallax/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /moonmarket/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /inflect/i })).toBeDisabled();
    expect(screen.getByTestId("connection-page")).toBeInTheDocument();
  });

  it("enables Parallax/MoonMarket and navigates on click when authenticated", () => {
    authed = true;
    render(<OrbitLauncher />);
    const parallax = screen.getByRole("button", { name: /parallax/i });
    expect(parallax).not.toBeDisabled();
    fireEvent.click(parallax);
    expect(navigate).toHaveBeenCalledWith("/parallax");

    fireEvent.click(screen.getByRole("button", { name: /moonmarket/i }));
    expect(navigate).toHaveBeenCalledWith("/moonmarket");
  });

  it("keeps Inflect disabled even when authenticated (coming soon)", () => {
    authed = true;
    render(<OrbitLauncher />);
    expect(screen.getByRole("button", { name: /inflect/i })).toBeDisabled();
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  });
});
