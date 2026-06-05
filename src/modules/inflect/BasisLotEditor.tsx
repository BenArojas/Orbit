import { Save, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import {
  useBasisLots,
  useCreateBasisLot,
  useDeleteBasisLot,
  useUpdateBasisLot,
} from "@/hooks/useBasisLots";
import type { BasisLot, BasisLotUpsertRequest } from "./types";
import { formatMoney, formatNumber } from "./format";

type LotSide = "LONG" | "SHORT";

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function toNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function BasisLotEditor({
  accountId,
  conid,
  defaultQuantity,
  defaultSide,
}: {
  accountId: string | null;
  conid: number;
  defaultQuantity: number;
  defaultSide: LotSide;
}) {
  const lotsQuery = useBasisLots(accountId, conid);
  const createLot = useCreateBasisLot(accountId);
  const updateLot = useUpdateBasisLot(accountId);
  const deleteLot = useDeleteBasisLot(accountId);
  const lots = lotsQuery.data ?? [];

  const [editing, setEditing] = useState<BasisLot | null>(null);
  const [side, setSide] = useState<LotSide>(defaultSide);
  const [quantity, setQuantity] = useState(String(defaultQuantity || ""));
  const [entryDate, setEntryDate] = useState(todayIsoDate());
  const [entryPrice, setEntryPrice] = useState("");
  const [commission, setCommission] = useState("");
  const [note, setNote] = useState("");

  const isPending = createLot.isPending || updateLot.isPending || deleteLot.isPending;
  const canSave = useMemo(
    () =>
      Boolean(
        accountId &&
          entryDate &&
          toNumber(quantity) != null &&
          toNumber(quantity)! > 0 &&
          toNumber(entryPrice) != null &&
          toNumber(entryPrice)! > 0,
      ),
    [accountId, entryDate, entryPrice, quantity],
  );

  function resetForm() {
    setEditing(null);
    setSide(defaultSide);
    setQuantity(String(defaultQuantity || ""));
    setEntryDate(todayIsoDate());
    setEntryPrice("");
    setCommission("");
    setNote("");
  }

  function startEdit(lot: BasisLot) {
    setEditing(lot);
    setSide(lot.side);
    setQuantity(String(lot.quantity));
    setEntryDate(lot.entry_date);
    setEntryPrice(String(lot.entry_price));
    setCommission(lot.commission == null ? "" : String(lot.commission));
    setNote(lot.note ?? "");
  }

  async function save() {
    const qty = toNumber(quantity);
    const price = toNumber(entryPrice);
    if (!accountId || qty == null || price == null || qty <= 0 || price <= 0) return;
    if (
      editing &&
      !window.confirm("Editing this lot will re-derive affected Inflect trades.")
    ) {
      return;
    }
    const body: BasisLotUpsertRequest = {
      conid,
      side,
      quantity: qty,
      entry_date: entryDate,
      entry_price: price,
      commission: toNumber(commission),
      note: note.trim() || null,
    };
    if (editing) {
      await updateLot.mutateAsync({ lotId: editing.id, body });
    } else {
      await createLot.mutateAsync(body);
    }
    resetForm();
  }

  async function remove(lot: BasisLot) {
    if (
      !window.confirm(
        "Deleting this lot may return affected trades to Needs basis.",
      )
    ) {
      return;
    }
    await deleteLot.mutateAsync({ lotId: lot.id, conid: lot.conid });
    if (editing?.id === lot.id) resetForm();
  }

  return (
    <section
      id="basis-repair"
      className="rounded-md border border-[var(--clr-orange)]/45 bg-[var(--clr-orange)]/10 p-3"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-semibold uppercase text-[var(--clr-orange)]">
            Manual basis
          </div>
          <p className="text-[11px] text-[var(--text-3)]">
            Add the missing opening lot. Trades re-derive immediately.
          </p>
        </div>
        {editing ? (
          <button
            type="button"
            onClick={resetForm}
            className="text-[11px] text-[var(--text-3)] hover:text-[var(--text-1)]"
          >
            Cancel
          </button>
        ) : null}
      </div>

      {lots.length ? (
        <div className="mb-3 space-y-1.5">
          {lots.map((lot) => (
            <div
              key={lot.id}
              className="flex items-center justify-between gap-2 rounded-md border border-border bg-[var(--bg-1)] px-2 py-1.5"
            >
              <div className="min-w-0 text-[11px]">
                <span className="font-medium text-[var(--text-1)]">{lot.side}</span>{" "}
                <span className="font-data">{formatNumber(lot.quantity)}</span>{" "}
                <span className="text-[var(--text-3)]">@</span>{" "}
                <span className="font-data">{formatMoney(lot.entry_price)}</span>
                <span className="ml-2 text-[var(--text-3)]">{lot.entry_date}</span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => startEdit(lot)}
                  className="rounded border border-border px-2 py-1 text-[10px] text-[var(--text-2)] hover:text-[var(--text-1)]"
                >
                  Edit
                </button>
                <button
                  type="button"
                  aria-label={`Delete lot ${lot.id}`}
                  onClick={() => void remove(lot)}
                  className="flex h-6 w-6 items-center justify-center rounded border border-border text-[var(--text-3)] hover:text-[var(--clr-red)]"
                >
                  <Trash2 className="h-3 w-3" strokeWidth={1.8} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <label className="text-[10px] uppercase text-[var(--text-3)]">
          Side
          <select
            aria-label="Side"
            value={side}
            onChange={(event) => setSide(event.target.value as LotSide)}
            className="mt-1 h-8 w-full rounded-md border border-border bg-[var(--bg-1)] px-2 text-[12px] text-[var(--text-1)]"
          >
            <option value="LONG">Long</option>
            <option value="SHORT">Short</option>
          </select>
        </label>
        <label className="text-[10px] uppercase text-[var(--text-3)]">
          Qty
          <input
            aria-label="Quantity"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            inputMode="decimal"
            className="mt-1 h-8 w-full rounded-md border border-border bg-[var(--bg-1)] px-2 font-data text-[12px] text-[var(--text-1)]"
          />
        </label>
        <label className="text-[10px] uppercase text-[var(--text-3)]">
          Entry date
          <input
            aria-label="Entry date"
            type="date"
            value={entryDate}
            onChange={(event) => setEntryDate(event.target.value)}
            className="mt-1 h-8 w-full rounded-md border border-border bg-[var(--bg-1)] px-2 font-data text-[12px] text-[var(--text-1)]"
          />
        </label>
        <label className="text-[10px] uppercase text-[var(--text-3)]">
          Entry price
          <input
            aria-label="Entry price"
            value={entryPrice}
            onChange={(event) => setEntryPrice(event.target.value)}
            inputMode="decimal"
            className="mt-1 h-8 w-full rounded-md border border-border bg-[var(--bg-1)] px-2 font-data text-[12px] text-[var(--text-1)]"
          />
        </label>
        <label className="text-[10px] uppercase text-[var(--text-3)]">
          Commission
          <input
            aria-label="Commission"
            value={commission}
            onChange={(event) => setCommission(event.target.value)}
            inputMode="decimal"
            className="mt-1 h-8 w-full rounded-md border border-border bg-[var(--bg-1)] px-2 font-data text-[12px] text-[var(--text-1)]"
          />
        </label>
        <label className="text-[10px] uppercase text-[var(--text-3)]">
          Note
          <input
            aria-label="Note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="mt-1 h-8 w-full rounded-md border border-border bg-[var(--bg-1)] px-2 text-[12px] text-[var(--text-1)]"
          />
        </label>
      </div>

      <button
        type="button"
        disabled={!canSave || isPending}
        onClick={() => void save()}
        className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--clr-orange)]/50 bg-[var(--clr-orange)]/15 px-2 text-[11px] font-medium text-[var(--clr-orange)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Save className="h-3.5 w-3.5" strokeWidth={1.8} />
        {editing ? "Update lot" : "Save lot"}
      </button>
    </section>
  );
}

