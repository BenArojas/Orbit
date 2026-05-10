/**
 * AiChatPanel — The full AI panel for the Analysis page right sidebar.
 *
 * Composes everything:
 *   - Header with model selector (when ready)
 *   - AiConfigPanel (timeframe/indicator selection + Run Analysis)
 *   - ActionSignalCard (signal result after analysis)
 *   - Chat message list (scrollable, with streaming support)
 *   - Chat input (send follow-up questions)
 *   - AiSetupGuide (shown inline when Ollama isn't ready)
 *
 * State flow:
 *   1. On mount, useAiStatus polls GET /ai/status
 *   2. If not ready → show AiSetupGuide instead of chat
 *   3. If ready → show config + signal + chat
 *   4. "Run Analysis" → POST /ai/analyze → signal + first message appear
 *   5. Follow-up messages → stream via useAiStream
 */

import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from "react";
import { useAiStore, type ChatMessage } from "@/store";
import type { IndicatorId } from "@/store/chart";
import { useAiStatus } from "@/hooks/useAiStatus";
import { useAiStream } from "@/hooks/useAiStream";
import { useAiAnalyzeStream } from "@/hooks/useAiAnalyzeStream";
import AiConfigPanel, { type AiTimeframe, type AiIndicator } from "./AiConfigPanel";
import type { AiContextMode } from "@/lib/api";
import ActionSignalCard from "./ActionSignalCard";
import AiSetupGuide from "./AiSetupGuide";
import AiModelSelector from "./AiModelSelector";
import ResponseTimeBadge from "./ResponseTimeBadge";
import FibScoreCard from "./FibScoreCard";
import type { FibonacciResult } from "@/lib/api";

/* ── Types ── */

interface AiChatPanelProps {
  /** Currently active instrument conid (from chart store) */
  activeConid: number | null;
  /** Currently active symbol string */
  activeSymbol: string;
  /** Current Fibonacci auto-detection result (null if not computed or disabled) */
  fibonacci?: FibonacciResult | null;
  /** Currently active indicators on the chart (used as AI config defaults) */
  chartIndicators?: Set<IndicatorId>;
}

/* ── Message bubble sub-component ── */

function ChatBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className="max-w-[85%] rounded-lg px-3 py-2 text-[11px] leading-relaxed"
        style={{
          background: isUser ? "var(--bg-4)" : "var(--bg-0)",
          color: "var(--text-2)",
          borderBottomRightRadius: isUser ? "2px" : undefined,
          borderBottomLeftRadius: !isUser ? "2px" : undefined,
        }}
      >
        <div className="whitespace-pre-wrap break-words">{msg.content}</div>
      </div>
    </div>
  );
}

/* ── Streaming indicator ── */

function StreamingBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-lg bg-[var(--bg-0)] px-3 py-2 text-[11px] leading-relaxed text-[var(--text-2)]" style={{ borderBottomLeftRadius: "2px" }}>
        <div className="whitespace-pre-wrap break-words">
          {content}
          <span className="inline-block w-1.5 h-3 ml-0.5 bg-[var(--clr-cyan)] animate-pulse rounded-sm" />
        </div>
      </div>
    </div>
  );
}

/* ── Main component ── */

