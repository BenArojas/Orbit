import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StoragePanel } from "../StoragePanel";

const hookMocks = vi.hoisted(() => ({
  useInflectStorage: vi.fn(),
  useInflectStorageCleanup: vi.fn(),
}));

vi.mock("@/hooks/useInflectStorage", () => hookMocks);

describe("StoragePanel", () => {
  it("shows storage stats and confirms cleanup", async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ cleared_raw_payloads: 1 });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    hookMocks.useInflectStorage.mockReturnValue({
      data: {
        file_size_bytes: 4096,
        table_counts: { fills: 2, basis_lots: 1 },
        raw_json_bytes: 120,
      },
      isLoading: false,
    });
    hookMocks.useInflectStorageCleanup.mockReturnValue({
      mutateAsync,
      isPending: false,
    });

    render(<StoragePanel />);

    expect(screen.getByText("4.0 KB")).toBeInTheDocument();
    expect(screen.getByText("120 B")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Cleanup before date"), {
      target: { value: "2026-06-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: /clear raw payloads/i }));

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        before_date: "2026-06-01",
        confirm: true,
      }),
    );
  });
});

