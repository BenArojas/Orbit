import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Activity, Briefcase, NotebookPen } from "lucide-react";

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

vi.mock("@/orbit/moduleEntry", () => ({
  orbitModules: {
    parallax: {
      id: "parallax",
      label: "Charts",
      description: "Signal workbench",
      path: "/charts",
      icon: Activity,
      requiresAuth: true,
      render: vi.fn(),
    },
    moonmarket: {
      id: "moonmarket",
      label: "Portfolio",
      description: "Capital view",
      path: "/portfolio",
      icon: Briefcase,
      requiresAuth: true,
      render: vi.fn(),
    },
    inflect: {
      id: "inflect",
      label: "Journal",
      description: "Trade notes",
      path: "/journal",
      icon: NotebookPen,
      requiresAuth: true,
      render: vi.fn(),
    },
  },
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
    expect(screen.getByRole("button", { name: /charts/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /portfolio/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /journal/i })).toBeDisabled();
    expect(screen.getByText("Signal workbench")).toBeInTheDocument();
    expect(screen.getByText("Capital view")).toBeInTheDocument();
    expect(screen.getByText("Trade notes")).toBeInTheDocument();
  });

  it("enables all three tiles and navigates using module registry paths when authenticated", () => {
    authed = true;
    render(<OrbitLauncher />);
    fireEvent.click(screen.getByRole("button", { name: /charts/i }));
    expect(navigate).toHaveBeenCalledWith("/charts");
    fireEvent.click(screen.getByRole("button", { name: /portfolio/i }));
    expect(navigate).toHaveBeenCalledWith("/portfolio");
    fireEvent.click(screen.getByRole("button", { name: /journal/i }));
    expect(navigate).toHaveBeenCalledWith("/journal");
  });
});
