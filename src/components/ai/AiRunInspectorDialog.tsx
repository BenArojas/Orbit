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
import type { AIAnalysisPreview } from "@/modules/parallax/api";

interface Props {
  open: boolean;
  preview: AIAnalysisPreview;
  onOpenChange: (open: boolean) => void;
  onConfirm: (snapshotId: string) => void;
}

export default function AiRunInspectorDialog({
  open,
  preview,
  onOpenChange,
  onConfirm,
}: Props) {
  const payload = JSON.stringify(preview.request_body, null, 2);
  const money = (value: string) => `$${Number(value).toFixed(4)}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[calc(100dvh-1rem)] max-w-[calc(100%-1rem)] grid-rows-[auto_1fr_auto] sm:h-auto sm:max-h-[85vh] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Review Cloud Run</DialogTitle>
          <DialogDescription>
            Inspect the exact OpenRouter request before sending it.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="summary" className="min-h-0">
          <TabsList>
            <TabsTrigger value="summary">Summary</TabsTrigger>
            <TabsTrigger value="payload">Payload</TabsTrigger>
          </TabsList>
          <TabsContent value="summary" className="min-h-0 overflow-y-auto">
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
          </TabsContent>
          <TabsContent value="payload" className="relative min-h-0 overflow-auto">
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
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button onClick={() => onConfirm(preview.snapshot_id)}>
            Send to OpenRouter · max {money(preview.cost.maximum_cost_usd)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
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
