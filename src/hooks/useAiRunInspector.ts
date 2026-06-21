import { useCallback, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  parallaxApi,
  type AIAnalysisPreview,
  type AIComparisonResponse,
  type AnalyzeRequest,
} from "@/modules/parallax/api";
import { useAiStore } from "@/store";
import type { PreparedAnalyzeLifecycle } from "./useAiAnalyzeStream";

export type InspectorPhase = "review" | "submitting" | "running" | "completed" | "failed";

export function useAiRunInspector(
  startPreparedAnalyze: (
    snapshotId: string,
    model: string,
    lifecycle?: PreparedAnalyzeLifecycle,
  ) => void,
  localReady = false,
) {
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<AIAnalysisPreview | null>(null);
  const [rejectedOutput, setRejectedOutput] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [comparisonResult, setComparisonResult] = useState<AIComparisonResponse | null>(null);
  const [phase, setPhase] = useState<InspectorPhase>("review");
  const [acceptedRunId, setAcceptedRunId] = useState<string | null>(null);
  const [terminalReceipt, setTerminalReceipt] = useState(
    useAiStore.getState().lastRunReceipt,
  );
  const storedReceipt = useAiStore((state) => state.lastRunReceipt);
  const receipt = terminalReceipt ?? storedReceipt;
  const setLastRunReceipt = useAiStore((state) => state.setLastRunReceipt);
  const comparisonMutation = useMutation({
    mutationFn: (snapshotId: string) => parallaxApi.aiAnalysisCompare(snapshotId),
  });

  const review = useCallback(async (request: AnalyzeRequest) => {
    setIsPreviewing(true);
    setError(null);
    setLastRunReceipt(null);
    setTerminalReceipt(null);
    setAcceptedRunId(null);
    setPhase("review");
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
    if (!preview || phase !== "review") return;
    setPhase("submitting");
    let acceptedForRequest: string | null = null;
    startPreparedAnalyze(preview.snapshot_id, preview.model.id, {
      onAccepted: (runId) => {
        acceptedForRequest = runId;
        setAcceptedRunId(runId);
        setPhase("running");
        setOpen(false);
      },
      onCompleted: async (nextReceipt) => {
        if (nextReceipt) {
          setTerminalReceipt(nextReceipt);
          setPhase("completed");
          return;
        }
        if (!acceptedForRequest) {
          setPhase("completed");
          return;
        }
        const receipts = await queryClient.fetchQuery({
          queryKey: ["ai-runs", 10],
          queryFn: () => parallaxApi.aiRuns(10),
        });
        setTerminalReceipt(
          receipts.find((candidate) => candidate.run_id === acceptedForRequest) ?? null,
        );
        setPhase("completed");
      },
      onRejected: (cause, nextReceipt) => {
        setError(cause);
        setTerminalReceipt(nextReceipt);
        setPhase("failed");
      },
    });
  }, [phase, preview, queryClient, startPreparedAnalyze]);

  const openLastRun = useCallback(() => {
    if (!receipt) return;
    setPhase(receipt.status === "failed" || receipt.status === "blocked"
      ? "failed"
      : "completed");
    setOpen(true);
  }, [receipt]);

  const openRejected = useCallback((text: string) => {
    setRejectedOutput(text);
    setOpen(true);
  }, []);

  const compare = useCallback(async () => {
    if (!preview || !localReady) return;
    setComparisonResult(await comparisonMutation.mutateAsync(preview.snapshot_id));
  }, [comparisonMutation, localReady, preview]);

  return {
    preview,
    rejectedOutput,
    receipt,
    comparison: comparisonResult,
    phase,
    acceptedRunId,
    open,
    setOpen,
    isPreviewing,
    isComparing: comparisonMutation.isPending,
    error,
    compareError: comparisonMutation.error,
    review,
    send,
    openLastRun,
    openRejected,
    compare,
  };
}
