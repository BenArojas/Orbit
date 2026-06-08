import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { inflectApi } from "@/modules/inflect/api";
import type { BasisLotUpsertRequest } from "@/modules/inflect/types";

function invalidateBasisRepair(
  qc: ReturnType<typeof useQueryClient>,
  accountId: string,
  conid: number,
) {
  qc.invalidateQueries({ queryKey: ["inflect", "basis-lots", accountId, conid] });
  qc.invalidateQueries({ queryKey: ["inflect", "basis-audit", accountId, conid] });
  qc.invalidateQueries({ queryKey: ["inflect", "backfill-status"] });
  qc.invalidateQueries({ queryKey: ["inflect", "trade"] });
  qc.invalidateQueries({ queryKey: ["inflect", "trades"] });
  qc.invalidateQueries({ queryKey: ["inflect", "calendar"] });
}

export function useBasisLots(accountId: string | null, conid: number | null | undefined) {
  return useQuery({
    queryKey: ["inflect", "basis-lots", accountId, conid ?? null],
    queryFn: ({ signal }) =>
      inflectApi.inflectBasisLots({ accountId: accountId as string, conid: conid as number }, signal),
    enabled: Boolean(accountId && conid != null),
  });
}

export function useBasisAudit(accountId: string | null, conid: number | null | undefined) {
  return useQuery({
    queryKey: ["inflect", "basis-audit", accountId, conid ?? null],
    queryFn: ({ signal }) =>
      inflectApi.inflectBasisAudit({ accountId: accountId as string, conid: conid as number }, signal),
    enabled: Boolean(accountId && conid != null),
  });
}

export function useCreateBasisLot(accountId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: BasisLotUpsertRequest) =>
      inflectApi.inflectCreateBasisLot(accountId as string, body),
    onSuccess: (lot) => {
      invalidateBasisRepair(qc, lot.account_id, lot.conid);
      toast.success("Basis lot saved");
    },
    onError: () => toast.error("Failed to save basis lot"),
  });
}

export function useUpdateBasisLot(accountId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ lotId, body }: { lotId: number; body: BasisLotUpsertRequest }) =>
      inflectApi.inflectUpdateBasisLot(lotId, accountId as string, body),
    onSuccess: (lot) => {
      invalidateBasisRepair(qc, lot.account_id, lot.conid);
      toast.success("Basis lot updated");
    },
    onError: () => toast.error("Failed to update basis lot"),
  });
}

export function useDeleteBasisLot(accountId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ lotId }: { lotId: number; conid: number }) =>
      inflectApi.inflectDeleteBasisLot(lotId, accountId as string),
    onSuccess: (_result, variables) => {
      if (accountId) {
        invalidateBasisRepair(qc, accountId, variables.conid);
      }
      toast.success("Basis lot deleted");
    },
    onError: () => toast.error("Failed to delete basis lot"),
  });
}

