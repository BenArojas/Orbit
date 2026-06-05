import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TemplatePicker } from "../TemplatePicker";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: {
    getRuleTemplates: vi.fn().mockResolvedValue([
      {
        id: 1,
        name: "Golden Pocket Bounce",
        description: "fib",
        category: "fibonacci",
        is_builtin: true,
        default_timeframe: "1D",
        conditions: [
          { indicator: "rsi", condition: "below", threshold: 35, news_candle_method: null },
        ],
        created_at: "2026-05-20",
      },
      {
        id: 2,
        name: "My Pullback",
        description: "custom",
        category: "custom",
        is_builtin: false,
        default_timeframe: "1D",
        conditions: [
          { indicator: "ema_21", condition: "below", threshold: 0, news_candle_method: null },
        ],
        created_at: "2026-05-21",
      },
    ]),
    deleteRuleTemplate: vi.fn().mockResolvedValue(undefined),
  },
}));

function wrap(children: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("TemplatePicker", () => {
  it("expands and lists fetched templates, calling onPick on click", async () => {
    const onPick = vi.fn();
    render(wrap(<TemplatePicker onPick={onPick} />));

    // Expand the collapsible header
    fireEvent.click(screen.getByText(/start from a template/i));

    await waitFor(() =>
      expect(screen.getByText("Golden Pocket Bounce")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByText("Golden Pocket Bounce"));

    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 1,
        name: "Golden Pocket Bounce",
        default_timeframe: "1D",
        conditions: expect.arrayContaining([
          expect.objectContaining({ indicator: "rsi", condition: "below", threshold: 35 }),
        ]),
      }),
    );
  });

  it("lets custom templates be deleted without showing delete for built-ins", async () => {
    const onPick = vi.fn();
    render(wrap(<TemplatePicker onPick={onPick} />));

    fireEvent.click(screen.getByText(/start from a template/i));

    await waitFor(() =>
      expect(screen.getByText("My Pullback")).toBeInTheDocument(),
    );

    expect(
      screen.queryByRole("button", { name: /delete golden pocket bounce/i }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /delete my pullback/i }));

    await waitFor(() =>
      expect(api.deleteRuleTemplate).toHaveBeenCalledWith(2),
    );
    expect(onPick).not.toHaveBeenCalled();
  });
});
