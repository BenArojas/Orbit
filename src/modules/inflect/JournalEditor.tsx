import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { inflectApi } from "@/modules/inflect/api";
import { useSaveTradeJournal } from "@/hooks/useTradeJournal";
import type { InflectJournalEntry } from "./types";

/** Split a comma-separated tag string into trimmed, non-empty tags. */
function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function JournalEditor({
  tradeId,
  accountId,
  entry,
}: {
  tradeId: string;
  accountId: string | null;
  entry: InflectJournalEntry | null;
}) {
  const setupsQuery = useQuery({
    queryKey: ["inflect", "setups"],
    queryFn: ({ signal }) => inflectApi.inflectSetups(signal),
    staleTime: Infinity,
  });
  const setups = setupsQuery.data?.setups ?? [];

  const [setup, setSetup] = useState(entry?.setup ?? "");
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [tags, setTags] = useState((entry?.tags ?? []).join(", "));

  // Re-seed the form when the selected trade (and its saved entry) changes.
  useEffect(() => {
    setSetup(entry?.setup ?? "");
    setNotes(entry?.notes ?? "");
    setTags((entry?.tags ?? []).join(", "));
  }, [tradeId, entry]);

  const save = useSaveTradeJournal(accountId ?? undefined);

  function onSave() {
    save.mutate({
      tradeId,
      body: {
        setup: setup || null,
        notes: notes.trim() || null,
        tags: parseTags(tags),
      },
    });
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-[10px] uppercase text-[var(--text-3)]">Setup</label>
        <select
          value={setup}
          onChange={(event) => setSetup(event.target.value)}
          className="h-8 w-full rounded-md border border-border bg-[var(--bg-1)] px-2 text-[12px] text-[var(--text-1)] outline-none"
        >
          <option value="">— None —</option>
          {setups.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-[10px] uppercase text-[var(--text-3)]">Notes</label>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={4}
          placeholder="What happened? What did you see?"
          className="w-full resize-y rounded-md border border-border bg-[var(--bg-1)] px-2 py-1.5 text-[12px] text-[var(--text-1)] outline-none placeholder:text-[var(--text-3)]"
        />
      </div>

      <div>
        <label className="mb-1 block text-[10px] uppercase text-[var(--text-3)]">Tags</label>
        <input
          value={tags}
          onChange={(event) => setTags(event.target.value)}
          placeholder="comma, separated, tags"
          className="h-8 w-full rounded-md border border-border bg-[var(--bg-1)] px-2 text-[12px] text-[var(--text-1)] outline-none placeholder:text-[var(--text-3)]"
        />
      </div>

      <button
        type="button"
        onClick={onSave}
        disabled={save.isPending}
        className="h-8 w-full rounded-md bg-[var(--clr-cyan)]/20 text-[12px] font-medium text-[var(--clr-cyan)] transition-colors hover:bg-[var(--clr-cyan)]/30 disabled:opacity-50"
      >
        {save.isPending ? "Saving…" : "Save journal"}
      </button>
    </div>
  );
}
