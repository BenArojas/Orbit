/**
 * Watchlist Expiry Overrides — Phase 6.8
 *
 * Collapsible section inside the TriggerRules sidebar. Lets the user set a
 * per-watchlist auto-expire override: any rule that drops a symbol into that
 * target watchlist will use the override's days value (even when null =
 * "explicitly no expire") instead of its own `auto_expire_days`.
 *
 * Rules:
 *   - Dropdown of IBKR watchlists (prevents typos / orphans)
 *   - Days field — empty = null = "no auto-expire" (a meaningful override)
 *   - Trash icon deletes the row (rules fall back to their own value)
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  api,
  type WatchlistConfig,
  type WatchlistInfo,
} from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

// ── Row ────────────────────────────────────────────────────

function ConfigRow({
  config,
  onDelete,
  onUpdate,
}: {
  config: WatchlistConfig;
  onDelete: (name: string) => void;
  onUpdate: (name: string, days: number | null) => void;
}) {
  const [days, setDays] = useState<string>(
    config.auto_expire_days === null ? "" : String(config.auto_expire_days),
  );
  const [dirty, setDirty] = useState(false);

  function commit() {
    if (!dirty) return;
    const parsed = days.trim() === "" ? null : Number(days);
    if (parsed !== null && (Number.isNaN(parsed) || parsed < 0)) return;
    onUpdate(config.name, parsed);
    setDirty(false);
  }

  return (
    <div className="group flex items-center gap-2 px-3.5 py-[6px] transition-colors hover:bg-[var(--bg-3)]">
      <span className="min-w-0 flex-1 truncate text-[10px] text-[var(--text-2)]">
        {config.name}
      </span>

      <Input
        type="number"
        min={0}
        max={3650}
        value={days}
        onChange={(e) => {
          setDays(e.target.value);
          setDirty(true);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          }
        }}
        placeholder="∞"
        title="Days before auto-return to source. Empty = no auto-expire."
        className="h-5 w-[52px] bg-[var(--bg-1)] px-1.5 font-data text-[10px]"
      />

      <button
        onClick={() => onDelete(config.name)}
        className="ml-0.5 hidden text-[10px] text-[var(--text-3)] transition-colors hover:text-[var(--clr-red)] group-hover:block"
        title="Remove override (fall back to per-rule values)"
      >
        x
      </button>
    </div>
  );
}

// ── Add Row (inline, compact) ──────────────────────────────

function AddRow({
  availableNames,
  onAdd,
}: {
  availableNames: string[];
  onAdd: (name: string, days: number | null) => void;
}) {
  const [name, setName] = useState("");
  const [days, setDays] = useState<string>("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const parsed = days.trim() === "" ? null : Number(days);
    if (parsed !== null && (Number.isNaN(parsed) || parsed < 0)) return;
    onAdd(name, parsed);
    setName("");
    setDays("");
  }

  return (
    <form
      onSubmit={submit}
      className="flex items-center gap-1.5 border-t border-border px-3.5 py-1.5"
    >
      <select
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="h-6 min-w-0 flex-1 rounded border border-border bg-[var(--bg-1)] px-1.5 text-[10px] text-[var(--text-1)]"
      >
        <option value="">Pick watchlist…</option>
        {availableNames.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>

      <Input
        type="number"
        min={0}
        max={3650}
        value={days}
        onChange={(e) => setDays(e.target.value)}
        placeholder="days"
        className="h-6 w-[52px] bg-[var(--bg-1)] px-1.5 font-data text-[10px]"
      />

      <Button
        type="submit"
        variant="ghost"
        size="sm"
        disabled={!name}
        className="h-6 px-1.5 text-[9px] text-[var(--text-3)] hover:text-[var(--clr-cyan)]"
      >
        +
      </Button>
    </form>
  );
}

// ── Main Section ───────────────────────────────────────────

export default function WatchlistConfigSection() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  // Tier-8 gating is N/A here — fetches only fire when the user opens the
  // section. We add silent retries on transient IBKR flakes (Phase 8 / 8.9).
  const { data: configs } = useQuery<WatchlistConfig[]>({
    queryKey: ["watchlist-configs"],
    queryFn: () => api.getWatchlistConfigs(),
    staleTime: 30_000,
    enabled: open,
    retry: 2,
  });

  const { data: watchlists } = useQuery<WatchlistInfo[]>({
    queryKey: ["watchlists"],
    queryFn: () => api.getWatchlists(),
    staleTime: 60_000,
    enabled: open,
    retry: 2,
  });

  const putMutation = useMutation({
    mutationFn: ({ name, days }: { name: string; days: number | null }) =>
      api.putWatchlistConfig(name, { auto_expire_days: days }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["watchlist-configs"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (name: string) => api.deleteWatchlistConfig(name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["watchlist-configs"] }),
  });

  const configuredNames = new Set((configs ?? []).map((c) => c.name));
  const availableNames = (watchlists ?? [])
    .map((w) => w.name)
    .filter((n) => !configuredNames.has(n));

  function handleAdd(name: string, days: number | null) {
    putMutation.mutate({ name, days });
  }

  function handleUpdate(name: string, days: number | null) {
    putMutation.mutate({ name, days });
  }

  function handleDelete(name: string) {
    deleteMutation.mutate(name);
  }

  return (
    <div className="flex flex-col">
      <button
        onClick={() => setOpen((o) => !o)}
        className="sticky top-0 z-10 flex items-center justify-between border-b border-t border-border bg-[var(--bg-1)]/80 px-3.5 py-2 backdrop-blur transition-colors hover:bg-[var(--bg-2)]"
      >
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
          Watchlist Expiry
        </span>
        <span className="text-[10px] text-[var(--text-3)]">
          {open ? "▾" : "▸"} {configs?.length ?? 0}
        </span>
      </button>

      {open && (
        <>
          {!configs || configs.length === 0 ? (
            <div className="flex items-center justify-center py-3">
              <span className="text-[10px] text-[var(--text-3)]">
                No overrides — rules use their own expiry
              </span>
            </div>
          ) : (
            <div className="flex flex-col">
              {configs.map((c) => (
                <ConfigRow
                  key={c.name}
                  config={c}
                  onDelete={handleDelete}
                  onUpdate={handleUpdate}
                />
              ))}
            </div>
          )}
          <AddRow availableNames={availableNames} onAdd={handleAdd} />
        </>
      )}
    </div>
  );
}