export default function AiChatPanel({ activeConid, activeSymbol, fibonacci, chartIndicators }: AiChatPanelProps) {
  const [inputValue, setInputValue] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Store state — note: setSessionId/addMessage/setSignal/clearChat are now
  // owned by the streaming analyze hook, but we still pull `messages` and
  // `isAnalyzing` for rendering.
  const {
    sessionId,
    messages,
    signal,
    isAnalyzing,
  } = useAiStore();

  // Hooks
  const {
    ollamaState,
    selectedModel,
    availableModels,
    ollamaError,
    isReady,
    selectModel,
    refresh,
    isRefreshing,
  } = useAiStatus();

  const { streamChat, cancelStream, isStreaming, streamingContent } = useAiStream();

  // Streaming analyze — replaces the old useMutation flow. Tokens flow into
  // the same `streamingContent` that the chat-stream hook already drives,
  // so the StreamingBubble keeps working without changes.
  const { startAnalyze, cancelAnalyze } = useAiAnalyzeStream();

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  // ── Handlers ──

  const handleRunAnalysis = useCallback(
    (config: {
      timeframes: AiTimeframe[];
      indicators: AiIndicator[];
      contextMode: AiContextMode;
      contextBars: number;
    }) => {
      if (!isReady || !activeConid || !activeSymbol) return;
      // Streams narrative tokens into streamingContent, then commits the
      // final message + signal + session_id once the SSE `done` event lands.
      void startAnalyze(
        {
          conid: activeConid,
          symbol: activeSymbol,
          timeframes: config.timeframes,
          indicators: config.indicators,
          session_id: sessionId ?? undefined,
          context_mode: config.contextMode,
          context_bars: config.contextBars,
        },
        selectedModel ?? null,
      );
    },
    [isReady, activeConid, activeSymbol, sessionId, selectedModel, startAnalyze],
  );

  /** Abort an in-flight analysis — closes the SSE stream and resets the spinner. */
  const handleCancelAnalysis = useCallback(() => {
    cancelAnalyze();
  }, [cancelAnalyze]);

  const handleSendMessage = useCallback(() => {
    const msg = inputValue.trim();
    if (!msg || !sessionId || isStreaming) return;
    setInputValue("");
    streamChat(sessionId, msg);
  }, [inputValue, sessionId, isStreaming, streamChat]);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // ── Determine what to show ──

  const showSetupGuide =
    ollamaState === "not_installed" ||
    ollamaState === "no_models" ||
    ollamaState === "error" ||
    ollamaState === "starting" ||
    ollamaState === "installed";

  const showChat = isReady || ollamaState === "running";

  return (
    <div className="flex h-full min-h-0 flex-col border-l border-border bg-[var(--bg-1)]">
      {/* ── Header ── */}
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-4 py-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold">
          <div
            className="h-2 w-2 rounded-full"
            style={{
              background: isReady ? "var(--clr-green)" : "var(--clr-orange)",
              boxShadow: isReady
                ? "0 0 10px var(--clr-green)"
                : "0 0 6px var(--clr-orange)",
            }}
          />
          AI Analysis
        </div>

        {/* Model selector + rolling response-time badge */}
        {showChat && availableModels.length > 0 && (
          <div className="flex items-center gap-1.5">
            <ResponseTimeBadge selectedModel={selectedModel} />
            <AiModelSelector
              models={availableModels}
              selectedModel={selectedModel}
              onSelect={selectModel}
              onRefresh={refresh}
              isRefreshing={isRefreshing}
            />
          </div>
        )}
      </div>

      {/* ── Setup guide (when not ready) ── */}
      {showSetupGuide && (
        <AiSetupGuide
          ollamaState={ollamaState}
          ollamaError={ollamaError}
          onRefresh={refresh}
          isRefreshing={isRefreshing}
        />
      )}

      {/* ── Ready state: config + signal + chat ── */}
      {showChat && (
        <>
          {/* Config panel — defaults to whatever indicators are on the chart */}
          <AiConfigPanel
            onRunAnalysis={handleRunAnalysis}
            chartIndicators={chartIndicators}
          />

          {/* Signal card */}
          <ActionSignalCard signal={signal} />

          {/* Fibonacci score card (below signal, above chat) */}
          {fibonacci && (
            <div className="px-3 pb-1">
              <FibScoreCard fibonacci={fibonacci} />
            </div>
          )}

          {/* Chat messages — flex-1 + min-h-0 so the scroll area can actually shrink
              below its content height. Without min-h-0, flex items default to
              min-height: auto and the scroll never engages. */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              <div className="flex flex-col gap-2.5">
                {/* Initial prompt when no messages */}
                {messages.length === 0 && !isAnalyzing && (
                  <div className="rounded-lg bg-[var(--bg-0)] px-3 py-2 text-[11px] text-[var(--text-2)]">
                    {activeSymbol
                      ? `${activeSymbol} loaded. Hit "Run Analysis" or ask me anything.`
                      : "Select a stock to begin."}
                  </div>
                )}

                {/* Signal-extraction-failed notice. The backend returned
                    a narrative successfully but couldn't parse the trailing
                    JSON block (model omitted it OR the reformat fallback
                    timed out). The full analysis is still useful, but the
                    ActionSignalCard will be empty — explain why so the user
                    isn't confused by the blank card. */}
                {!isAnalyzing && !signal && messages.length > 0 && (
                  <div className="rounded-md border border-[var(--clr-amber,#ff9f1c)] bg-[rgba(255,159,28,0.08)] px-3 py-2 text-[10px] leading-relaxed text-[var(--clr-amber,#ff9f1c)]">
                    <span className="font-semibold">Signal couldn't be parsed.</span>
                    {" "}The model returned an analysis but didn't produce a
                    structured trade signal in the expected format. The full
                    reasoning is below — you can still ask follow-up questions
                    or re-run analysis.
                  </div>
                )}

                {/* Loading state for analysis — with Cancel button */}
                {isAnalyzing && (
                  <div className="flex items-center gap-2 rounded-lg bg-[var(--bg-0)] px-3 py-2 text-[11px] text-[var(--text-3)]">
                    <div className="h-3 w-3 flex-shrink-0 animate-spin rounded-full border-2 border-[var(--clr-cyan)] border-t-transparent" />
                    <span className="flex-1">Analyzing {activeSymbol}…</span>
                    <button
                      onClick={handleCancelAnalysis}
                      className="rounded border border-[var(--clr-red)] px-1.5 py-0.5 text-[9px] font-medium text-[var(--clr-red)] transition-colors hover:bg-[rgba(255,68,102,0.1)]"
                      title="Cancel analysis"
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {/* Message history */}
                {messages.map((msg) => (
                  <ChatBubble key={msg.id} msg={msg} />
                ))}

                {/* Streaming response */}
                {isStreaming && streamingContent && (
                  <StreamingBubble content={streamingContent} />
                )}

                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Chat input — shrink-0 so it stays pinned at the bottom and the
                messages area is the one that scrolls. */}
            <div className="flex shrink-0 items-center gap-2 border-t border-[var(--border)] px-3 py-2">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  !sessionId
                    ? "Run analysis first..."
                    : isStreaming
                      ? "Waiting for response..."
                      : "Ask about the chart..."
                }
                disabled={!sessionId || isStreaming}
                className="flex-1 rounded-md border border-[var(--border)] bg-[var(--bg-0)] px-3 py-1.5 text-xs text-foreground placeholder:text-[var(--text-3)] outline-none transition-all focus:border-[var(--clr-cyan)] disabled:opacity-50"
              />

              {isStreaming ? (
                <button
                  onClick={cancelStream}
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--clr-red)] bg-transparent text-[var(--clr-red)] transition-colors hover:bg-[rgba(255,61,87,0.1)]"
                  title="Stop generating"
                >
                  ■
                </button>
              ) : (
                <button
                  onClick={handleSendMessage}
                  disabled={!inputValue.trim() || !sessionId}
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-0)] text-[var(--text-3)] transition-colors hover:border-[var(--clr-cyan)] hover:text-[var(--clr-cyan)] disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  →
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
