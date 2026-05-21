import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TemplatePicker } from "../TemplatePicker";

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
    ]),
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
});
