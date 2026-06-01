import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import TriggersTab from "../TriggersTab";

vi.mock("@/lib/api", () => ({
  api: {
    getTriggerRules: vi.fn(),
    updateTriggerRule: vi.fn(),
    createTriggerRule: vi.fn(),
    getWatchlists: vi.fn(),
    getRuleTemplates: vi.fn(),
    createRuleTemplate: vi.fn(),
    resolveConid: vi.fn(),
  },
}));

import { api } from "@/lib/api";

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TriggersTab activeConid={619969457} activeSymbol="IREN" activeTimeframe="15m" />
    </QueryClientProvider>,
  );
}

describe("TriggersTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getTriggerRules).mockResolvedValue([]);
    vi.mocked(api.getWatchlists).mockResolvedValue([]);
    vi.mocked(api.getRuleTemplates).mockResolvedValue([]);
  });

  it("lets the user create a trigger for the active chart symbol", async () => {
    renderTab();

    await waitFor(() => screen.getByText(/no per-stock rules/i));
    fireEvent.click(screen.getByRole("button", { name: /add trigger/i }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByDisplayValue("IREN")).toBeInTheDocument();
    expect(screen.getByText("conid: 619969457")).toBeInTheDocument();
    expect(screen.getByDisplayValue("15m")).toBeInTheDocument();
  });
});
