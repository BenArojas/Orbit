/**
 * AiModelSelector — Dropdown to pick from installed Ollama models.
 *
 * Shown in the AI panel header when Ollama is ready or has models.
 * The user can switch models on the fly — the selection is persisted
 * to SQLite via POST /ai/models/select.
 *
 * Compact design: a small dropdown that shows model name + size,
 * plus a "rescan" button for when the user pulls a new model.
 */

import { useState } from "react";
import type { OllamaModelResponse } from "@/lib/api";

interface AiModelSelectorProps {
  models: OllamaModelResponse[];
  selectedModel: string | null;
  onSelect: (model: string) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}

export default function AiModelSelector({
  models,
  selectedModel,
  onSelect,
  onRefresh,
  isRefreshing,
}: AiModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);

  const currentModel = models.find((m) => m.name === selectedModel);

  return (
    <div className="relative">
      {/* Trigger button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-0)] px-2 py-1 text-[10px] transition-all hover:border-[var(--clr-cyan)]"
      >
        <div className="h-1.5 w-1.5 rounded-full bg-[var(--clr-green)] shadow-[0_0_6px_var(--clr-green)]" />
        <span className="font-medium text-[var(--text-2)] max-w-[120px] truncate">
          {currentModel?.name || selectedModel || "Select model"}
        </span>
        <span className="text-[var(--text-3)]">
          {currentModel ? `${currentModel.size_gb.toFixed(1)}GB` : ""}
        </span>
        <span className="text-[8px] text-[var(--text-3)]">{isOpen ? "▲" : "▼"}</span>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-[220px] rounded-md border border-[var(--border)] bg-[var(--bg-1)] shadow-lg shadow-black/40">
          {/* Model list */}
          <div className="max-h-[200px] overflow-y-auto py-1">
            {models.length === 0 ? (
              <div className="px-3 py-2 text-[10px] text-[var(--text-3)]">
                No models found
              </div>
            ) : (
              models.map((model) => (
                <button
                  key={model.name}
                  onClick={() => {
                    onSelect(model.name);
                    setIsOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-[var(--bg-3)]"
                >
                  <div
                    className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
                    style={{
                      background:
                        model.name === selectedModel
                          ? "var(--clr-cyan)"
                          : "var(--border)",
                      boxShadow:
                        model.name === selectedModel
                          ? "0 0 6px var(--clr-cyan)"
                          : "none",
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] font-medium text-foreground truncate">
                      {model.name}
                    </div>
                    <div className="text-[8px] text-[var(--text-3)]">
                      {model.size_gb.toFixed(1)}GB &middot; {model.family} &middot; {model.quantization}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Rescan button */}
          <div className="border-t border-[var(--border)] p-1.5">
            <button
              onClick={() => {
                onRefresh();
                setIsOpen(false);
              }}
              disabled={isRefreshing}
              className="flex w-full items-center justify-center gap-1 rounded px-2 py-1 text-[9px] text-[var(--text-3)] transition-all hover:bg-[var(--bg-3)] hover:text-[var(--clr-cyan)] disabled:opacity-50"
            >
              {isRefreshing ? "Scanning..." : "Rescan models"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
