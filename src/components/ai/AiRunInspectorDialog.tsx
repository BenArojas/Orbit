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
import type { AIAnalysisPreview, AIRunAttempt, AIRunReceipt } from "@/modules/parallax/api";

interface Props {
  open: boolean;
  preview: AIAnalysisPreview | null;
  receipt?: AIRunReceipt | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (snapshotId: string) => void;
}

export default function AiRunInspectorDialog({
  open,
  preview,
  receipt = null,
  onOpenChange,
  onConfirm,
}: Props) {
  const payload = preview ? JSON.stringify(preview.request_body, null, 2) : null;
  const money = (value: string) => `$${Number(value).toFixed(4)}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[calc(100dvh-1rem)] max-w-[calc(100%-1rem)] grid-rows-[auto_1fr_auto] sm:h-auto sm:max-h-[85vh] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{preview ? "Review Cloud Run" : "AI Run Inspector"}</DialogTitle>
          <DialogDescription>
            {preview
              ? "Inspect the exact OpenRouter request before sending it."
              : "Review metadata retained for this AI run."}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="summary" className="min-h-0">
          <TabsList>
            <TabsTrigger value="summary">Summary</TabsTrigger>
            <TabsTrigger value="payload">Payload</TabsTrigger>
            <TabsTrigger value="receipt">Receipt</TabsTrigger>
          </TabsList>
          <TabsContent value="summary" className="min-h-0 overflow-y-auto">
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
          <TabsContent value="payload" className="relative min-h-0 overflow-auto">
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
                <pre className="max-h-[55vh] overflow-auto rounded-md bg-muted p-3 pr-10 text-[11px] leading-relaxed">
                  {payload}
                </pre>
              </>
            ) : (
              <p className="py-6 text-center text-xs text-muted-foreground">
                Exact payload expired by design.
              </p>
            )}
          </TabsContent>
          <TabsContent value="receipt" className="min-h-0 overflow-y-auto">
            {receipt ? <ReceiptDetails receipt={receipt} /> : (
              <p className="py-6 text-center text-xs text-muted-foreground">
                Receipt available after the run completes.
              </p>
            )}
          </TabsContent>
        </Tabs>

        {preview && (
          <DialogFooter>
            <Button onClick={() => onConfirm(preview.snapshot_id)}>
              Send to OpenRouter · max {money(preview.cost.maximum_cost_usd)}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
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
  return (
    <section className="border-t border-border pt-3">
      <h3 className="font-medium">{provider} {outcome}</h3>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-muted-foreground">
        <dt>Model</dt><dd>{attempt.resolved_model ?? attempt.requested_model ?? "None"}</dd>
        <dt>Tokens</dt><dd>{attempt.input_tokens ?? 0} in / {attempt.output_tokens ?? 0} out</dd>
        <dt>Duration</dt><dd>{attempt.duration_ms} ms</dd>
        {attempt.actual_cost_usd && <><dt>Cost</dt><dd>${Number(attempt.actual_cost_usd).toFixed(4)} actual</dd></>}
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
