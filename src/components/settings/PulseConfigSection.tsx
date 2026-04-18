/**
 * Pulse Config Section — Phase 8.9+ (Commit B)
 *
 * Settings UI for the dashboard Market Pulse bar. Users can:
 *   - Reorder tickers via drag-and-drop (@dnd-kit)
 *   - Edit each row's label + resolve string
 *   - Remove rows
 *   - Add new rows
 *   - Save (persist to /pulse-config)
 *   - Reset to backend defaults (with confirmation)
 *
 * State model:
 *   - `usePulseConfigStore` holds the persisted list (items).
 *   - This component keeps its own `draft` copy while the user edits, then
 *     calls `save(draft)` on explicit save. This keeps the live dashboard
 *     bar from flickering on every keystroke — the optimistic update in the
 *     store only runs on Save.
 *   - Reset goes straight through the store (no draft involvement).
 *
 * Validation mirrors backend rules (see backend/routers/pulse_config.py):
 *   - MAX_ITEMS = 20
 *   - label + resolve both required, each max 16 chars
 *   - No duplicate labels (case-insensitive match to backend which does
 *     an exact string dedupe — we lower-case here too to be friendlier)
 */

import { useMemo, useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, Trash2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { usePulseConfigStore } from "@/store";
import type { PulseItem } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Must match backend/routers/pulse_config.py.
const MAX_ITEMS = 20;
const MAX_LABEL_LEN = 16;
const MAX_RESOLVE_LEN = 16;

// IBKR's /iserver/secdef/search only honours these secTypes. Empty
// string means "no hint" — the backend resolver then falls through
// STK → unfiltered. Kept in sync with ALLOWED_SEC_TYPES in the backend.
const SEC_TYPE_OPTIONS = ["", "STK", "IND", "BOND"] as const;

// ── Draft row type ───────────────────────────────────────────
//
// The draft list needs a stable id that survives edits (label changes).
// We use a monotonically-increasing counter assigned at load/add time so
// DnD-kit's useSortable has a key that never collides, even if two rows
// temporarily share the same empty label during editing.

interface DraftRow extends PulseItem {
  id: string;
}

let __draftIdCounter = 0;
function makeDraftId(): string {
  __draftIdCounter += 1;
  return `pulse-row-${__draftIdCounter}`;
}

function toDraft(items: readonly PulseItem[]): DraftRow[] {
  return items.map((it) => ({
    // Normalise legacy items without sec_type to "" so the input
    // doesn't render as an uncontrolled → controlled mismatch.
    sec_type: it.sec_type ?? "",
    ...it,
    id: makeDraftId(),
  }));
}

function fromDraft(rows: DraftRow[]): PulseItem[] {
  return rows.map(({ label, resolve, sec_type }) => ({
    label,
    resolve,
    sec_type: sec_type ?? "",
  }));
}

// ── Sortable row ─────────────────────────────────────────────

function SortableRow({
  row,
  index,
  duplicate,
  onChange,
  onRemove,
}: {
  row: DraftRow;
  index: number;
  duplicate: boolean;
  onChange: (patch: Partial<PulseItem>) => void;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  } as const;

  const labelInvalid = row.label.trim().length === 0 || duplicate;
  const resolveInvalid = row.resolve.trim().length === 0;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 border-b border-border last:border-0 py-2"
    >
      {/* Drag handle */}
      <button
        type="button"
        aria-label={`Reorder row ${index + 1}`}
        className="shrink-0 cursor-grab active:cursor-grabbing rounded p-1 text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--bg-3)] transition-colors"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={13} />
      </button>

      {/* Label input */}
      <input
        type="text"
        value={row.label}
        onChange={(e) => onChange({ label: e.target.value })}
        maxLength={MAX_LABEL_LEN}
        placeholder="Label"
        aria-label="Ticker label"
        className={`w-[100px] rounded-md border bg-[var(--bg-3)] px-2 py-1 font-data text-[11px] text-[var(--text-1)] focus:outline-none focus:ring-1 focus:ring-[var(--clr-cyan)] transition-colors ${
          labelInvalid ? "border-[var(--clr-red)]" : "border-border"
        }`}
      />

      {/* Resolve input */}
      <input
        type="text"
        value={row.resolve}
        onChange={(e) => onChange({ resolve: e.target.value })}
        maxLength={MAX_RESOLVE_LEN}
        placeholder="Resolve"
        aria-label="Resolve symbol"
        className={`flex-1 min-w-0 rounded-md border bg-[var(--bg-3)] px-2 py-1 font-data text-[11px] text-[var(--text-1)] focus:outline-none focus:ring-1 focus:ring-[var(--clr-cyan)] transition-colors ${
          resolveInvalid ? "border-[var(--clr-red)]" : "border-border"
        }`}
      />

      {/* secType hint — optional. Empty = resolver falls through
          STK → unfiltered. "STK" forces an equity match (e.g. GLD as
          the ARCA ETF rather than HKFE futures). */}
      <select
        value={row.sec_type ?? ""}
        onChange={(e) => onChange({ sec_type: e.target.value })}
        aria-label="IBKR secType hint"
        title="Optional IBKR secType hint"
        className="w-[62px] shrink-0 rounded-md border border-border bg-[var(--bg-3)] px-1.5 py-1 font-data text-[11px] text-[var(--text-1)] focus:outline-none focus:ring-1 focus:ring-[var(--clr-cyan)] cursor-pointer"
      >
        {SEC_TYPE_OPTIONS.map((opt) => (
          <option key={opt || "auto"} value={opt}>
            {opt || "auto"}
          </option>
        ))}
      </select>

      {/* Remove */}
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove row"
        title="Remove"
        className="shrink-0 rounded-md p-1.5 text-[var(--text-3)] hover:text-[var(--clr-red)] hover:bg-[var(--bg-3)] transition-colors cursor-pointer"
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

// ── Main section ─────────────────────────────────────────────

export default function PulseConfigSection() {
  const items = usePulseConfigStore((s) => s.items);
  const save = usePulseConfigStore((s) => s.save);
  const reset = usePulseConfigStore((s) => s.reset);
  const isSaving = usePulseConfigStore((s) => s.isSaving);

  // Draft begins as a clone of the persisted list. It's reseeded any time
  // the persisted list changes out from under us (e.g. after a reset).
  const [draft, setDraft] = useState<DraftRow[]>(() => toDraft(items));
  const [seededKey, setSeededKey] = useState(() => JSON.stringify(items));
  const currentKey = JSON.stringify(items);
  if (currentKey !== seededKey) {
    // Persisted items changed (reset, load, external save). Reseed draft.
    setDraft(toDraft(items));
    setSeededKey(currentKey);
  }

  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  // ── Validation ─────────────────────────────────────────────
  const duplicates = useMemo(() => {
    const seen = new Map<string, number>();
    const dupes = new Set<string>();
    for (const row of draft) {
      const key = row.label.trim().toLowerCase();
      if (key.length === 0) continue;
      if (seen.has(key)) dupes.add(key);
      else seen.set(key, 1);
    }
    return dupes;
  }, [draft]);

  const hasBlankLabel = draft.some((r) => r.label.trim().length === 0);
  const hasBlankResolve = draft.some((r) => r.resolve.trim().length === 0);
  const hasDuplicates = duplicates.size > 0;
  const tooMany = draft.length > MAX_ITEMS;

  // Compare draft to persisted (order + values) to know if Save is needed.
  const dirty = useMemo(() => {
    if (draft.length !== items.length) return true;
    for (let i = 0; i < draft.length; i++) {
      const a = draft[i];
      const b = items[i];
      if (
        a.label !== b.label ||
        a.resolve !== b.resolve ||
        (a.sec_type ?? "") !== (b.sec_type ?? "")
      ) {
        return true;
      }
    }
    return false;
  }, [draft, items]);

  const canSave =
    dirty && !isSaving && !hasBlankLabel && !hasBlankResolve && !hasDuplicates && !tooMany;

  // ── DnD sensors ────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setDraft((rows) => {
      const oldIdx = rows.findIndex((r) => r.id === active.id);
      const newIdx = rows.findIndex((r) => r.id === over.id);
      if (oldIdx < 0 || newIdx < 0) return rows;
      return arrayMove(rows, oldIdx, newIdx);
    });
  }

  // ── Row handlers ───────────────────────────────────────────
  function updateRow(id: string, patch: Partial<PulseItem>) {
    setDraft((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function removeRow(id: string) {
    setDraft((rows) => rows.filter((r) => r.id !== id));
  }
  function addRow() {
    if (draft.length >= MAX_ITEMS) return;
    setDraft((rows) => [
      ...rows,
      { id: makeDraftId(), label: "", resolve: "", sec_type: "" },
    ]);
  }

  // ── Save / reset / revert ──────────────────────────────────
  async function onSave() {
    try {
      await save(fromDraft(draft));
      toast.success("Market Pulse updated");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save";
      toast.error(msg);
    }
  }

  function onRevert() {
    setDraft(toDraft(items));
  }

  async function confirmReset() {
    setResetting(true);
    try {
      await reset();
      toast.success("Market Pulse restored to defaults");
      setResetOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Reset failed";
      toast.error(msg);
    } finally {
      setResetting(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="py-3">
      <p className="text-[10px] text-[var(--text-3)] leading-snug mb-3">
        Customize the tickers shown on the dashboard's Market Pulse bar.
        Drag to reorder. <span className="font-data">Label</span> is what's
        displayed; <span className="font-data">Resolve</span> is the symbol
        passed to IBKR (e.g. <span className="font-data">SPX</span>,{" "}
        <span className="font-data">BTC</span>,{" "}
        <span className="font-data">USD.ILS</span>,{" "}
        <span className="font-data">XAUUSD</span>). Leave the type as{" "}
        <span className="font-data">auto</span> unless you need to force a
        specific IBKR secType (<span className="font-data">STK</span> for
        stocks/ETFs, <span className="font-data">IND</span> for indices).
      </p>

      {/* Row list */}
      {draft.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-[var(--bg-3)]/40 px-3 py-4 text-center text-[11px] text-[var(--text-3)]">
          No tickers — the Market Pulse bar will be hidden.
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={draft.map((r) => r.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="rounded-md border border-border bg-[var(--bg-3)]/30 px-2">
              {draft.map((row, i) => {
                const key = row.label.trim().toLowerCase();
                const isDuplicate = key.length > 0 && duplicates.has(key);
                return (
                  <SortableRow
                    key={row.id}
                    row={row}
                    index={i}
                    duplicate={isDuplicate}
                    onChange={(patch) => updateRow(row.id, patch)}
                    onRemove={() => removeRow(row.id)}
                  />
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Add row */}
      <div className="mt-2 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={addRow}
          disabled={draft.length >= MAX_ITEMS}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-[var(--bg-3)] px-2.5 py-1 text-[11px] text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--bg-4)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          <Plus size={12} />
          Add ticker
        </button>
        <span className="font-data text-[10px] text-[var(--text-3)]">
          {draft.length} / {MAX_ITEMS}
        </span>
      </div>

      {/* Validation hints */}
      {(hasBlankLabel || hasBlankResolve || hasDuplicates || tooMany) && (
        <ul className="mt-3 space-y-1 text-[10px] text-[var(--clr-red)]">
          {hasBlankLabel && <li>• Every row needs a label.</li>}
          {hasBlankResolve && <li>• Every row needs a resolve symbol.</li>}
          {hasDuplicates && <li>• Labels must be unique.</li>}
          {tooMany && <li>• Maximum {MAX_ITEMS} tickers.</li>}
        </ul>
      )}

      {/* Footer actions */}
      <div className="mt-4 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setResetOpen(true)}
          disabled={isSaving || resetting}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[11px] text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--bg-3)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          <RotateCcw size={12} />
          Reset to defaults
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRevert}
            disabled={!dirty || isSaving}
            className="rounded-md border border-border px-2.5 py-1 text-[11px] text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--bg-3)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            Revert
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={!canSave}
            className="rounded-md px-3 py-1 text-[11px] font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
            style={{
              background: canSave ? "var(--clr-cyan)" : "var(--bg-4)",
              color: canSave ? "var(--bg-1)" : "var(--text-3)",
            }}
          >
            {isSaving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {/* Reset confirmation */}
      <Dialog open={resetOpen} onOpenChange={(v) => !resetting && setResetOpen(v)}>
        <DialogContent className="max-w-sm bg-[var(--bg-2)] border-border">
          <DialogHeader>
            <DialogTitle className="text-[13px] font-semibold text-[var(--text-1)]">
              Reset Market Pulse?
            </DialogTitle>
            <DialogDescription className="text-[11px] text-[var(--text-3)] leading-snug">
              This replaces your current ticker list with the built-in
              default (SPX, SPY, QQQ, and 10 others). Any customizations
              will be lost.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setResetOpen(false)}
              disabled={resetting}
              className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-[11px] text-[var(--text-2)] hover:bg-[var(--bg-3)] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmReset}
              disabled={resetting}
              className="cursor-pointer rounded-md px-3 py-1.5 text-[11px] font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: "var(--clr-cyan)", color: "var(--bg-1)" }}
            >
              {resetting ? "Resetting…" : "Reset"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
