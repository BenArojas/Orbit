import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TodayContextStrip } from "../TodayContextStrip";

vi.mock("@/hooks/useMarketSnapshot", () => ({
  useMarketSnapshot: () => ({
    data: {
      spx: { last: 5247, changePct: 0.42 },
      vix: { last: 14.3, changePct: -2.1 },
      breadth: { value: 312, label: "strong" },
      strength: { value: 68, label: "bullish" },
      rotation: { leader: "Tech" },
      topSector: { ticker: "XLK", changePct: 1.1 },
      worstSector: { ticker: "XLU", changePct: -0.6 },
    },
  }),
}));

describe("TodayContextStrip", () => {
  it("renders 7 cells with the snapshot data", () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={qc}>
        <TodayContextStrip />
      </QueryClientProvider>,
    );
    // labels
    expect(screen.getByText("SPX")).toBeInTheDocument();
    expect(screen.getByText("VIX")).toBeInTheDocument();
    expect(screen.getByText("Breadth")).toBeInTheDocument();
    expect(screen.getByText("Strength")).toBeInTheDocument();
    expect(screen.getByText("Rotation")).toBeInTheDocument();
    expect(screen.getByText("Top Sec")).toBeInTheDocument();
    expect(screen.getByText("Worst Sec")).toBeInTheDocument();
    // values
    expect(screen.getByText("5,247")).toBeInTheDocument();
    expect(screen.getByText("14.3")).toBeInTheDocument();
    expect(screen.getByText("Tech")).toBeInTheDocument();
    expect(screen.getByText("XLK")).toBeInTheDocument();
    expect(screen.getByText("XLU")).toBeInTheDocument();
  });
});
