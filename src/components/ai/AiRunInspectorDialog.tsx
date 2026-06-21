import { Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  AIAnalysisPreview,
  AIComparisonResponse,
  AIComparisonSide,
  AIRunAttempt,
  AIRunReceipt,
} from "@/modules/parallax/api";
import type { InspectorPhase } from "@/hooks/useAiRunInspector";

interface Props {
  open: boolean;
  preview: AIAnalysisPreview | null;
  rejectedOutput?: string | null;
  receipt?: AIRunReceipt | null;
  comparison?: AIComparisonResponse | null;
  localReady?: boolean;
  isComparing?: boolean;
  runActive?: boolean;
  compareError?: Error | null;
  error?: Error | null;
  phase?: InspectorPhase;
  initialTab?: "summary" | "payload" | "receipt" | "unverified";
  onOpenChange: (open: boolean) => void;
  onConfirm: (snapshotId: string) => void;
  onCompare?: () => void;
}

export default function AiRunInspectorDialog({
  open,
  preview,
  rejectedOutput = null,
  receipt = null,
  comparison = null,
  localReady = false,
  isComparing = false,
  runActive = false,
  compareError = null,
  error = null,
  phase = "review",
  initialTab = "summary",
  onOpenChange,
  onConfirm,
  onCompare,
}: Props) {
  const payload = preview ? JSON.stringify(preview.request_body, null, 2) : null;
  const money = (value: string) => `$${Number(value).toFixed(4)}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid h-[calc(100dvh-1rem)] min-w-0 max-w-[calc(100%-1rem)] grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr_auto] sm:h-auto sm:max-h-[85vh] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{preview ? "Review Cloud Run" : "AI Run Inspector"}</DialogTitle>
          <DialogDescription>
            {preview
              ? "Inspect the exact OpenRouter request before sending it."
              : "Review metadata retained for this AI run."}
          </DialogDescription>
          {error && <p role="alert" className="text-xs text-destructive">{error.message}</p>}
        </DialogHeader>

        <Tabs
          key={initialTab}
          defaultValue={initialTab}
          className="min-h-0 min-w-0 max-w-full"
        >
          <TabsList>
            <TabsTrigger value="summary">Summary</TabsTrigger>
            <TabsTrigger value="payload">Payload</TabsTrigger>
            <TabsTrigger value="receipt">Receipt</TabsTrigger>
            <TabsTrigger value="compare">Compare</TabsTrigger>
            {rejectedOutput && <TabsTrigger value="unverified">Unverified</TabsTrigger>}
          </TabsList>
          <TabsContent value="summary" className="min-h-0 min-w-0 max-w-full overflow-y-auto">
            {preview ? (
              <>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
                  <dt className="text-muted-foreground">Provider</dt><dd>OpenRouter</dd>
                  <dt className="text-muted-foreground">Model</dt><dd>{preview.model.name}</dd>
                  <dt className="text-muted-foreground">Estimated</dt><dd>{money(preview.cost.estimated_cost_usd)}</dd>
                  <dt className="text-muted-foreground">Maximum</dt><dd>{money(preview.cost.maximum_cost_usd)}</dd>
                  <dt className="text-muted-foreground">Fallback</dt><dd>{preview.fallback_enabled ? "Local Ollama" : "Disabled"}</dd>
                  <dt className="text-muted-foreground">Expires</dt><dd>{new Date(preview.expires_at).toLocaleTimeString()}</dd>
                </dl>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Disclosure title="Sent to cloud" items={preview.disclosure.sent_to_cloud} />
                  <Disclosure title="Kept local" items={preview.disclosure.kept_local} />
                </div>
              </>
            ) : receipt ? <ReceiptSummary receipt={receipt} /> : null}
          </TabsContent>
          <TabsContent value="payload" className="relative min-h-0 min-w-0 max-w-full overflow-y-auto">
            {payload ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  title="Copy payload"
                  aria-label="Copy payload"
                  className="absolute right-2 top-2"
                  onClick={() => void navigator.clipboard?.writeText(payload)}
                >
                  <Copy />
                </Button>
                <pre
                  data-testid="ai-run-payload"
                  className="max-h-[55vh] max-w-full overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 pr-10 text-[11px] leading-relaxed"
                >
                  {payload}
                </pre>
              </>
            ) : (
              <p className="py-6 text-center text-xs text-muted-foreground">
                Exact payload expired by design.
              </p>
            )}
          </TabsContent>
          <TabsContent value="receipt" className="min-h-0 min-w-0 max-w-full overflow-y-auto">
            {receipt ? <ReceiptDetails receipt={receipt} /> : (
              <p className="py-6 text-center text-xs text-muted-foreground">
                Receipt available after the run completes.
              </p>
            )}
          </TabsContent>
          {rejectedOutput && (
            <TabsContent value="unverified" className="relative min-h-0 min-w-0 max-w-full overflow-y-auto">
              <p className="mb-2 text-xs text-muted-foreground">
                Raw model output — not verified. Grounding checks failed.
              </p>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                title="Copy output"
                aria-label="Copy unverified output"
                className="absolute right-2 top-2"
                onClick={() => void navigator.clipboard?.writeText(rejectedOutput)}
              >
                <Copy />
              </Button>
              <pre
                data-testid="ai-rejected-output"
                className="max-h-[55vh] max-w-full overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 pr-10 text-[11px] leading-relaxed"
              >
                {rejectedOutput}
              </pre>
            </TabsContent>
          )}
          <TabsContent value="compare" className="min-h-0 min-w-0 max-w-full overflow-y-auto">
            <p className="mb-3 text-xs text-muted-foreground">
              Same prepared market facts and prompt.
            </p>
            {comparison ? <ComparisonDetails comparison={comparison} /> : (
              <div className="space-y-3 text-xs">
                <p className="text-muted-foreground">
                  {localReady
                    ? "Run both providers to compare completeness, latency, and cost."
                    : "A ready local Ollama model is required for comparison."}
                </p>
                {compareError && <p role="alert" className="text-destructive">{compareError.message}</p>}
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    !preview || !localReady || isComparing || runActive
                    || phase === "submitting" || phase === "running"
                  }
                  onClick={onCompare}
                >
                  {isComparing ? "Comparing..." : "Run comparison"}
                </Button>
              </div>
            )}
          </TabsContent>
        </Tabs>

        {preview && (phase === "review" || phase === "submitting") && (
          <DialogFooter>
            <Button
              disabled={phase !== "review"}
              onClick={() => onConfirm(preview.snapshot_id)}
            >
              {phase === "submitting"
                ? "Sending..."
                : `Send to OpenRouter · max ${money(preview.cost.maximum_cost_usd)}`}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ComparisonDetails({ comparison }: { comparison: AIComparisonResponse }) {
  return (
    <div className="space-y-4 text-xs">
      <div className="grid gap-4 md:grid-cols-2">
        <ComparisonSide title="Local Ollama" side={comparison.local} />
        <ComparisonSide title="OpenRouter" side={comparison.cloud} />
      </div>
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-2 border-t border-border pt-3">
        <span className="font-medium">Measure</span><span>Local</span><span>Cloud</span>
        <ComparisonRow label="Completeness" local={`${comparison.local.quality.checks_count}/5`} cloud={`${comparison.cloud.quality.checks_count}/5`} />
        <ComparisonRow label="Latency" local={`${comparison.local.receipt.attempts[0]?.duration_ms ?? 0} ms`} cloud={`${comparison.cloud.receipt.attempts[0]?.duration_ms ?? 0} ms`} />
        <ComparisonRow label="Cost" local={costLabel(comparison.local)} cloud={costLabel(comparison.cloud)} />
      </div>
    </div>
  );
}

function ComparisonSide({ title, side }: { title: string; side: AIComparisonSide }) {
  return (
    <section className="min-w-0 border-t border-border pt-3">
      <h3 className="font-semibold">{title} · {side.receipt.resolved_model}</h3>
      <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{side.message}</p>
      {side.signal && <p className="mt-2">{side.signal.direction}: {side.signal.description}</p>}
    </section>
  );
}

function ComparisonRow({ label, local, cloud }: { label: string; local: string; cloud: string }) {
  return <><span>{label}</span><span>{local}</span><span>{cloud}</span></>;
}

function costLabel(side: AIComparisonSide) {
  const cost = side.receipt.attempts[0]?.actual_cost_usd;
  return cost ? `$${Number(cost).toFixed(4)}` : "$0.0000";
}

function ReceiptSummary({ receipt }: { receipt: AIRunReceipt }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
      <dt className="text-muted-foreground">Status</dt><dd>{statusLabel(receipt.status)}</dd>
      <dt className="text-muted-foreground">Requested</dt><dd>{receipt.requested_provider} / {receipt.requested_model}</dd>
      <dt className="text-muted-foreground">Executed</dt><dd>{receipt.executed_provider ?? "None"} / {receipt.resolved_model ?? "None"}</dd>
    </dl>
  );
}

function ReceiptDetails({ receipt }: { receipt: AIRunReceipt }) {
  return (
    <div className="space-y-3 text-xs">
      <div className="font-semibold">{statusLabel(receipt.status)}</div>
      {receipt.fallback_reason && (
        <div className="text-muted-foreground">{receipt.fallback_reason}</div>
      )}
      {receipt.attempts.map((attempt, index) => (
        <Attempt key={`${attempt.provider_name}-${index}`} attempt={attempt} />
      ))}
    </div>
  );
}

function Attempt({ attempt }: { attempt: AIRunAttempt }) {
  const provider = attempt.provider_name === "ollama" ? "Local Ollama" : "OpenRouter";
  const outcome = attempt.status === "fallback_success"
    ? "fallback succeeded"
    : attempt.status === "success" ? "succeeded" : attempt.status;
  const cost = attempt.actual_cost_usd !== null
    ? `$${Number(attempt.actual_cost_usd).toFixed(4)} actual`
    : attempt.estimated_cost_usd !== null
      ? `$${Number(attempt.estimated_cost_usd).toFixed(4)} estimated`
      : null;
  return (
    <section className="border-t border-border pt-3">
      <h3 className="font-medium">{provider} {outcome}</h3>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-muted-foreground">
        <dt>Model</dt><dd>{attempt.resolved_model ?? attempt.requested_model ?? "None"}</dd>
        <dt>Tokens</dt><dd>{attempt.input_tokens ?? 0} in / {attempt.output_tokens ?? 0} out</dd>
        <dt>Duration</dt><dd>{attempt.duration_ms} ms</dd>
        {cost && <><dt>Cost</dt><dd>{cost}</dd></>}
        {attempt.provider_request_id && <>
          <dt>Generation</dt>
          <dd className="flex items-center gap-1">
            {attempt.provider_request_id}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Copy generation ID"
              onClick={() => void navigator.clipboard?.writeText(attempt.provider_request_id!)}
            ><Copy /></Button>
          </dd>
        </>}
      </dl>
    </section>
  );
}

function statusLabel(status: AIRunReceipt["status"]) {
  if (status === "fallback_success") return "Fallback succeeded";
  return status[0].toUpperCase() + status.slice(1);
}

function Disclosure({ title, items }: { title: string; items: string[] }) {
  return (
    <section>
      <h3 className="mb-1 text-xs font-semibold">{title}</h3>
      <ul className="space-y-1 text-xs text-muted-foreground">
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </section>
  );
}
