import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { sidecarRequest } from "@/lib/sidecarClient";

export default function WatchlistImportSection() {
  const client = useQueryClient();
  const status = useQuery({
    queryKey: ["watchlist-import-status"],
    queryFn: () => sidecarRequest<{ imported: boolean; local_list_count: number }>("GET", "/watchlist/import-status"),
  });
  const migration = useMutation({
    mutationFn: () => sidecarRequest<{ imported: boolean; list_count?: number }>("POST", "/watchlist/import-client-portal"),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["watchlist-import-status"] }),
        client.invalidateQueries({ queryKey: ["watchlists"] }),
      ]);
    },
  });
  const error = migration.error ?? status.error;
  return (
    <div className="min-w-0 space-y-3 pb-4 text-xs text-[var(--text-2)]">
      <p>Watchlists now live in Orbit. Import names, ordering, and members once from your logged-in Client Portal Gateway. Import only reads Client Portal; later edits stay local.</p>
      <p>Existing alerts, drawings, and settings stay in the database. Client Portal must remain available until you verify the imported lists and alerts.</p>
      {status.data && <p role="status">{status.data.imported ? "Import complete" : "Not imported"} · {status.data.local_list_count} local lists</p>}
      <button
        type="button"
        disabled={!status.data || status.data.imported || migration.isPending}
        onClick={() => migration.mutate()}
        className="rounded-md border border-border px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {migration.isPending ? "Importing…" : "Import Client Portal watchlists"}
      </button>
      {error && <p role="alert" className="break-words text-[var(--clr-red)]">{error instanceof Error ? error.message : "Import unavailable. No lists were changed."}</p>}
    </div>
  );
}
