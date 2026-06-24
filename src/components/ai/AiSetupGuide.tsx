/**
 * AiSetupGuide — Inline guidance when Ollama is not ready.
 *
 * Renders different content based on Ollama state:
 *   - not_installed → Install link + instructions
 *   - no_models     → Recommended models with `ollama pull` commands
 *   - error         → Error message + refresh button
 *
 * Fetches the setup guide from GET /ai/setup-guide for platform-specific
 * install links and model recommendations.
 *
 * This component replaces the chat area in the AI panel when AI isn't ready.
 * Once the user installs Ollama and pulls a model, the status poll
 * (useAiStatus) detects the change and the panel switches to the chat view.
 */

import { useQuery } from "@tanstack/react-query";
import { parallaxApi, type RecommendedModel } from "@/modules/parallax/api";
import type { OllamaState } from "@/store";

/* ── Types ── */

interface AiSetupGuideProps {
  ollamaState: OllamaState;
  ollamaError: string | null;
  onRefresh: () => void;
  isRefreshing: boolean;
}

/* ── Sub-components ── */

function ModelCard({ model }: { model: RecommendedModel }) {
  const isRecommended = model.tier === "recommended";

  return (
    <div
      className="rounded-md border px-3 py-2"
      style={{
        borderColor: isRecommended ? "var(--clr-cyan)" : "var(--border)",
        background: isRecommended ? "var(--glow-cyan)" : "transparent",
      }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-foreground">
          {model.display_name}
        </span>
        {isRecommended && (
          <span className="rounded px-1.5 py-0.5 text-[8px] font-bold uppercase text-[var(--clr-cyan)] bg-[var(--glow-cyan)] border border-[var(--clr-cyan)]">
            Recommended
          </span>
        )}
      </div>
      <div className="mt-1 text-[10px] text-[var(--text-3)]">
        {model.description}
      </div>
      <div className="mt-1.5 flex items-center justify-between">
        <span className="text-[9px] text-[var(--text-3)]">
          {model.size_gb}GB &middot; {model.min_ram_gb}GB+ RAM
        </span>
        <code className="rounded bg-[var(--bg-0)] px-1.5 py-0.5 text-[9px] font-mono text-[var(--text-2)]">
          {model.pull_command}
        </code>
      </div>
    </div>
  );
}

/* ── Main component ── */

export default function AiSetupGuide({
  ollamaState,
  ollamaError,
  onRefresh,
  isRefreshing,
}: AiSetupGuideProps) {
  const guideQuery = useQuery({
    queryKey: ["ai", "setup-guide"],
    queryFn: () => parallaxApi.aiSetupGuide(),
    enabled: ollamaState === "not_installed" || ollamaState === "no_models",
    staleTime: 60_000,
  });

  const guide = guideQuery.data;

  return (
    <div className="flex flex-1 flex-col gap-3 p-4">
      {/* ── Not installed ── */}
      {ollamaState === "not_installed" && (
        <>
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-[var(--text-3)]" />
            <span className="text-xs font-semibold text-foreground">
              Ollama Not Installed
            </span>
          </div>

          <p className="text-[11px] text-[var(--text-2)] leading-relaxed">
            AI analysis requires Ollama — a lightweight local LLM runtime.
            It runs entirely on your machine, no cloud required.
          </p>

          {guide && (
            <>
              <a
                href={guide.install_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-1.5 rounded-md border border-[var(--clr-cyan)] bg-[var(--glow-cyan)] px-3 py-2 text-xs font-semibold text-[var(--clr-cyan)] transition-all hover:shadow-[0_0_16px_var(--glow-cyan)]"
              >
                Download Ollama
                <span className="text-[10px]">↗</span>
              </a>

              <p className="text-[10px] text-[var(--text-3)]">
                {guide.install_note}
              </p>
            </>
          )}

          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="mt-2 flex items-center justify-center gap-1.5 rounded-md border border-[var(--border)] px-3 py-1.5 text-[10px] text-[var(--text-3)] transition-all hover:border-[var(--clr-cyan)] hover:text-[var(--clr-cyan)] disabled:opacity-50"
          >
            {isRefreshing ? "Checking..." : "I've installed it — check again"}
          </button>
        </>
      )}

      {/* ── No models installed ── */}
      {ollamaState === "no_models" && (
        <>
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-[var(--clr-orange)] shadow-[0_0_6px_var(--clr-orange)]" />
            <span className="text-xs font-semibold text-foreground">
              No Models Found
            </span>
          </div>

          <p className="text-[11px] text-[var(--text-2)] leading-relaxed">
            Ollama is running but you don't have any models installed yet.
            Open a terminal and pull one of these recommended models:
          </p>

          {guide && (
            <div className="flex flex-col gap-2">
              {guide.recommended_models.map((model) => (
                <ModelCard key={model.name} model={model} />
              ))}
            </div>
          )}

          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="mt-2 flex items-center justify-center gap-1.5 rounded-md border border-[var(--border)] px-3 py-1.5 text-[10px] text-[var(--text-3)] transition-all hover:border-[var(--clr-cyan)] hover:text-[var(--clr-cyan)] disabled:opacity-50"
          >
            {isRefreshing ? "Scanning..." : "I've pulled a model — rescan"}
          </button>
        </>
      )}

      {/* ── Error state ── */}
      {ollamaState === "error" && (
        <>
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-[var(--clr-red)] shadow-[0_0_6px_var(--clr-red)]" />
            <span className="text-xs font-semibold text-foreground">
              Connection Error
            </span>
          </div>

          <p className="text-[11px] text-[var(--clr-red)]">
            {ollamaError || "Could not connect to Ollama."}
          </p>

          <p className="text-[10px] text-[var(--text-3)]">
            Make sure Ollama is running. You can start it from your terminal
            or restart the Ollama application.
          </p>

          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="mt-2 flex items-center justify-center gap-1.5 rounded-md border border-[var(--border)] px-3 py-1.5 text-[10px] text-[var(--text-3)] transition-all hover:border-[var(--clr-cyan)] hover:text-[var(--clr-cyan)] disabled:opacity-50"
          >
            {isRefreshing ? "Retrying..." : "Retry connection"}
          </button>
        </>
      )}

      {/* ── Starting / transient states ── */}
      {(ollamaState === "starting" || ollamaState === "installed") && (
        <div className="flex items-center gap-2 text-[11px] text-[var(--text-3)]">
          <div className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--clr-cyan)] border-t-transparent" />
          Starting Ollama server...
        </div>
      )}

      {/* ── Disabled / not-needed footer ── */}
      <div className="mt-auto rounded-md bg-[var(--bg-0)] px-3 py-2 text-[10px] text-[var(--text-3)]">
        AI is optional — charting, indicators, Fibonacci, screener, and
        triggers all work without it.
      </div>
    </div>
  );
}
