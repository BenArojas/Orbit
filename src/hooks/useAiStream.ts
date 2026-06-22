/**
 * useAiStream — SSE streaming hook for AI chat responses.
 *
 * Connects to POST /ai/chat/stream and yields tokens as they arrive,
 * giving the "typing" effect. Uses fetch + ReadableStream (not EventSource)
 * because the endpoint is a POST with a JSON body.
 *
 * Flow:
 *   1. User sends a message → addMessage(user msg) to store
 *   2. Call streamChat(sessionId, message)
 *   3. Tokens arrive → appendStreamingContent() in store
 *   4. When done → full response saved as assistant message
 *   5. If response contains a signal update → parsed and set in store
 */

import { useCallback, useRef } from "react";
import { useAiStore } from "@/store";

import { API_BASE } from "@/config/endpoints";

/** Generate a simple unique ID for messages */
function msgId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function useAiStream() {
  const {
    isStreaming,
    streamingContent,
    addMessage,
    setStreaming,
    setStreamingContent,
    appendStreamingContent,
    setSignal,
  } = useAiStore();

  const abortRef = useRef<AbortController | null>(null);

  function handlePayload(
    payload: string,
    append: (chunk: string) => void,
  ): {
    done?: boolean;
    finalMessage?: string;
    finalSignal?: unknown;
    error?: string;
    rawChunk?: string;
  } {
    if (payload === "[DONE]") return { done: true };
    try {
      const event = JSON.parse(payload) as {
        type?: string;
        content?: string;
        message?: string;
        signal?: unknown;
      };
      if (event.type === "token" && typeof event.content === "string") {
        append(event.content);
        return { rawChunk: event.content };
      }
      if (event.type === "done") {
        return { done: true, finalMessage: event.message ?? "", finalSignal: event.signal };
      }
      if (event.type === "error") {
        return { done: true, error: event.message ?? "Stream request failed" };
      }
    } catch {
      append(payload);
      return { rawChunk: payload };
    }
    return {};
  }

  /**
   * Send a follow-up chat message and stream the response.
   * The session must already exist (created by the analyze call).
   */
  const streamChat = useCallback(
    async (chatSessionId: string, message: string) => {
      if (isStreaming) return;

      // Add user message to store
      addMessage({
        id: msgId(),
        role: "user",
        content: message,
        timestamp: Date.now(),
      });

      // Start streaming
      setStreaming(true);
      setStreamingContent("");

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const resp = await fetch(`${API_BASE}/ai/chat/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: chatSessionId,
            message,
          }),
          signal: controller.signal,
        });

        if (!resp.ok || !resp.body) {
          throw new Error(`Stream request failed: ${resp.status}`);
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let fullResponse = "";
        let finalMessage: string | null = null;
        let finalSignal: unknown = undefined;
        let buffer = ""; // Buffer for partial lines split across chunks

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // SSE format: each line is "data: <token>\n\n"
          // Split on newlines but keep the last segment in the buffer
          // in case it's a partial line split across chunks.
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? ""; // Last element may be incomplete

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const handled = handlePayload(line.slice(6), appendStreamingContent);
              if (handled.error) {
                throw new Error(handled.error);
              }
              if (handled.rawChunk) {
                fullResponse += handled.rawChunk;
              }
              if (handled.finalMessage !== undefined) {
                finalMessage = handled.finalMessage;
                finalSignal = handled.finalSignal;
              }
            }
          }
        }

        // Process any remaining buffered content
        if (buffer.startsWith("data: ")) {
          const handled = handlePayload(buffer.slice(6), appendStreamingContent);
          if (handled.error) {
            throw new Error(handled.error);
          }
          if (handled.rawChunk) {
            fullResponse += handled.rawChunk;
          }
          if (handled.finalMessage !== undefined) {
            finalMessage = handled.finalMessage;
            finalSignal = handled.finalSignal;
          }
        }

        // Stream complete — save full response as assistant message
        addMessage({
          id: msgId(),
          role: "assistant",
          content: finalMessage ?? fullResponse,
          timestamp: Date.now(),
        });
        if (finalSignal != null) {
          setSignal(finalSignal as never);
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          // User cancelled — still save what we got
          const partial = useAiStore.getState().streamingContent;
          if (partial) {
            addMessage({
              id: msgId(),
              role: "assistant",
              content: partial + "\n\n[Cancelled]",
              timestamp: Date.now(),
            });
          }
        } else {
          addMessage({
            id: msgId(),
            role: "assistant",
            content: `[Error: ${(err as Error).message}]`,
            timestamp: Date.now(),
          });
        }
      } finally {
        setStreaming(false);
        setStreamingContent("");
        abortRef.current = null;
      }
    },
    [isStreaming, addMessage, setStreaming, setStreamingContent, appendStreamingContent, setSignal],
  );

  /** Cancel an in-progress stream */
  const cancelStream = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return {
    streamChat,
    cancelStream,
    isStreaming,
    streamingContent,
  };
}
