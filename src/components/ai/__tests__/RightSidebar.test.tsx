/**
 * Tests for RightSidebar — tab switcher wrapping AI / Watchlists / Triggers.
 *
 * Covers:
 *   - All three tab buttons render
 *   - AI tab is active by default
 *   - Clicking Watchlists / Triggers switches the active tab
 *   - AiChatPanel is always mounted (hidden when inactive — preserves chat state)
 *   - WatchlistTab and TriggersTab mount only when their tab is active
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import RightSidebar from "../RightSidebar";

// ── Mocks ─────────────────────────────────────────────────────────────────

vi.mock("../AiChatPanel", () => ({
  default: () => <div data-testid="ai-chat-panel">AiChatPanel</div>,
}));

vi.mock("../WatchlistTab", () => ({
  default: ({ activeSymbol }: { activeSymbol: string }) => (
    <div data-testid="watchlist-tab">WatchlistTab-{activeSymbol}</div>
  ),
}));

vi.mock("../TriggersTab", () => ({
  default: ({ activeSymbol }: { activeSymbol: string }) => (
    <div data-testid="triggers-tab">TriggersTab-{activeSymbol}</div>
  ),
}));

// ── Helpers ───────────────────────────────────────────────────────────────

function renderSidebar(props = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RightSidebar activeConid={265598} activeSymbol="AAPL" {...props} />
    </QueryClientProvider>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("RightSidebar", () => {
  it("renders all three tab buttons", () => {
    renderSidebar();
    expect(screen.getByTestId("tab-ai")).toBeTruthy();
    expect(screen.getByTestId("tab-watchlists")).toBeTruthy();
    expect(screen.getByTestId("tab-triggers")).toBeTruthy();
  });

  it("AI tab is active by default — AiChatPanel is visible", () => {
    renderSidebar();
    // AiChatPanel should be in the DOM (always mounted)
    expect(screen.getByTestId("ai-chat-panel")).toBeTruthy();
    // WatchlistTab should NOT be mounted
    expect(screen.queryByTestId("watchlist-tab")).toBeNull();
    // TriggersTab should NOT be mounted
    expect(screen.queryByTestId("triggers-tab")).toBeNull();
  });

  it("clicking Watchlists tab shows WatchlistTab", () => {
    renderSidebar();
    fireEvent.click(screen.getByTestId("tab-watchlists"));
    expect(screen.getByTestId("watchlist-tab")).toBeTruthy();
    expect(screen.queryByTestId("triggers-tab")).toBeNull();
  });

  it("clicking Triggers tab shows TriggersTab", () => {
    renderSidebar();
    fireEvent.click(screen.getByTestId("tab-triggers"));
    expect(screen.getByTestId("triggers-tab")).toBeTruthy();
    expect(screen.queryByTestId("watchlist-tab")).toBeNull();
  });

  it("AiChatPanel remains mounted when switching to Watchlists tab", () => {
    renderSidebar();
    fireEvent.click(screen.getByTestId("tab-watchlists"));
    // AiChatPanel is always mounted — hidden, but in the DOM
    expect(screen.getByTestId("ai-chat-panel")).toBeTruthy();
  });

  it("switching back to AI tab hides WatchlistTab", () => {
    renderSidebar();
    fireEvent.click(screen.getByTestId("tab-watchlists"));
    fireEvent.click(screen.getByTestId("tab-ai"));
    expect(screen.queryByTestId("watchlist-tab")).toBeNull();
  });

  it("passes activeSymbol to WatchlistTab", () => {
    renderSidebar({ activeSymbol: "NVDA" });
    fireEvent.click(screen.getByTestId("tab-watchlists"));
    expect(screen.getByText("WatchlistTab-NVDA")).toBeTruthy();
  });

  it("passes activeSymbol to TriggersTab", () => {
    renderSidebar({ activeSymbol: "TSLA" });
    fireEvent.click(screen.getByTestId("tab-triggers"));
    expect(screen.getByText("TriggersTab-TSLA")).toBeTruthy();
  });
});
