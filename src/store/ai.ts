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
import type {
  AIProviderMetadata,
  AIRunReceipt,
  AIProviderName,
  AIProviderStatus,
  AIProvidersResponse,
  AIRoutingPolicyResponse,
  AIRoutingMode,
  AiStatusResponse,
  OllamaModelResponse,
} from "@/modules/parallax/api";

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

/**
 * One recorded analysis-completion sample. Kept in-memory for the session
 * only — restarts wipe the history. The model field captures *which* model
 * produced this run, so the rolling avg can be filtered to the user's
 * currently-selected model rather than mixing samples across models.
 */
export interface ResponseTimeSample {
  durationMs: number;
  model: string | null;
  at: number; // unix ms
}

/** Cap the in-memory ring buffer. ~50 samples is plenty for a rolling avg. */
const RESPONSE_TIME_CAP = 50;

interface AiState {
  /* ── Ollama status ── */
  ollamaState: OllamaState;
  selectedModel: string | null;
  availableModels: OllamaModelResponse[];
  platform: string;
  ollamaError: string | null;
  providers: AIProviderStatus[];
  activeProvider: AIProviderName;
  routingMode: AIRoutingMode;
  cloudEnabled: boolean;
  localFallbackEnabled: boolean;
  perCallCostCapUsd: number;
  monthlyCostCapUsd: number;
  lastProviderMetadata: AIProviderMetadata | null;
  lastRunReceipt: AIRunReceipt | null;
  analysisProvider: AIProviderName | null;
  analysisModel: string | null;
  analysisFallbackEnabled: boolean | null;

  /* ── Chat session ── */
  sessionId: string | null;
  messages: ChatMessage[];
  signal: SignalData | null;

  /* ── Loading states ── */
  isAnalyzing: boolean;
  isStreaming: boolean;
  streamingContent: string;

  /* ── Response-time tracking (in-memory, session-only) ── */
  responseTimes: ResponseTimeSample[];

  /* ── Actions: Ollama ── */
  setOllamaStatus: (status: AiStatusResponse) => void;
  setAvailableModels: (models: OllamaModelResponse[]) => void;
  setProvidersStatus: (status: AIProvidersResponse) => void;
  updateProviderStatus: (provider: AIProviderStatus) => void;
  setRoutingPolicy: (policy: AIRoutingPolicyResponse) => void;
  setLastProviderMetadata: (metadata: AIProviderMetadata | null) => void;
  setLastRunReceipt: (receipt: AIRunReceipt | null) => void;
  setAnalysisProvider: (provider: AIProviderName) => void;
  setAnalysisModel: (model: string | null) => void;
  setAnalysisFallbackEnabled: (enabled: boolean) => void;

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

  /* ── Actions: Response-time tracking ── */
  pushResponseTime: (sample: ResponseTimeSample) => void;
}

/* ── Store ── */

export const useAiStore = create<AiState>()((set) => ({
  // Ollama status
  ollamaState: "not_installed",
  selectedModel: null,
  availableModels: [],
  platform: "",
  ollamaError: null,
  providers: [],
  activeProvider: "ollama",
  routingMode: "local_only",
  cloudEnabled: false,
  localFallbackEnabled: true,
  perCallCostCapUsd: 1,
  monthlyCostCapUsd: 25,
  lastProviderMetadata: null,
  lastRunReceipt: null,
  analysisProvider: null,
  analysisModel: null,
  analysisFallbackEnabled: null,

  // Chat session
  sessionId: null,
  messages: [],
  signal: null,

  // Loading
  isAnalyzing: false,
  isStreaming: false,
  streamingContent: "",

  // Response-time samples — never persisted, never sent to backend
  responseTimes: [],

  // ── Ollama actions ──

  setOllamaStatus: (status) =>
    set({
      ollamaState: status.state,
      selectedModel: status.selected_model,
      platform: status.platform,
      ollamaError: status.error,
    }),

  setAvailableModels: (models) => set({ availableModels: models }),

  setProvidersStatus: (status) =>
    set({
      providers: status.providers,
      activeProvider: status.active_provider,
      routingMode: status.routing_mode,
      cloudEnabled: status.cloud_enabled,
    }),

  updateProviderStatus: (provider) =>
    set((state) => ({
      providers: state.providers.map((existing) =>
        existing.provider_name === provider.provider_name ? provider : existing
      ),
    })),

  setRoutingPolicy: (policy) =>
    set({
      activeProvider: policy.active_provider,
      routingMode: policy.routing_mode,
      localFallbackEnabled: policy.local_fallback_enabled,
      perCallCostCapUsd: policy.per_call_cost_cap_usd,
      monthlyCostCapUsd: policy.monthly_cost_cap_usd,
    }),

  setLastProviderMetadata: (metadata) => set({ lastProviderMetadata: metadata }),
  setLastRunReceipt: (receipt) => set({ lastRunReceipt: receipt }),

  setAnalysisProvider: (provider) => set({ analysisProvider: provider }),

  setAnalysisModel: (model) => set({ analysisModel: model }),

  setAnalysisFallbackEnabled: (enabled) =>
    set({ analysisFallbackEnabled: enabled }),

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
      lastProviderMetadata: null,
      lastRunReceipt: null,
    }),

  // ── Loading actions ──

  setAnalyzing: (v) => set({ isAnalyzing: v }),

  setStreaming: (v) => set({ isStreaming: v }),

  setStreamingContent: (content) => set({ streamingContent: content }),

  appendStreamingContent: (chunk) =>
    set((state) => ({
      streamingContent: state.streamingContent + chunk,
    })),

  // ── Response-time actions ──

  pushResponseTime: (sample) =>
    set((state) => {
      const next = [...state.responseTimes, sample];
      // Keep only the last RESPONSE_TIME_CAP samples (FIFO ring)
      const trimmed =
        next.length > RESPONSE_TIME_CAP
          ? next.slice(next.length - RESPONSE_TIME_CAP)
          : next;
      return { responseTimes: trimmed };
    }),
}));
