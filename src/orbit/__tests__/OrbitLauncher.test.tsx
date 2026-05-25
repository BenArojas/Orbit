import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const navigate = vi.fn();
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));

let authed = false;
vi.mock("@/context/GatewayContext", () => ({
  useGatewayContext: () => ({ isAuthenticated: authed }),
}));

// The pill is tested separately; stub it here so this test stays focused on
// the launcher's gating + navigation.
vi.mock("@/orbit/GatewayStatusPill", () => ({
  GatewayStatusPill: () => <div data-testid="gateway-status-pill" />,
}));

import { OrbitLauncher } from "@/orbit/OrbitLauncher";

describe("OrbitLauncher", () => {
  beforeEach(() => {
    navigate.mockClear();
    authed = false;
  });

  it("renders the status pill and disables app tiles when unauthenticated", () => {
    render(<OrbitLauncher />);
    expect(screen.getByTestId("gateway-status-pill")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /parallax/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /moonmarket/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /inflect/i })).toBeDisabled();
  });

  it("enables Parallax/MoonMarket and navigates on click when authenticated", () => {
    authed = true;
    render(<OrbitLauncher />);
    fireEvent.click(screen.getByRole("button", { name: /parallax/i }));
    expect(navigate).toHaveBeenCalledWith("/parallax");
    fireEvent.click(screen.getByRole("button", { name: /moonmarket/i }));
    expect(navigate).toHaveBeenCalledWith("/moonmarket");
  });

  it("keeps Inflect disabled with a Soon badge even when authenticated", () => {
    authed = true;
    render(<OrbitLauncher />);
    expect(screen.getByRole("button", { name: /inflect/i })).toBeDisabled();
    expect(screen.getByText(/soon/i)).toBeInTheDocument();
  });
});
