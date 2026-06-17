import { useCallback, useState } from "react";

import {
  parallaxApi,
  type AIAnalysisPreview,
  type AnalyzeRequest,
} from "@/modules/parallax/api";

export function useAiRunInspector(
  startPreparedAnalyze: (snapshotId: string, model: string) => void,
) {
  const [preview, setPreview] = useState<AIAnalysisPreview | null>(null);
  const [open, setOpen] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const review = useCallback(async (request: AnalyzeRequest) => {
    setIsPreviewing(true);
    setError(null);
    try {
      const next = await parallaxApi.aiAnalysisPreview(request);
      setPreview(next);
      setOpen(true);
    } catch (cause) {
      setError(cause as Error);
    } finally {
      setIsPreviewing(false);
    }
  }, []);

  const send = useCallback(() => {
    if (!preview) return;
    startPreparedAnalyze(preview.snapshot_id, preview.model.id);
    setOpen(false);
  }, [preview, startPreparedAnalyze]);

  return { preview, open, setOpen, isPreviewing, error, review, send };
}
