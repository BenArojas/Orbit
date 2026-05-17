/**
 * TanStack Query hooks for chart drawing CRUD.
 *
 * Drawings persist per-conid in SQLite and are visible on all timeframes.
 * These hooks wrap the four drawing endpoints:
 *   POST   /drawings            → useCreateDrawing()
 *   PUT    /drawings/{id}       → useUpdateDrawing()
 *   DELETE /drawings/{id}       → useDeleteDrawing()
 *   GET    /drawings/{conid}    → useDrawings(conid)
 *
 * Plan: docs/drawing-tools-plan.md, Branch 2.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type {
  Drawing,
  CreateDrawingRequest,
  UpdateDrawingRequest,
} from "@/lib/api";

// ── Query key factory ────────────────────────────────────────

function drawingsKey(conid: number) {
  return ["drawings", conid] as const;
}

// ── Query ─────────────────────────────────────────────────────

/**
 * Fetch all drawings for an instrument.
 *
 * Enabled only when conid is truthy. Cache survives timeframe switches
 * because drawings are conid-scoped, not timeframe-scoped.
 */
export function useDrawings(conid: number | null) {
  return useQuery<Drawing[]>({
    queryKey: drawingsKey(conid ?? 0),
    queryFn: () => api.getDrawings(conid!),
    enabled: conid != null && conid > 0,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });
}

// ── Mutations ─────────────────────────────────────────────────

/**
 * Create a new drawing.
 * On success: invalidates the drawings query so DrawingsLayer re-syncs.
 */
export function useCreateDrawing(conid: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: CreateDrawingRequest) => api.createDrawing(req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: drawingsKey(conid) });
    },
  });
}

/**
 * Partial update of a drawing's anchors and/or style.
 * Applies an optimistic cache update; rolls back on failure.
 */
export function useUpdateDrawing(conid: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, req }: { id: number; req: UpdateDrawingRequest }) =>
      api.updateDrawing(id, req),
    onMutate: async ({ id, req }) => {
      await qc.cancelQueries({ queryKey: drawingsKey(conid) });
      const prev = qc.getQueryData<Drawing[]>(drawingsKey(conid));
      qc.setQueryData<Drawing[]>(drawingsKey(conid), (old) =>
        old?.map((d) =>
          d.id === id
            ? {
                ...d,
                anchors: req.anchors ?? d.anchors,
                style: req.style ?? d.style,
              }
            : d,
        ) ?? [],
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) {
        qc.setQueryData(drawingsKey(conid), ctx.prev);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: drawingsKey(conid) });
    },
  });
}

/**
 * Delete a drawing by server id.
 * Applies an optimistic remove; refetches on failure.
 */
export function useDeleteDrawing(conid: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.deleteDrawing(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: drawingsKey(conid) });
      const prev = qc.getQueryData<Drawing[]>(drawingsKey(conid));
      qc.setQueryData<Drawing[]>(drawingsKey(conid), (old) =>
        old?.filter((d) => d.id !== id) ?? [],
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) {
        qc.setQueryData(drawingsKey(conid), ctx.prev);
      }
      qc.invalidateQueries({ queryKey: drawingsKey(conid) });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: drawingsKey(conid) });
    },
  });
}
