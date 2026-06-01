import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RuleModal } from "../RuleModal";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/api", () => ({
  api: {
    getWatchlists: vi.fn().mockResolvedValue([]),
    getRuleTemplates: vi.fn().mockResolvedValue([]),
    createTriggerRule: vi.fn(),
    updateTriggerRule: vi.fn(),
    createRuleTemplate: vi.fn(),
  },
}));

function wrap(children: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("RuleModal", () => {
  it("uses fixed-height scrollable modal content", async () => {
    render(wrap(<RuleModal />));

    fireEvent.click(screen.getByRole("button", { name: /add rule/i }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog.className).toContain("max-h-[min(760px,calc(100vh-2rem))]");
    expect(screen.getByTestId("rule-modal-scroll")).toHaveClass("overflow-y-auto");
  });

  it("explains rule inputs in plain English", async () => {
    render(wrap(<RuleModal />));

    fireEvent.click(screen.getByRole("button", { name: /add rule/i }));
    fireEvent.click(await screen.findByRole("button", { name: /rule help/i }));

    await waitFor(() => {
      expect(screen.getByText(/choose one stock or a whole watchlist/i)).toBeInTheDocument();
      expect(screen.getByText(/price above ema 200/i)).toBeInTheDocument();
      expect(screen.getByText(/volume is 50% higher than normal/i)).toBeInTheDocument();
      expect(screen.getByText(/also add hits to an ibkr watchlist/i)).toBeInTheDocument();
    });
  });
});
