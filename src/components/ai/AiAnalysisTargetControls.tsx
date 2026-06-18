import { Cloud, Cpu } from "lucide-react";

import { useAiStatus } from "@/hooks/useAiStatus";
import { useAiStore } from "@/store";

export default function AiAnalysisTargetControls() {
  const {
    activeProvider = "ollama",
    routingMode,
    providers = [],
    analysisProvider,
    analysisModel,
    analysisFallbackEnabled,
    localFallbackEnabled = true,
    setAnalysisProvider,
    setAnalysisModel,
    setAnalysisFallbackEnabled,
  } = useAiStore();
  const {
    openRouterModels = [],
    openRouterSelectedModel = null,
    isLoadingOpenRouterModels = false,
    openRouterModelsError = null,
    selectOpenRouterModel = () => undefined,
    isSelectingOpenRouterModel = false,
  } = useAiStatus();
  const openRouter = providers.find(
    (provider) => provider.provider_name === "openrouter",
  );
  const target = analysisProvider
    ?? (activeProvider === "openrouter" ? "openrouter" : "ollama");
  const openRouterEnabled = Boolean(
    routingMode !== "local_only" && openRouter?.enabled && openRouter.has_key,
  );
  const fallbackEnabled = analysisFallbackEnabled ?? localFallbackEnabled;
  const selectedModel = analysisModel
    ?? openRouterSelectedModel
    ?? openRouter?.selected_model
    ?? "";

  const chooseTarget = (provider: "ollama" | "openrouter") => {
    setAnalysisProvider(provider);
    if (provider === "openrouter") {
      setAnalysisModel(openRouter?.selected_model ?? null);
    }
  };

  return (
    <div className="border-b border-[var(--border)] px-3 py-2">
      <div className="grid grid-cols-2 gap-1 rounded-md border border-[var(--border)] bg-[var(--bg-0)] p-1">
        <button
          type="button"
          aria-label="Local Ollama"
          aria-pressed={target === "ollama"}
          onClick={() => chooseTarget("ollama")}
          className={`flex h-7 items-center justify-center gap-1.5 rounded px-2 text-[10px] font-medium transition-colors ${
            target === "ollama"
              ? "bg-[var(--bg-3)] text-[var(--clr-cyan)]"
              : "text-[var(--text-3)] hover:text-[var(--text-1)]"
          }`}
        >
          <Cpu size={13} />
          Local Ollama
        </button>
        <button
          type="button"
          aria-label="OpenRouter"
          aria-pressed={target === "openrouter"}
          disabled={!openRouterEnabled}
          onClick={() => chooseTarget("openrouter")}
          className={`flex h-7 items-center justify-center gap-1.5 rounded px-2 text-[10px] font-medium transition-colors ${
            target === "openrouter"
              ? "bg-[var(--bg-3)] text-[var(--clr-cyan)]"
              : "text-[var(--text-3)] hover:text-[var(--text-1)] disabled:cursor-not-allowed disabled:opacity-40"
          }`}
        >
          <Cloud size={13} />
          OpenRouter
        </button>
      </div>
      {target === "openrouter" && openRouterEnabled ? (
        <div className="mt-2 space-y-2">
          {openRouterModelsError ? (
            <div
              role="alert"
              className="rounded border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-[10px] text-red-200"
            >
              {openRouterModelsError}
            </div>
          ) : !isLoadingOpenRouterModels && openRouterModels.length === 0 ? (
            <p className="text-[10px] text-[var(--text-2)]">
              No compatible OpenRouter models available.
            </p>
          ) : (
            <>
              <label
                htmlFor="ai-analysis-openrouter-model"
                className="mb-1 block text-[9px] uppercase text-[var(--text-3)]"
              >
                OpenRouter model
              </label>
              <select
                id="ai-analysis-openrouter-model"
                aria-label="OpenRouter model"
                value={selectedModel}
                disabled={isLoadingOpenRouterModels || isSelectingOpenRouterModel}
                onChange={(event) => selectOpenRouterModel(event.target.value)}
                className="h-7 w-full rounded border border-[var(--border)] bg-[var(--bg-0)] px-2 text-[10px] text-[var(--text-1)] focus:outline-none focus:ring-1 focus:ring-[var(--clr-cyan)]"
              >
                {!selectedModel ? <option value="">Select a model</option> : null}
                {openRouterModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </select>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[10px] text-[var(--text-2)]">Local fallback</span>
                <button
                  type="button"
                  role="switch"
                  aria-label="Local fallback"
                  aria-checked={fallbackEnabled}
                  onClick={() => setAnalysisFallbackEnabled(!fallbackEnabled)}
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors ${
                    fallbackEnabled
                      ? "border-[var(--clr-cyan)] bg-[var(--clr-cyan)]"
                      : "border-[var(--border)] bg-[var(--bg-4)]"
                  }`}
                >
                  <span
                    className={`h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                      fallbackEnabled ? "translate-x-[17px]" : "translate-x-[2px]"
                    }`}
                  />
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
