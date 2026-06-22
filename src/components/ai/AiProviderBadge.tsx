import { Cloud, Cpu, RotateCcw } from "lucide-react";
import type { AIProviderKind, AIProviderName } from "@/modules/parallax/api";

const PROVIDER_LABELS: Record<AIProviderName, string> = {
  ollama: "Ollama",
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
  grok: "Grok",
  openrouter: "OpenRouter",
};

interface AiProviderBadgeProps {
  providerName: AIProviderName;
  model: string | null;
  kind: AIProviderKind;
  fallbackUsed: boolean;
  estimatedCost: number | null;
  actualCost: number | null;
}

function formatCost(value: number | null): string | null {
  if (value == null) return null;
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

export default function AiProviderBadge({
  providerName,
  model,
  kind,
  fallbackUsed,
  estimatedCost,
  actualCost,
}: AiProviderBadgeProps) {
  const cost = actualCost == null
    ? formatCost(estimatedCost)
    : formatCost(actualCost);
  const costLabel = cost == null
    ? null
    : `${actualCost == null ? "Estimated" : "Actual"} ${cost}`;
  const Icon = kind === "local" ? Cpu : Cloud;

  return (
    <div className="flex w-full min-w-0 items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-0)] px-2 py-1 text-[10px] text-[var(--text-2)]">
      <Icon size={12} className="shrink-0 text-[var(--clr-cyan)]" />
      <span className="font-medium">{kind === "local" ? "Local" : "Cloud"}</span>
      <span className="text-[var(--text-3)]">{PROVIDER_LABELS[providerName]}</span>
      {model && (
        <span
          title={model}
          className="min-w-0 flex-1 truncate font-mono text-[var(--text-3)]"
        >
          {model}
        </span>
      )}
      {costLabel && (
        <span className="shrink-0 font-mono text-[var(--text-3)]">{costLabel}</span>
      )}
      {fallbackUsed && (
        <span className="inline-flex shrink-0 items-center gap-1 rounded border border-[var(--clr-amber,#ff9f1c)] px-1 py-0.5 text-[9px] text-[var(--clr-amber,#ff9f1c)]">
          <RotateCcw size={10} />
          Fallback
        </span>
      )}
    </div>
  );
}
