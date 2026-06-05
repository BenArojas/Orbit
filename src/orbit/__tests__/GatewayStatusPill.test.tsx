import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

let ctx: { status: { state: string } | null; isAuthenticated: boolean; needsLogin: boolean };
vi.mock("@/context/GatewayContext", () => ({
  useGatewayContext: () => ctx,
}));

vi.mock("@/components/gateway/GatewaySetup", () => ({
  GatewaySetup: () => <div data-testid="gateway-setup" />,
}));

import { GatewayStatusPill } from "@/orbit/GatewayStatusPill";

describe("GatewayStatusPill", () => {
  beforeEach(() => {
    ctx = { status: null, isAuthenticated: false, needsLogin: false };
  });

  it("shows green 'connected' and starts closed when authenticated", () => {
    ctx = { status: { state: "running" }, isAuthenticated: true, needsLogin: false };
    render(<GatewayStatusPill />);
    expect(screen.getByText(/connected/i)).toBeInTheDocument();
    expect(screen.queryByTestId("gateway-setup")).not.toBeInTheDocument();
  });

  it("auto-opens the popover (GatewaySetup) when unauthenticated", () => {
    ctx = { status: { state: "not_provisioned" }, isAuthenticated: false, needsLogin: false };
    render(<GatewayStatusPill />);
    expect(screen.getByText(/set up/i)).toBeInTheDocument();
    expect(screen.getByTestId("gateway-setup")).toBeInTheDocument();
  });

  it("shows amber 'login required' when running but not authenticated", () => {
    ctx = { status: { state: "running" }, isAuthenticated: false, needsLogin: true };
    render(<GatewayStatusPill />);
    expect(screen.getByText(/login required/i)).toBeInTheDocument();
  });

  it("toggles the popover when the pill is clicked", () => {
    ctx = { status: { state: "running" }, isAuthenticated: true, needsLogin: false };
    render(<GatewayStatusPill />);
    expect(screen.queryByTestId("gateway-setup")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /ibkr/i }));
    expect(screen.getByTestId("gateway-setup")).toBeInTheDocument();
  });
});
