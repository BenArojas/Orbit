import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import CompareModeHeader from "../CompareModeHeader";
import { useCompareStore, MAX_PANES } from "@/store/compare";
import { useChartStore } from "@/store/chart";

const mockResolveConid = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    resolveConid: (...args: unknown[]) => mockResolveConid(...args),
  },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn() },
}));

const makeWrapper = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
};

beforeEach(() => {
  vi.clearAllMocks();
  useCompareStore.getState().__resetForTests();
  useCompareStore.getState().enter("5m");
  useChartStore.setState({ activeSymbol: "AAPL", activeConid: 265598 });
  mockResolveConid.mockResolvedValue({ symbol: "SPY", conid: 320227571 });
});

describe("CompareModeHeader", () => {
  it("renders the primary stock symbol as read-only text (not an input)", () => {
    render(<CompareModeHeader />, { wrapper: makeWrapper() });
    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("AAPL")).not.toBeInTheDocument();
  });

  it("auto-resolves the default reference (SPY) on mount", async () => {
    render(<CompareModeHeader />, { wrapper: makeWrapper() });
    await waitFor(() => expect(mockResolveConid).toHaveBeenCalledWith("SPY"));
    await waitFor(() => expect(useCompareStore.getState().reference.conid).toBe(320227571));
  });

  it("resolves a typed reference symbol on Enter", async () => {
    mockResolveConid.mockResolvedValueOnce({ symbol: "SPY", conid: 320227571 });
    mockResolveConid.mockResolvedValueOnce({ symbol: "QQQ", conid: 320227575 });

    render(<CompareModeHeader />, { wrapper: makeWrapper() });
    await waitFor(() => expect(useCompareStore.getState().reference.conid).toBe(320227571));

    const input = screen.getByLabelText(/reference symbol/i);
    fireEvent.change(input, { target: { value: "QQQ" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(mockResolveConid).toHaveBeenCalledWith("QQQ"));
    await waitFor(() => expect(useCompareStore.getState().reference.symbol).toBe("QQQ"));
  });

  it("disables the Add-pane button at the cap", () => {
    while (useCompareStore.getState().panes.length < MAX_PANES) {
      useCompareStore.getState().addPane();
    }
    render(<CompareModeHeader />, { wrapper: makeWrapper() });
    expect(screen.getByRole("button", { name: /add pane/i })).toBeDisabled();
  });

  it("clicking Exit sets compare.active=false", () => {
    render(<CompareModeHeader />, { wrapper: makeWrapper() });
    fireEvent.click(screen.getByRole("button", { name: /exit/i }));
    expect(useCompareStore.getState().active).toBe(false);
  });
});
