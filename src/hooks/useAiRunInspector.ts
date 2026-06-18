import { useCallback, useState } from "react";

import {
  parallaxApi,
  type AIAnalysisPreview,
  type AnalyzeRequest,
} from "@/modules/parallax/api";
import { useAiStore } from "@/store";

export function useAiRunInspector(
  startPreparedAnalyze: (snapshotId: string, model: string) => void,
) {
  const [preview, setPreview] = useState<AIAnalysisPreview | null>(null);
  const [open, setOpen] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const receipt = useAiStore((state) => state.lastRunReceipt);
  const setLastRunReceipt = useAiStore((state) => state.setLastRunReceipt);

  const review = useCallback(async (request: AnalyzeRequest) => {
    setIsPreviewing(true);
    setError(null);
    setLastRunReceipt(null);
    try {
      const next = await parallaxApi.aiAnalysisPreview(request);
      setPreview(next);
      setOpen(true);
    } catch (cause) {
      setError(cause as Error);
    } finally {
      setIsPreviewing(false);
    }
  }, [setLastRunReceipt]);

  const send = useCallback(() => {
    if (!preview) return;
    startPreparedAnalyze(preview.snapshot_id, preview.model.id);
  }, [preview, startPreparedAnalyze]);

  return { preview, receipt, open, setOpen, isPreviewing, error, review, send };
}
