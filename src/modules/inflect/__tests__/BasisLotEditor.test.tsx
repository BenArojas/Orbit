import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BasisLotEditor } from "../BasisLotEditor";

const hookMocks = vi.hoisted(() => ({
  useBasisLots: vi.fn(),
  useCreateBasisLot: vi.fn(),
  useUpdateBasisLot: vi.fn(),
  useDeleteBasisLot: vi.fn(),
}));

vi.mock("@/hooks/useBasisLots", () => hookMocks);

describe("BasisLotEditor", () => {
  it("creates a manual basis lot from the needs-basis trade", async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ id: 1 });
    hookMocks.useBasisLots.mockReturnValue({ data: [], isLoading: false });
    hookMocks.useCreateBasisLot.mockReturnValue({ mutateAsync, isPending: false });
    hookMocks.useUpdateBasisLot.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    hookMocks.useDeleteBasisLot.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });

    render(
      <BasisLotEditor
        accountId="DU1"
        conid={265598}
        defaultQuantity={10}
        defaultSide="LONG"
      />,
    );

    fireEvent.change(screen.getByLabelText("Entry date"), { target: { value: "2026-05-01" } });
    fireEvent.change(screen.getByLabelText("Entry price"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: /save lot/i }));

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        conid: 265598,
        side: "LONG",
        quantity: 10,
        entry_date: "2026-05-01",
        entry_price: 100,
        commission: null,
        note: null,
      }),
    );
  });

  it("confirms before deleting an existing lot", async () => {
    const deleteAsync = vi.fn().mockResolvedValue({ deleted: true });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    hookMocks.useBasisLots.mockReturnValue({
      data: [
        {
          id: 7,
          account_id: "DU1",
          conid: 265598,
          side: "LONG",
          quantity: 10,
          entry_date: "2026-05-01",
          entry_price: 100,
          commission: null,
          note: null,
        },
      ],
      isLoading: false,
    });
    hookMocks.useCreateBasisLot.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    hookMocks.useUpdateBasisLot.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    hookMocks.useDeleteBasisLot.mockReturnValue({ mutateAsync: deleteAsync, isPending: false });

    render(
      <BasisLotEditor
        accountId="DU1"
        conid={265598}
        defaultQuantity={10}
        defaultSide="LONG"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /delete lot 7/i }));

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(deleteAsync).toHaveBeenCalledWith({ lotId: 7, conid: 265598 }));
  });
});

