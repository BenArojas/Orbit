/**
 * AI Components — barrel export
 *
 * Phase 4 AI panel UI:
 *   - AiConfigPanel: timeframe + indicator picker + Run Analysis button (task 4.7)
 *   - ActionSignalCard: direction, confidence, levels, checks display (task 4.8)
 *   - AiChatPanel: full AI panel — setup guide, chat, streaming (task 4.9)
 *   - AiSetupGuide: inline guidance when Ollama isn't ready (task 4.9)
 *   - AiModelSelector: dropdown to switch models (task 4.9)
 */

export { default as AiConfigPanel } from "./AiConfigPanel";
export type { AiTimeframe, AiIndicator, AiMode } from "./AiConfigPanel";

export { default as ActionSignalCard } from "./ActionSignalCard";
export type {
  SignalData,
  SignalDirection,
  SignalLevel,
  SignalCheck,
} from "./ActionSignalCard";

export { default as AiChatPanel } from "./AiChatPanel";
export { default as AiSetupGuide } from "./AiSetupGuide";
export { default as AiModelSelector } from "./AiModelSelector";
