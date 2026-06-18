import { useCallback, useState } from "react";
import { useMutation } from "@tanstack/react-query";

import {
  parallaxApi,
  type AIAnalysisPreview,
  type AIComparisonResponse,
  type AnalyzeRequest,
} from "@/modules/parallax/api";
import { useAiStore } from "@/store";

export function useAiRunInspector(
  startPreparedAnalyze: (snapshotId: string, model: string) => void,
  localReady = false,
) {
  const [preview, setPreview] = useState<AIAnalysisPreview | null>(null);
  const [open, setOpen] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [comparisonResult, setComparisonResult] = useState<AIComparisonResponse | null>(null);
  const receipt = useAiStore((state) => state.lastRunReceipt);
  const setLastRunReceipt = useAiStore((state) => state.setLastRunReceipt);
  const comparisonMutation = useMutation({
    mutationFn: (snapshotId: string) => parallaxApi.aiAnalysisCompare(snapshotId),
  });

  const review = useCallback(async (request: AnalyzeRequest) => {
    setIsPreviewing(true);
    setError(null);
    setLastRunReceipt(null);
    setComparisonResult(null);
    comparisonMutation.reset();
    try {
      const next = await parallaxApi.aiAnalysisPreview(request);
      setPreview(next);
      setOpen(true);
    } catch (cause) {
      setError(cause as Error);
    } finally {
      setIsPreviewing(false);
    }
  }, [comparisonMutation, setLastRunReceipt]);

  const send = useCallback(() => {
    if (!preview) return;
    startPreparedAnalyze(preview.snapshot_id, preview.model.id);
  }, [preview, startPreparedAnalyze]);

  const compare = useCallback(async () => {
    if (!preview || !localReady) return;
    setComparisonResult(await comparisonMutation.mutateAsync(preview.snapshot_id));
  }, [comparisonMutation, localReady, preview]);

  return {
    preview,
    receipt,
    comparison: comparisonResult,
    open,
    setOpen,
    isPreviewing,
    isComparing: comparisonMutation.isPending,
    error,
    compareError: comparisonMutation.error,
    review,
    send,
    compare,
  };
}
