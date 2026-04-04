/**
 * AI Store — Zustand state for the AI analysis panel
 *
 * Tracks:
 *   - Ollama connection state (is it installed, running, ready?)
 *   - Selected model
 *   - Active chat session (messages, signal, streaming state)
 *   - Analysis loading/error states
 *
 * This store survives page navigation — switching to Dashboard and back
 * keeps the chat history and last signal intact.
 *
 * Model selection is persisted to SQLite via the backend (POST /ai/models/select).
 * This store only holds the runtime state — the backend is the source of truth.
 */

import { create } from "zustand";
import type { SignalData } from "@/components/ai";
import type { AiStatusResponse, OllamaModelResponse } from "@/lib/api";

/* ── Types ── */

export type OllamaState =
  | "not_installed"
  | "installed"
  | "starting"
  | "running"
  | "no_models"
  | "ready"
  | "error";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

interface AiState {
  /* ── Ollama status ── */
  ollamaState: OllamaState;
  selectedModel: string | null;
  availableModels: OllamaModelResponse[];
  platform: string;
  ollamaError: string | null;

  /* ── Chat session ── */
  sessionId: string | null;
  messages: ChatMessage[];
  signal: SignalData | null;

  /* ── Loading states ── */
  isAnalyzing: boolean;
  isStreaming: boolean;
  streamingContent: string;

  /* ── Actions: Ollama ── */
  setOllamaStatus: (status: AiStatusResponse) => void;
  setAvailableModels: (models: OllamaModelResponse[]) => void;

  /* ── Actions: Chat ── */
  setSessionId: (id: string) => void;
  addMessage: (msg: ChatMessage) => void;
  setSignal: (signal: SignalData | null) => void;
  clearChat: () => void;

  /* ── Actions: Loading ── */
  setAnalyzing: (v: boolean) => void;
  setStreaming: (v: boolean) => void;
  setStreamingContent: (content: string) => void;
  appendStreamingContent: (chunk: string) => void;
}

/* ── Store ── */

export const useAiStore = create<AiState>()((set) => ({
  // Ollama status
  ollamaState: "not_installed",
  selectedModel: null,
  availableModels: [],
  platform: "",
  ollamaError: null,

  // Chat session
  sessionId: null,
  messages: [],
  signal: null,

  // Loading
  isAnalyzing: false,
  isStreaming: false,
  streamingContent: "",

  // ── Ollama actions ──

  setOllamaStatus: (status) =>
    set({
      ollamaState: status.state,
      selectedModel: status.selected_model,
      platform: status.platform,
      ollamaError: status.error,
    }),

  setAvailableModels: (models) => set({ availableModels: models }),

  // ── Chat actions ──

  setSessionId: (id) => set({ sessionId: id }),

  addMessage: (msg) =>
    set((state) => ({ messages: [...state.messages, msg] })),

  setSignal: (signal) => set({ signal }),

  clearChat: () =>
    set({
      sessionId: null,
      messages: [],
      signal: null,
      streamingContent: "",
    }),

  // ── Loading actions ──

  setAnalyzing: (v) => set({ isAnalyzing: v }),

  setStreaming: (v) => set({ isStreaming: v }),

  setStreamingContent: (content) => set({ streamingContent: content }),

  appendStreamingContent: (chunk) =>
    set((state) => ({
      streamingContent: state.streamingContent + chunk,
    })),
}));
