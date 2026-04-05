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
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAiStore, type ChatMessage } from "@/store";
import { useAiStatus } from "@/hooks/useAiStatus";
import { useAiStream } from "@/hooks/useAiStream";
import AiConfigPanel, { type AiTimeframe, type AiIndicator, type AiMode } from "./AiConfigPanel";
import ActionSignalCard from "./ActionSignalCard";
import AiSetupGuide from "./AiSetupGuide";
import AiModelSelector from "./AiModelSelector";

/* ── Types ── */

interface AiChatPanelProps {
  /** Currently active instrument conid (from chart store) */
  activeConid: number | null;
  /** Currently active symbol string */
  activeSymbol: string;
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

export default function AiChatPanel({ activeConid, activeSymbol }: AiChatPanelProps) {
  const [inputValue, setInputValue] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Store state
  const {
    sessionId,
    messages,
    signal,
    isAnalyzing,
    setSessionId,
    addMessage,
    setSignal,
    setAnalyzing,
    clearChat,
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

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  // ── Run Analysis mutation ──

  const analyzeMutation = useMutation({
    mutationFn: (config: {
      timeframes: AiTimeframe[];
      indicators: AiIndicator[];
    }) => {
      if (!activeConid || !activeSymbol) {
        throw new Error("No symbol selected");
      }
      return api.aiAnalyze({
        conid: activeConid,
        symbol: activeSymbol,
        timeframes: config.timeframes,
        indicators: config.indicators,
        session_id: sessionId ?? undefined,
      });
    },
    onMutate: () => {
      setAnalyzing(true);
      // Clear previous chat but keep config
      clearChat();
    },
    onSuccess: (data) => {
      setSessionId(data.session_id);
      setSignal(data.signal);

      // Add the AI response as the first message
      addMessage({
        id: `msg_${Date.now()}`,
        role: "assistant",
        content: data.message,
        timestamp: Date.now(),
      });
    },
    onError: (err) => {
      addMessage({
        id: `msg_${Date.now()}`,
        role: "assistant",
        content: `[Analysis failed: ${(err as Error).message}]`,
        timestamp: Date.now(),
      });
    },
    onSettled: () => {
      setAnalyzing(false);
    },
  });

  // ── Handlers ──

  const handleRunAnalysis = useCallback(
    (config: { timeframes: AiTimeframe[]; indicators: AiIndicator[]; mode: AiMode }) => {
      if (!isReady || !activeConid) return;
      analyzeMutation.mutate({
        timeframes: config.timeframes,
        indicators: config.indicators,
      });
    },
    [isReady, activeConid, analyzeMutation],
  );

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
    <div className="flex h-full flex-col border-l border-border bg-[var(--bg-1)]">
      {/* ── Header ── */}
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2">
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

        {/* Model selector — only when we have models */}
        {showChat && availableModels.length > 0 && (
          <AiModelSelector
            models={availableModels}
            selectedModel={selectedModel}
            onSelect={selectModel}
            onRefresh={refresh}
            isRefreshing={isRefreshing}
          />
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
          {/* Config panel (existing component) */}
          <AiConfigPanel onRunAnalysis={handleRunAnalysis} />

          {/* Signal card */}
          <ActionSignalCard signal={signal} />

          {/* Chat messages */}
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto px-3 py-3">
              <div className="flex flex-col gap-2.5">
                {/* Initial prompt when no messages */}
                {messages.length === 0 && !isAnalyzing && (
                  <div className="rounded-lg bg-[var(--bg-0)] px-3 py-2 text-[11px] text-[var(--text-2)]">
                    {activeSymbol
                      ? `${activeSymbol} loaded. Hit "Run Analysis" or ask me anything.`
                      : "Select a stock to begin."}
                  </div>
                )}

                {/* Loading state for analysis */}
                {isAnalyzing && (
                  <div className="flex items-center gap-2 rounded-lg bg-[var(--bg-0)] px-3 py-2 text-[11px] text-[var(--text-3)]">
                    <div className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--clr-cyan)] border-t-transparent" />
                    Analyzing {activeSymbol}...
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

            {/* Chat input */}
            <div className="flex items-center gap-2 border-t border-[var(--border)] px-3 py-2">
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
